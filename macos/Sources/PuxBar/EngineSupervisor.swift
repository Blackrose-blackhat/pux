import Foundation
import os
import PuxCore

/// Runs `pux serve`, turns its JSON-line stdout into `AppAction`s and restarts it with backoff.
/// It only reports what happened; the reducer decides what an exit means for the UI
/// (`restartsInLastMinute >= 3` is `.offline`).
@MainActor
final class EngineSupervisor {
    private static let logger = Logger(subsystem: "sh.pux.bar", category: "engine")
    /// Delay before restart 1, 2 and 3 within the window; there is no restart 4.
    private static let backoff: [TimeInterval] = [1, 2, 4]
    private static let restartWindow: TimeInterval = 60
    /// How long to wait after the process exits for its pipes to reach EOF.
    private static let drainGrace: TimeInterval = 0.5
    /// How long a freshly launched engine has to send `hello` before it is treated as
    /// incompatible (e.g. pux 0.1.5, whose `serve` is an HTTP server) and terminated.
    static var helloTimeout: TimeInterval = 10
    static let helloTimeoutReason = "engine did not say hello within 10s (is pux 0.1.6 or newer installed?)"

    private let dispatch: @MainActor (AppAction) -> Void
    private let locate: () -> URL?

    private var run: Run?
    private var restartTimes: [Date] = []
    private var pendingRestart: DispatchWorkItem?
    private var stopped = false

    init(dispatch: @escaping @MainActor (AppAction) -> Void, locate: @escaping () -> URL? = EngineSupervisor.locatePux) {
        self.dispatch = dispatch
        self.locate = locate
        // A write to the stdin of an engine that just died must fail with EPIPE, not kill the app.
        signal(SIGPIPE, SIG_IGN)
    }

    // MARK: - Locating the CLI

    /// `PUX_BIN` (when it names an existing file), then `which pux`, the Homebrew and
    /// /usr/local prefixes, ~/.npm-global and finally `$(npm prefix -g)/bin`.
    nonisolated static func locatePux() -> URL? {
        let fm = FileManager.default
        if let override = ProcessInfo.processInfo.environment["PUX_BIN"], !override.isEmpty,
           fm.fileExists(atPath: override) {
            return URL(fileURLWithPath: override)
        }
        func executable(_ path: String) -> URL? {
            let path = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !path.isEmpty, fm.isExecutableFile(atPath: path) else { return nil }
            return URL(fileURLWithPath: path)
        }
        if let found = runForOutput(["which", "pux"]).flatMap(executable) { return found }
        let home = fm.homeDirectoryForCurrentUser.path
        for path in ["/opt/homebrew/bin/pux", "/usr/local/bin/pux", "\(home)/.npm-global/bin/pux"] {
            if let found = executable(path) { return found }
        }
        if let prefix = runForOutput(["npm", "prefix", "-g"])?.trimmingCharacters(in: .whitespacesAndNewlines),
           !prefix.isEmpty, let found = executable("\(prefix)/bin/pux") {
            return found
        }
        return nil
    }

    /// The inherited environment with a PATH that finds `node` 22, `gh` and `git` when the app is
    /// launched from Finder. In order, deduplicated (first occurrence wins):
    /// 1. Homebrew's keg-only `node@22` (`/opt/homebrew/opt/node@22/bin`, `/usr/local/opt/node@22/bin`),
    ///    which the `pux` formula depends on and does not link into `bin`;
    /// 2. the directory holding `pux` itself, then the directory of its resolved target, so an
    ///    npm-global install (nvm, `npm prefix -g`) finds the `node` it was installed with;
    /// 3. the inherited PATH;
    /// 4. `/opt/homebrew/bin` and `/usr/local/bin`.
    nonisolated static func engineEnvironment(pux: URL?) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        var front = ["/opt/homebrew/opt/node@22/bin", "/usr/local/opt/node@22/bin"]
        if let pux {
            front.append(pux.deletingLastPathComponent().path)
            front.append(pux.resolvingSymlinksInPath().deletingLastPathComponent().path)
        }
        let inherited = (env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(separator: ":").map(String.init)
        var seen = Set<String>()
        let parts = (front + inherited + ["/opt/homebrew/bin", "/usr/local/bin"])
            .filter { !$0.isEmpty && seen.insert($0).inserted }
        env["PATH"] = parts.joined(separator: ":")
        return env
    }

    /// Runs a helper through /usr/bin/env and returns its stdout, or nil when it fails.
    private nonisolated static func runForOutput(_ arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = arguments
        process.environment = engineEnvironment(pux: nil)
        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - Lifecycle

    /// Starts the engine (no-op while one is running). An explicit start also forgets earlier
    /// restarts, so it gets the full three attempts again.
    func start() {
        stopped = false
        pendingRestart?.cancel()
        pendingRestart = nil
        guard run == nil else { return }
        restartTimes.removeAll()
        spawn()
    }

    func send(_ command: ServeCommand) {
        guard let run, run.process.isRunning else { return }
        do {
            try run.stdin.fileHandleForWriting.write(contentsOf: Data(ProtocolCodec.encode(command).utf8))
        } catch {
            Self.logger.error("could not write to pux serve: \(String(describing: error), privacy: .public)")
        }
    }

    /// Asks the engine to shut down, gives it 2s, then terminates it. Dispatches nothing and
    /// schedules no restart, whatever the exit looks like.
    func stop() {
        stopped = true
        pendingRestart?.cancel()
        pendingRestart = nil
        guard let current = run else { return }
        run = nil
        current.finished = true
        current.cancelHelloTimer()
        current.stdout.fileHandleForReading.readabilityHandler = nil
        current.stderr.fileHandleForReading.readabilityHandler = nil
        guard current.process.isRunning else { return }
        send(.shutdown, to: current)
        try? current.stdin.fileHandleForWriting.close()
        let deadline = Date().addingTimeInterval(2)
        while current.process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
        if current.process.isRunning { current.process.terminate() }
    }

    private func send(_ command: ServeCommand, to run: Run) {
        try? run.stdin.fileHandleForWriting.write(contentsOf: Data(ProtocolCodec.encode(command).utf8))
    }

    // MARK: - Spawning

    private func spawn() {
        guard let url = locate() else {
            dispatch(.engineMissing)
            return
        }
        let process = Process()
        process.executableURL = url
        process.arguments = ["serve"]
        process.environment = Self.engineEnvironment(pux: url)
        let current = Run(process: process)
        process.standardInput = current.stdin
        process.standardOutput = current.stdout
        process.standardError = current.stderr

        current.stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.stdoutData(data, from: current) }
            }
        }
        current.stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.stderrData(data, from: current) }
            }
        }
        process.terminationHandler = { [weak self] process in
            let code = process.terminationStatus
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.terminated(current, code: code) }
            }
        }

        run = current
        do {
            try process.run()
        } catch {
            current.stdout.fileHandleForReading.readabilityHandler = nil
            current.stderr.fileHandleForReading.readabilityHandler = nil
            current.stderrLines.append("could not launch \(url.path): \(error.localizedDescription)")
            current.exitCode = -1
            current.stdoutEOF = true
            current.stderrEOF = true
            finish(current)
            return
        }
        scheduleHelloTimeout(for: current)
    }

    /// Terminates an engine that never says hello (SIGTERM, then SIGKILL after 1s); the normal
    /// exit path then reports it with `helloTimeoutReason` as the last stderr line.
    private func scheduleHelloTimeout(for current: Run) {
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.run === current, !current.finished, !current.saidHello else { return }
                current.helloTimedOut = true
                let process = current.process
                guard process.isRunning else { return }
                process.terminate()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                }
            }
        }
        current.helloTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.helloTimeout, execute: work)
    }

    // MARK: - Pipe handling (main actor; callbacks hop here in order)

    private func stdoutData(_ data: Data, from current: Run) {
        guard !current.finished else { return }
        if data.isEmpty {
            current.stdoutEOF = true
            if !current.stdoutBuffer.isEmpty { handleLine(current.stdoutBuffer, from: current) }
            current.stdoutBuffer.removeAll()
            finishIfDrained(current)
            return
        }
        current.stdoutBuffer.append(data)
        while let newline = current.stdoutBuffer.firstIndex(of: 0x0A) {
            let line = current.stdoutBuffer[current.stdoutBuffer.startIndex..<newline]
            current.stdoutBuffer = Data(current.stdoutBuffer[(newline + 1)...])
            handleLine(Data(line), from: current)
            if current.finished { return }
        }
    }

    private func handleLine(_ bytes: Data, from current: Run) {
        var line = String(decoding: bytes, as: UTF8.self)
        if line.hasSuffix("\r") { line.removeLast() }
        guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let event: ServeEvent
        do {
            event = try ProtocolCodec.decode(line: line)
        } catch {
            Self.logger.error("undecodable line from pux serve: \(line, privacy: .public) (\(String(describing: error), privacy: .public))")
            return
        }
        // Started means "speaks the protocol": the first line that decodes, not just any output.
        if !current.started {
            current.started = true
            dispatch(.engineStarted)
        }
        if case .hello = event {
            current.saidHello = true
            current.cancelHelloTimer()
        }
        dispatch(.engineEvent(event))
    }

    private func stderrData(_ data: Data, from current: Run) {
        guard !current.finished else { return }
        if data.isEmpty {
            current.stderrEOF = true
            current.flushStderrPartial()
            finishIfDrained(current)
            return
        }
        current.stderrPartial.append(data)
        while let newline = current.stderrPartial.firstIndex(of: 0x0A) {
            let line = current.stderrPartial[current.stderrPartial.startIndex..<newline]
            current.stderrPartial = Data(current.stderrPartial[(newline + 1)...])
            current.appendStderr(Data(line))
        }
    }

    private func terminated(_ current: Run, code: Int32) {
        guard !current.finished else { return }
        current.exitCode = code
        current.cancelHelloTimer()
        if current.stdoutEOF && current.stderrEOF {
            finish(current)
        } else {
            // Give the pipes a moment to drain so the last event and stderr line are seen;
            // don't wait forever if something else holds them open.
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.drainGrace) { [weak self] in
                MainActor.assumeIsolated { self?.finish(current) }
            }
        }
    }

    private func finishIfDrained(_ current: Run) {
        if current.exitCode != nil, current.stdoutEOF, current.stderrEOF { finish(current) }
    }

    /// The run is over: report the exit and, under the limit, schedule the next attempt.
    private func finish(_ current: Run) {
        guard !current.finished, let code = current.exitCode else { return }
        current.finished = true
        current.stdout.fileHandleForReading.readabilityHandler = nil
        current.stderr.fileHandleForReading.readabilityHandler = nil
        current.cancelHelloTimer()
        current.flushStderrPartial()
        if current.helloTimedOut { current.appendStderrLine(Self.helloTimeoutReason) }
        guard run === current else { return }
        run = nil
        guard !stopped else { return }

        let now = Date()
        restartTimes.removeAll { now.timeIntervalSince($0) >= Self.restartWindow }
        let restarts = restartTimes.count
        dispatch(.engineExited(code: code, stderrTail: current.stderrLines.joined(separator: "\n"), restartsInLastMinute: restarts))
        guard restarts < Self.backoff.count else { return }

        restartTimes.append(now)
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.stopped, self.run == nil else { return }
                self.pendingRestart = nil
                self.spawn()
            }
        }
        pendingRestart = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.backoff[restarts], execute: work)
    }
}

/// One spawned `pux serve` process and the state of its pipes.
@MainActor
private final class Run {
    /// How many stderr lines are kept for `.engineExited`'s `stderrTail`.
    static let tailLines = 5
    let process: Process
    let stdin = Pipe()
    let stdout = Pipe()
    let stderr = Pipe()
    var stdoutBuffer = Data()
    var stderrPartial = Data()
    var stderrLines: [String] = []
    var started = false
    var stdoutEOF = false
    var stderrEOF = false
    var exitCode: Int32?
    var finished = false
    var saidHello = false
    var helloTimedOut = false
    var helloTimer: DispatchWorkItem?

    init(process: Process) { self.process = process }

    func cancelHelloTimer() {
        helloTimer?.cancel()
        helloTimer = nil
    }

    func appendStderr(_ bytes: Data) {
        var line = String(decoding: bytes, as: UTF8.self)
        if line.hasSuffix("\r") { line.removeLast() }
        appendStderrLine(line)
    }

    func appendStderrLine(_ line: String) {
        guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        stderrLines.append(line)
        if stderrLines.count > Self.tailLines { stderrLines.removeFirst(stderrLines.count - Self.tailLines) }
    }

    func flushStderrPartial() {
        if !stderrPartial.isEmpty { appendStderr(stderrPartial) }
        stderrPartial.removeAll()
    }
}
