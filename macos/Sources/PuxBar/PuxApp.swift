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

        let hosting = NSHostingView(rootView: NotchRootView(model: model))
        hosting.sizingOptions = []
        window.embed(hosting)

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

        // Debug aid: pin the panel open two seconds after launch, to see the drop without a mouse.
        if ProcessInfo.processInfo.environment["PUX_DEBUG_DROP"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak model] in
                MainActor.assumeIsolated { model?.dispatch(.notchClicked) }
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
                            notchHeight: layout.notchRect.height, reduceMotion: model.reduceMotion,
                            panelSize: layout.panelSize)
            content(layout)
                .frame(width: size.width, height: size.height, alignment: .top)
        }
        .frame(width: size.width + bleed.left + bleed.right, height: size.height + bleed.top + bleed.bottom, alignment: .top)
        .ignoresSafeArea()
    }

    // Placeholder until the panel arrives (Task 10).
    @ViewBuilder
    private func content(_ layout: NotchLayout) -> some View {
        let progress = Double(model.openProgress)
        VStack(spacing: 0) {
            HStack {
                Spacer(minLength: 0)
                Circle()
                    .fill(Self.color(for: model.state.mood))
                    .frame(width: 6, height: 6)
                    .padding(.trailing, 14)
            }
            .frame(width: layout.notchRect.width, height: layout.notchRect.height)
            .opacity(1 - min(1, max(0, progress)))

            Text("pux")
                .font(.caption)
                .foregroundStyle(.white)
                .opacity(progress)
                .padding(.top, 10)
        }
    }

    private static func color(for mood: Mood) -> Color {
        switch mood {
        case .idle: return .gray
        case .watching: return Color(red: 1, green: 0.75, blue: 0.2)
        case .passed: return .green
        case .failed: return .red
        }
    }
}
