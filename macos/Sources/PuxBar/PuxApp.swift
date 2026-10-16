import AppKit
import PuxCore
import SwiftUI

@main
struct PuxApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var model: AppModel?
    private var window: NotchWindow?
    private var notifier: Notifier?
    private var tickTimer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var signalSources: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let layout = NotchGeometry.layout(for: Self.screenMetrics())
        let model = AppModel(layout: layout)
        let window = NotchWindow(layout: layout)
        self.model = model
        self.window = window

        let hosting = PanelHostingView(rootView: NotchRootView(model: model))
        hosting.sizingOptions = []
        window.embed(hosting)

        let notifier = Notifier(prefs: model.prefs) { [weak model] path in model?.openFromNotification(repo: path) }
        model.notifier = notifier
        self.notifier = notifier

        window.onPointerInside = { [weak model] inside in model?.pointer(inside: inside) }
        window.onNotchClick = { [weak model] in model?.dispatch(.notchClicked) }
        window.onEscape = { [weak model] in model?.escapePressed() ?? false }
        window.onClickOutside = { [weak model] in model?.clickedOutside() }
        model.onPanelChange = { [weak window] old, new in
            guard let window else { return }
            window.isOpen = new != .collapsed
            if new == .pinned, old != .pinned { window.makeKey() }
            if new == .collapsed { window.relinquishKey() }
        }

        window.orderFrontRegardless()
        window.startMonitoring()
        model.engine.start()

        tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak model] _ in
            MainActor.assumeIsolated { model?.dispatch(.tick(Date())) }
        }
        observers.append(NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.relayout() }
        })
        // `swift run` and launchd stop us with SIGINT/SIGTERM; terminate properly so the engine stops.
        for sig in [SIGINT, SIGTERM] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signalSources.append(source)
        }

        // Debug aids, to see the panel without a mouse: PUX_DEBUG_DROP=1 pins the panel open two
        // seconds after launch; PUX_DEBUG_SETTINGS=1 switches it to settings a second later;
        // PUX_DEBUG_ADD=<path>[:<path>…] runs the add-repository path (as the picker would) on
        // each path, the first at four seconds and then three seconds apart.
        let env = ProcessInfo.processInfo.environment
        if env["PUX_DEBUG_DROP"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak model] in
                MainActor.assumeIsolated { model?.dispatch(.notchClicked) }
            }
        }
        if env["PUX_DEBUG_SETTINGS"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak model] in
                MainActor.assumeIsolated { model?.dispatch(.toggleSettings) }
            }
        }
        if let paths = env["PUX_DEBUG_ADD"], !paths.isEmpty {
            for (i, path) in paths.split(separator: ":").enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + 4 + 3 * Double(i)) { [weak model] in
                    MainActor.assumeIsolated { model?.addRepositories([URL(fileURLWithPath: String(path))]) }
                }
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        tickTimer?.invalidate()
        tickTimer = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        signalSources.forEach { $0.cancel() }
        signalSources.removeAll()
        window?.close()
        model?.tearDown()
        model?.engine.stop()
    }

    private func relayout() {
        let layout = NotchGeometry.layout(for: Self.screenMetrics())
        guard let model, let window, layout != model.layout else { return }
        model.layout = layout
        window.apply(layout: layout)
    }

    /// The built-in display when it has a notch, otherwise the main screen.
    private static func screenMetrics() -> ScreenMetrics {
        let screen = NSScreen.screens.first { $0.auxiliaryTopLeftArea != nil && $0.safeAreaInsets.top > 0 }
            ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else {
            return ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1440, height: 900), safeAreaTop: 0,
                                 auxiliaryTopLeft: nil, auxiliaryTopRight: nil)
        }
        return ScreenMetrics(frame: screen.frame, safeAreaTop: screen.safeAreaInsets.top,
                             auxiliaryTopLeft: screen.auxiliaryTopLeftArea, auxiliaryTopRight: screen.auxiliaryTopRightArea)
    }
}

/// The window's SwiftUI root: the liquid shape filling the window (bleed included) and the
/// content laid out over `layout.windowFrame`, notch region on top, panel region below.
struct NotchRootView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        let layout = model.layout
        let bleed = NotchWindow.bleed
        let size = layout.windowFrame.size
        ZStack(alignment: .top) {
            LiquidShapeView(progress: model.openProgress, notchWidth: layout.notchRect.width,
                            notchHeight: layout.notchRect.height, collapsedWidth: layout.collapsedRect.width,
                            reduceMotion: model.reduceMotion,
                            panelSize: layout.panelSize)
            content(layout)
                .frame(width: size.width, height: size.height, alignment: .top)
        }
        .frame(width: size.width + bleed.left + bleed.right, height: size.height + bleed.top + bleed.bottom, alignment: .top)
        .ignoresSafeArea()
    }

    /// The collapsed region (cat and mood dot) over the panel region.
    @ViewBuilder
    private func content(_ layout: NotchLayout) -> some View {
        VStack(spacing: 0) {
            NotchGlyphs(mood: model.state.mood, earWidth: layout.hasNotch ? NotchGeometry.earWidth : nil)
                .frame(width: layout.collapsedRect.width, height: layout.collapsedRect.height)
            PanelView(model: model)
        }
    }
}

/// The cat and the mood dot. Beside a hardware notch they are centred in the left and right
/// ears (`earWidth`), leaving the camera housing empty; on the fallback pill (nil) they sit 14pt
/// in from its ends.
private struct NotchGlyphs: View {
    var mood: Mood
    var earWidth: CGFloat?

    static let inset: CGFloat = 14

    var body: some View {
        HStack(spacing: 0) {
            if let earWidth {
                cat.frame(width: earWidth)
                Spacer(minLength: 0)
                dot.frame(width: earWidth)
            } else {
                cat
                Spacer(minLength: 0)
                dot
            }
        }
        .padding(.horizontal, earWidth == nil ? Self.inset : 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Pux: \(String(describing: mood))"))
    }

    private var cat: some View {
        VStack(spacing: 0) {
            Text(verbatim: "/\\_/\\")   // verbatim: a literal is Markdown, which reads \_ as "_"
            Text(Self.face(mood))
        }
        .font(.system(size: 7, design: .monospaced))
        .foregroundStyle(Color.white)
        .fixedSize()
    }

    private var dot: some View {
        Circle()
            .fill(Palette.color(for: mood))
            .frame(width: 7, height: 7)
            .shadow(color: Self.glow(mood), radius: 6)
    }

    static func face(_ mood: Mood) -> String {
        switch mood {
        case .idle: return "(-.-)"
        case .watching: return "(o.o)"
        case .passed: return "(^.^)"
        case .failed: return "(;.;)"
        }
    }

    static func glow(_ mood: Mood) -> Color {
        switch mood {
        case .failed: return Palette.red
        case .passed: return Palette.green
        case .idle, .watching: return .clear
        }
    }
}

/// Hosts the SwiftUI root and takes the first click, since the window is a non-activating panel.
final class PanelHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
