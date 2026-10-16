import AppKit
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

    @Published private(set) var state: AppState = .initial
    /// 0 collapsed, 1 open; set inside an animation so views interpolate (a spring overshoots).
    @Published private(set) var openProgress: CGFloat = 0
    @Published private(set) var reduceMotion: Bool
    @Published var layout: NotchLayout
    let engine: EngineSupervisor

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

    /// A click outside the window closes a panel the user opened (not one that auto-dropped).
    func clickedOutside() {
        switch state.panel {
        case .pinned, .peeking: dispatch(.clickedOutside)
        case .collapsed, .autoDropped: break
        }
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
