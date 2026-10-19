import AppKit
import os
import PuxCore
import SwiftUI

/// Owns the app state: every input goes through `dispatch`, which runs the reducer and drives
/// the open/close animation. Also owns the engine and the hover-leave grace period.
@MainActor
final class AppModel: ObservableObject {
    /// How long the pointer may be away before a peeking panel retracts.
    static let hoverLeaveGrace: TimeInterval = 0.3
    static let openAnimation = Animation.spring(response: 0.45, dampingFraction: 0.68)
    static let reducedMotionAnimation = Animation.easeInOut(duration: 0.2)
    private nonisolated static let logger = Logger(subsystem: "sh.pux.bar", category: "actions")

    @Published private(set) var state: AppState = .initial
    /// 0 collapsed, 1 open; set inside an animation so views interpolate (a spring overshoots).
    @Published private(set) var openProgress: CGFloat = 0
    @Published private(set) var reduceMotion: Bool
    @Published var layout: NotchLayout
    /// The result of the last add (picker, drop or debug flag) for the footer; cleared after
    /// `addRepoMessageDuration`. `addRepoFailed` picks its colour.
    @Published private(set) var addRepoMessage: String?
    @Published private(set) var addRepoFailed = false
    /// A drag with files is over the notch: the panel body says "Drop to watch".
    @Published private(set) var dropHint = false
    let engine: EngineSupervisor
    let prefs = Preferences()
    /// Posts a notification for each failure the engine reports; set by the app delegate.
    var notifier: Notifier?

    /// Called after every state change with the old and new panel mode.
    var onPanelChange: ((PanelMode, PanelMode) -> Void)?

    private var pointerInside = false
    private var hoverLeaveTimer: DispatchWorkItem?
    private var addRepoMessageTimer: DispatchWorkItem?
    private var displayOptionsObserver: NSObjectProtocol?

    init(layout: NotchLayout, locate: @escaping () -> URL? = EngineSupervisor.locatePux) {
        // The supervisor needs a dispatch closure before `self` exists; route it through a box.
        let relay = Relay()
        engine = EngineSupervisor(dispatch: { relay.model?.dispatch($0) }, locate: locate)
        self.layout = layout
        reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        relay.model = self
        displayOptionsObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
        }
    }

    /// Removes the observers and cancels pending timers; the model is inert afterwards.
    func tearDown() {
        if let displayOptionsObserver { NSWorkspace.shared.notificationCenter.removeObserver(displayOptionsObserver) }
        displayOptionsObserver = nil
        hoverLeaveTimer?.cancel()
        hoverLeaveTimer = nil
        addRepoMessageTimer?.cancel()
        addRepoMessageTimer = nil
        onPanelChange = nil
    }

    func dispatch(_ action: AppAction) {
        let old = state
        let next = reduce(old, action, now: Date())
        guard next != old else { return }
        state = next
        let open: CGFloat = next.panel == .collapsed ? 0 : 1
        if open != openProgress {
            withAnimation(reduceMotion ? Self.reducedMotionAnimation : Self.openAnimation) { openProgress = open }
        }
        if old.panel != next.panel { onPanelChange?(old.panel, next.panel) }
        // A missed draggingExited must not leave "Drop to watch" behind a collapsed panel.
        if next.panel == .collapsed { dropHint = false }
        if case let .engineEvent(.failure(path, _, _, _, _, _)) = action,
           let repo = next.repos.first(where: { $0.path == path }) {
            notifier?.failure(repo: repo)
        }
    }

    // MARK: - Panel actions

    func fix(repo: RepoState) {
        guard ActionRow.canFix(repo) else { return }
        engine.send(.fix(repo: repo.path, agent: nil, push: nil))
    }

    func rerun(repo: RepoState) {
        guard ActionRow.canRerun(repo), let pipeline = repo.firstFailedPipeline else { return }
        dispatch(.rerunRequested(repo: repo.path))
        engine.send(.rerun(repo: repo.path, pipelineId: pipeline.id))
    }

    /// Copies the failure context file (failure.md) for an agent; the error window when it can't be read.
    func copyContext(repo: RepoState) {
        guard let failure = repo.failure else { return }
        let path = failure.contextPath.hasPrefix("/")
            ? failure.contextPath
            : URL(fileURLWithPath: repo.path).appendingPathComponent(failure.contextPath).path
        let text: String
        do {
            text = try String(contentsOfFile: path, encoding: .utf8)
        } catch {
            Self.logger.error("could not read \(path, privacy: .public): \(String(describing: error), privacy: .public)")
            text = failure.errorWindow
        }
        Self.copy(text)
    }

    func openGitHub(repo: RepoState) {
        guard let string = repo.failure?.pipeline.url, let url = URL(string: string) else { return }
        NSWorkspace.shared.open(url)
    }

    /// Opens the repository in the chosen editor: `open -b <bundle id> <path>`.
    func openEditor(repo: RepoState) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-b", prefs.editor.bundleId, repo.path]
        process.terminationHandler = { process in
            guard process.terminationStatus != 0 else { return }
            Self.logger.error("open -b exited with \(process.terminationStatus, privacy: .public)")
        }
        do {
            try process.run()
        } catch {
            Self.logger.error("could not run open: \(String(describing: error), privacy: .public)")
        }
    }

    func answerConsent(repo: RepoState, allow: Bool) {
        if let repository = repo.repository {
            engine.send(.consent(repo: repo.path, repository: repository, allow: allow))
        } else {
            Self.logger.error("consent answered for \(repo.path, privacy: .public) without a repository")
        }
        dispatch(.consentAnswered(repo: repo.path))
    }

    /// Stops watching the repo; the engine's next `repos` event drops its tab. Leaves settings.
    func removeRepo(repo: RepoState) {
        engine.send(.removeRepo(repo: repo.path))
        if state.showingSettings { dispatch(.toggleSettings) }
    }

    func copyInstallCommand() {
        Self.copy(EngineStatusView.installCommand)
    }

    func retryEngine() {
        engine.start()
    }

    func quit() {
        engine.stop()
        NSApp.terminate(nil)
    }

    /// A notification was clicked: show that repo and pin the panel open.
    func openFromNotification(repo path: String) {
        dispatch(.tabSelected(path))
        if state.panel != .pinned { dispatch(.notchClicked) }
    }

    // MARK: - Adding repositories

    static let addRepoMessageDuration: TimeInterval = 6

    /// Opens a folder picker (non-modal, so the notch keeps drawing) and adds each chosen folder.
    /// Pins the panel first so it doesn't retract under the picker.
    func addRepository() {
        if state.panel != .pinned { dispatch(.notchClicked) }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Watch"
        panel.message = "Choose a repository to watch"
        panel.begin { [weak self, panel] response in
            guard response == .OK else { return }
            let urls = panel.urls
            MainActor.assumeIsolated { self?.addRepositories(urls) }
        }
        // An accessory app isn't active on its own; without this the picker opens behind other windows.
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    /// Adds each in turn, in order (each footer message replaces the last).
    func addRepositories(_ urls: [URL]) {
        Task {
            for url in urls { await addRepository(at: url) }
        }
    }

    /// Adds the repository containing `url` (its root, so a subfolder registers the repo) to the
    /// engine's watch list. The engine sees the file change and adds the tab; the footer says how it went.
    func addRepository(at url: URL) async {
        let name = url.lastPathComponent
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            showAddRepo("\(name) is not a folder", failed: true)
            return
        }
        switch await RepoProbe.probe(url.path) {
        case .notGit:
            showAddRepo("\(name) is not a Git repository", failed: true)
        case .noGitHubRemote:
            showAddRepo("\(name) has no GitHub remote", failed: true)
        case let .ok(root, repository):
            let label = repository ?? URL(fileURLWithPath: root).lastPathComponent
            let file = Registry.configURL()
            do {
                try await Self.addWatched(root: root, repository: repository, file: file)
                showAddRepo("Watching \(label)", failed: false)
            } catch RegistryError.alreadyWatched {
                showAddRepo("Already watching \(label)", failed: false)
            } catch {
                Self.logger.error("could not update \(file.path, privacy: .public): \(String(describing: error), privacy: .public)")
                let shown = (file.path as NSString).abbreviatingWithTildeInPath
                showAddRepo("Could not update \(shown): \(error.localizedDescription)", failed: true)
            }
        }
    }

    /// Reads config.json (missing is empty), adds the entry, writes it back atomically. Writes go
    /// through a symlinked config.json to its target, as the engine's `writeFile` does.
    ///
    /// An existing file is never replaced unless it parses: one that can't be read, or holds text
    /// that isn't a JSON object, is an error. The engine's saveConfig truncates then writes, so a
    /// read can land mid-write; a file that doesn't parse is read once more after 100 ms.
    private static func addWatched(root: String, repository: String?, file: URL) async throws {
        let target = file.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        func read() throws -> String {
            guard FileManager.default.fileExists(atPath: target.path) else { return "" }
            return String(decoding: try Data(contentsOf: target), as: UTF8.self)
        }
        func usable(_ text: String) -> Bool {
            text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || Registry.parsesAsObject(text)
        }
        var existing = try read()
        if !usable(existing) {
            try await Task.sleep(nanoseconds: 100_000_000)
            existing = try read()
            guard usable(existing) else { throw ConfigNotJSON() }
        }
        let text = try Registry.adding(path: root, repository: repository, now: Date(), to: existing)
        try Data(text.utf8).write(to: target, options: .atomic)
    }

    private struct ConfigNotJSON: LocalizedError {
        var errorDescription: String? { "config.json is not valid JSON" }
    }

    private func showAddRepo(_ message: String, failed: Bool) {
        addRepoMessage = message
        addRepoFailed = failed
        addRepoMessageTimer?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                self?.addRepoMessage = nil
                self?.addRepoMessageTimer = nil
            }
        }
        addRepoMessageTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.addRepoMessageDuration, execute: work)
    }

    // MARK: - Drag and drop (called by the window)

    /// A drag carrying files came over the notch (true) or left without dropping (false).
    /// Repeats are ignored, so the end of a drag can report false whether or not it dropped.
    func dragHover(_ inside: Bool) {
        guard inside != dropHint else { return }
        dropHint = inside
        dispatch(inside ? .hoverEntered : .hoverLeft)
    }

    /// Files were dropped on the notch: add each one (non-folders are refused with a message).
    /// Pins the panel so the footer message stays in view after the pointer leaves.
    func dropped(_ urls: [URL]) {
        dropHint = false
        if state.panel != .pinned { dispatch(.notchClicked) }
        addRepositories(urls)
    }

    private static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    // MARK: - Pointer and clicks (called by the window)

    /// The pointer is over the interactive part of the window (the notch, or the open panel).
    /// Entering cancels a pending leave; leaving retracts a peeking panel after the grace period.
    func pointer(inside: Bool) {
        if inside {
            hoverLeaveTimer?.cancel()
            hoverLeaveTimer = nil
        }
        guard inside != pointerInside else { return }
        pointerInside = inside
        if inside {
            dispatch(.hoverEntered)
        } else {
            let work = DispatchWorkItem { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, !self.pointerInside else { return }
                    self.hoverLeaveTimer = nil
                    self.dispatch(.hoverLeft)
                }
            }
            hoverLeaveTimer = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.hoverLeaveGrace, execute: work)
        }
    }

    /// A click outside the window closes the panel, whichever way it opened.
    func clickedOutside() {
        guard state.panel != .collapsed else { return }
        dispatch(.clickedOutside)
    }

    /// Returns whether Esc was used (the panel was open).
    func escapePressed() -> Bool {
        guard state.panel != .collapsed else { return false }
        dispatch(.escapePressed)
        return true
    }
}

@MainActor
private final class Relay {
    weak var model: AppModel?
}
