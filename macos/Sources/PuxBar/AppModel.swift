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
    let engine: EngineSupervisor
    let prefs = Preferences()
    /// Posts a notification for each failure the engine reports; set by the app delegate.
    var notifier: Notifier?

    /// Called after every state change with the old and new panel mode.
    var onPanelChange: ((PanelMode, PanelMode) -> Void)?

    private var pointerInside = false
    private var hoverLeaveTimer: DispatchWorkItem?
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
