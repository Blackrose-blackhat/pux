import AppKit
import PuxCore

/// A borderless, non-activating panel flush with the top of the screen around the notch.
///
/// It lets clicks through (`ignoresMouseEvents`) except where the pointer is over the notch, or
/// over the panel while it is open, so the menu bar and windows beside a collapsed notch keep
/// working. Pointer position is checked on every mouse move: a global monitor sees moves while
/// the window ignores the mouse, the tracking area and a local monitor while it doesn't.
///
/// Folders dragged onto the notch are added to the watch list. Drags don't produce mouse moves,
/// so a global `.leftMouseDragged` monitor keeps pass-through current during a drag (and only
/// that: the drag destination reports hover itself).
final class NotchWindow: NSPanel {
    /// Transparent margin around `layout.windowFrame` so the blur and the spring's overshoot are
    /// not clipped by the window edge. The top stays flush with the screen.
    static let bleed = NSEdgeInsets(top: 0, left: 24, bottom: 32, right: 24)

    private(set) var layout: NotchLayout
    /// The panel is open (or opening); while it is, the panel area takes the mouse too.
    var isOpen = false {
        didSet { if isOpen != oldValue { refreshPointer() } }
    }

    var onPointerInside: ((Bool) -> Void)?
    var onNotchClick: (() -> Void)?
    /// Returns whether the key press was used.
    var onEscape: (() -> Bool)?
    var onClickOutside: (() -> Void)?
    /// A drag with file URLs entered (true) or left without dropping (false).
    var onDragHover: ((Bool) -> Void)?
    /// File URLs dropped on the window.
    var onDrop: (([URL]) -> Void)?

    private let trackingView = TrackingView()
    private var monitors: [Any] = []

    init(layout: NotchLayout) {
        self.layout = layout
        super.init(contentRect: Self.frame(for: layout), styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isMovableByWindowBackground = false
        animationBehavior = .none
        isReleasedWhenClosed = false
        ignoresMouseEvents = true

        trackingView.onMouse = { [weak self] in self?.refreshPointer() }
        trackingView.onDragHover = { [weak self] in self?.onDragHover?($0) }
        trackingView.onDrop = { [weak self] in self?.onDrop?($0) }
        trackingView.registerForDraggedTypes([.fileURL])
        contentView = trackingView
    }

    /// The window's frame for a layout: `windowFrame` plus the bleed.
    static func frame(for layout: NotchLayout) -> CGRect {
        let f = layout.windowFrame
        return CGRect(x: f.minX - bleed.left, y: f.minY - bleed.bottom,
                      width: f.width + bleed.left + bleed.right, height: f.height + bleed.bottom + bleed.top)
    }

    func apply(layout: NotchLayout) {
        self.layout = layout
        setFrame(Self.frame(for: layout), display: true)
        refreshPointer()
    }

    /// Puts `view` in the window, filling it.
    func embed(_ view: NSView) {
        view.frame = trackingView.bounds
        view.autoresizingMask = [.width, .height]
        trackingView.addSubview(view)
    }

    // Key only when asked (the panel is pinned), so Esc and later text fields work.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// Key presses nothing in the panel handled end here instead of beeping (Esc is taken
    /// earlier by the key monitor).
    override func keyDown(with event: NSEvent) {}

    /// There is no main menu to route ⌘C, so send `copy:` for selected error text directly.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
           event.charactersIgnoringModifiers == "c" {
            return NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: self)
        }
        return super.performKeyEquivalent(with: event)
    }

    /// The window sits over the menu bar on purpose; don't let AppKit push it down.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    override func close() {
        stopMonitoring()
        super.close()
    }

    // MARK: - Hit regions (screen coordinates)

    /// The collapsed shape (notch and ears) widened by `hoverPadding` on each side, plus a point
    /// above it so the pointer pressed against the screen edge counts. Hover and notch clicks use it.
    var notchHitRect: CGRect {
        let n = layout.collapsedRect
        let pad = NotchGeometry.hoverPadding
        return CGRect(x: n.minX - pad, y: n.minY, width: n.width + 2 * pad, height: n.height + 1)
    }

    /// The fully dropped panel below the notch.
    var panelRect: CGRect {
        let n = layout.notchRect
        let size = layout.panelSize
        return CGRect(x: n.midX - size.width / 2, y: n.minY - size.height, width: size.width, height: size.height)
    }

    /// Whether a screen point should go to Pux rather than whatever is underneath.
    func isInteractive(_ point: CGPoint) -> Bool {
        notchHitRect.contains(point) || (isOpen && panelRect.contains(point))
    }

    /// Re-evaluates mouse pass-through and hover for the current pointer position.
    func refreshPointer() {
        onPointerInside?(refreshPassThrough())
    }

    /// Re-evaluates mouse pass-through only; returns whether the pointer is over Pux.
    @discardableResult
    func refreshPassThrough() -> Bool {
        let inside = isInteractive(NSEvent.mouseLocation)
        if ignoresMouseEvents == inside { ignoresMouseEvents = !inside }
        return inside
    }

    // MARK: - Event monitors

    func startMonitoring() {
        guard monitors.isEmpty else { return }
        let moves: NSEvent.EventTypeMask = [.mouseMoved]
        if let m = NSEvent.addGlobalMonitorForEvents(matching: moves, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshPointer() }
        }) { monitors.append(m) }
        if let m = NSEvent.addLocalMonitorForEvents(matching: moves, handler: { [weak self] event in
            MainActor.assumeIsolated { self?.refreshPointer() }
            return event
        }) { monitors.append(m) }
        // A drag from another app (Finder) must reach the window over the notch to be dropped.
        if let m = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDragged, handler: { [weak self] _ in
            MainActor.assumeIsolated { _ = self?.refreshPassThrough() }
        }) { monitors.append(m) }

        // Clicks that reach another app are outside the panel by definition; the check guards
        // against a click landing in the bleed or beside the notch.
        if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.isInteractive(NSEvent.mouseLocation) else { return }
                self.onClickOutside?()
            }
        }) { monitors.append(m) }
        if let m = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown, handler: { [weak self] event in
            MainActor.assumeIsolated {
                if let self, event.window === self, self.notchHitRect.contains(NSEvent.mouseLocation) {
                    self.onNotchClick?()
                }
            }
            return event
        }) { monitors.append(m) }

        if let m = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            guard event.keyCode == 53 else { return event }   // Esc
            let used = MainActor.assumeIsolated { self?.onEscape?() ?? false }
            return used ? nil : event
        }) { monitors.append(m) }
        refreshPointer()
    }

    func stopMonitoring() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
    }

    /// Hands keyboard focus back to the app underneath: ordering a key window out lets the
    /// active app's window take key again; ordering back in shows it without taking key.
    func relinquishKey() {
        guard isKeyWindow else { return }
        orderOut(nil)
        orderFrontRegardless()
    }
}

/// The content view: reports mouse enter, exit and moves over the whole window, and takes
/// file drops.
private final class TrackingView: NSView {
    var onMouse: (() -> Void)?
    var onDragHover: ((Bool) -> Void)?
    var onDrop: (([URL]) -> Void)?
    private var area: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area { removeTrackingArea(area) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        self.area = area
    }

    override func mouseEntered(with event: NSEvent) { onMouse?() }
    override func mouseExited(with event: NSEvent) { onMouse?() }
    override func mouseMoved(with event: NSEvent) { onMouse?() }

    // MARK: Dropping folders

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !Self.fileURLs(sender).isEmpty else { return [] }
        onDragHover?(true)
        return Self.operation(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        Self.fileURLs(sender).isEmpty ? [] : Self.operation(sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        onDragHover?(false)
    }

    /// A drag cancelled over the window may end without an exit; clears the hint (a no-op after a drop).
    override func draggingEnded(_ sender: NSDraggingInfo) {
        onDragHover?(false)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = Self.fileURLs(sender)
        guard !urls.isEmpty else { return false }
        onDrop?(urls)
        return true
    }

    private static func fileURLs(_ info: NSDraggingInfo) -> [URL] {
        let objects = info.draggingPasteboard.readObjects(forClasses: [NSURL.self],
                                                          options: [.urlReadingFileURLsOnly: true])
        return (objects as? [URL]) ?? []
    }

    /// Copy when the source allows it (the "+" badge), else whatever it offers.
    private static func operation(_ info: NSDraggingInfo) -> NSDragOperation {
        let mask = info.draggingSourceOperationMask
        for op: NSDragOperation in [.copy, .link, .generic] where mask.contains(op) { return op }
        return []
    }
}
