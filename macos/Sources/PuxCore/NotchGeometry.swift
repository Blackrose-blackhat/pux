import CoreGraphics

/// The slice of `NSScreen` the notch layout depends on, in AppKit screen coordinates (origin bottom-left).
public struct ScreenMetrics: Equatable {
    public var frame: CGRect
    public var safeAreaTop: CGFloat
    public var auxiliaryTopLeft: CGRect?
    public var auxiliaryTopRight: CGRect?

    public init(frame: CGRect, safeAreaTop: CGFloat, auxiliaryTopLeft: CGRect?, auxiliaryTopRight: CGRect?) {
        self.frame = frame
        self.safeAreaTop = safeAreaTop
        self.auxiliaryTopLeft = auxiliaryTopLeft
        self.auxiliaryTopRight = auxiliaryTopRight
    }
}

public struct NotchLayout: Equatable {
    public var hasNotch: Bool
    /// The hardware notch (or fallback pill) in screen coordinates, AppKit bottom-left origin.
    public var notchRect: CGRect
    public var windowFrame: CGRect
    public var panelSize: CGSize

    /// The collapsed silhouette: the hardware notch plus an `earWidth` "ear" on each side,
    /// where the collapsed status shows (the notch itself is the camera housing, with no pixels).
    /// Without a notch it is the fallback pill, which has room of its own.
    public var collapsedRect: CGRect {
        guard hasNotch else { return notchRect }
        return notchRect.insetBy(dx: -NotchGeometry.earWidth, dy: 0)
    }

    public init(hasNotch: Bool, notchRect: CGRect, windowFrame: CGRect, panelSize: CGSize) {
        self.hasNotch = hasNotch
        self.notchRect = notchRect
        self.windowFrame = windowFrame
        self.panelSize = panelSize
    }
}

public enum NotchGeometry {
    public static let panelSize = CGSize(width: 360, height: 240)
    public static let fallbackPill = CGSize(width: 160, height: 30)
    public static let hoverPadding: CGFloat = 10
    /// Width of each ear beside a hardware notch in the collapsed state.
    public static let earWidth: CGFloat = 44

    public static func layout(for screen: ScreenMetrics) -> NotchLayout {
        let frame = screen.frame
        let hasNotch: Bool
        let notchRect: CGRect

        if let left = screen.auxiliaryTopLeft, let right = screen.auxiliaryTopRight, screen.safeAreaTop > 0 {
            hasNotch = true
            notchRect = CGRect(x: left.maxX, y: frame.maxY - screen.safeAreaTop,
                               width: right.minX - left.maxX, height: screen.safeAreaTop)
        } else {
            hasNotch = false
            notchRect = CGRect(x: frame.midX - fallbackPill.width / 2, y: frame.maxY - fallbackPill.height,
                               width: fallbackPill.width, height: fallbackPill.height)
        }

        let collapsedWidth = notchRect.width + (hasNotch ? 2 * earWidth : 0)
        let width = max(panelSize.width, collapsedWidth + 2 * hoverPadding)
        let height = notchRect.height + panelSize.height
        let windowFrame = CGRect(x: notchRect.midX - width / 2, y: frame.maxY - height, width: width, height: height)
        return NotchLayout(hasNotch: hasNotch, notchRect: notchRect, windowFrame: windowFrame, panelSize: panelSize)
    }
}
