import PuxCore
import SwiftUI

/// The black silhouette that drips out of the notch: the collapsed shape (the notch plus its
/// ears), a goo neck and the panel hanging below it, metaball-fused by blurring the layer and
/// thresholding its alpha. At `progress` 0 it is just the collapsed shape (`collapsedWidth` wide,
/// bottom corners rounded); at 1 the panel is fully dropped. A spring may push `progress` slightly past 1 or below 0.
///
/// The view fills its frame; the notch is drawn top-centre, so the frame may be wider and taller
/// than notch + panel (the window adds a transparent bleed so blur and overshoot aren't clipped).
struct LiquidShapeView: View, Animatable {
    var progress: CGFloat
    var notchWidth: CGFloat
    var notchHeight: CGFloat
    /// Width of the collapsed shape: the notch plus both ears (`NotchLayout.collapsedRect`).
    var collapsedWidth: CGFloat
    var reduceMotion: Bool
    var panelSize: CGSize = NotchGeometry.panelSize

    static let blurRadius: CGFloat = 8
    static let cornerRadius: CGFloat = 34
    /// Bottom corner radius of the collapsed shape.
    static let collapsedCornerRadius: CGFloat = 14
    /// Radius and x offset from centre of each trailing droplet.
    static let droplets: [(radius: CGFloat, dx: CGFloat)] = [(14, -120), (10, 40), (8, 110)]

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        Canvas { context, size in
            // Filters apply to the layer drawn after them, blur first, then the threshold turns
            // the soft alpha back into one hard-edged shape: overlapping blobs fuse.
            context.addFilter(.alphaThreshold(min: 0.5, color: .black))
            context.addFilter(.blur(radius: Self.blurRadius))
            context.drawLayer { layer in
                for path in Self.blobs(progress: progress, notch: CGSize(width: notchWidth, height: notchHeight),
                                       collapsedWidth: collapsedWidth, panel: panelSize, reduceMotion: reduceMotion, centreX: size.width / 2) {
                    layer.fill(path, with: .color(.black))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// The unfused shapes for one frame, in view coordinates (origin top-left).
    static func blobs(progress p: CGFloat, notch: CGSize, collapsedWidth: CGFloat, panel: CGSize, reduceMotion: Bool,
                      centreX cx: CGFloat) -> [Path] {
        // The collapsed shape (notch and ears), extended above the top edge so the blur doesn't
        // soften the screen edge. The ears sit inside the panel's width, so they fuse into it.
        let collapsed = CGRect(x: cx - collapsedWidth / 2, y: -notch.height, width: collapsedWidth, height: notch.height * 2)
        let corners = RectangleCornerRadii(bottomLeading: collapsedCornerRadius, bottomTrailing: collapsedCornerRadius)
        var paths = [UnevenRoundedRectangle(cornerRadii: corners, style: .continuous).path(in: collapsed)]
        guard p > 0 else { return paths }

        // The goo neck straddling the notch's bottom edge, grown in over the first quarter of the
        // drop so the collapsed shape is exactly the notch and its ears.
        let neck = min(1, p * 4)
        let neckWidth = notch.width * (1 + 0.3 * neck)
        let neckHeight = 24 * neck
        paths.append(Path(ellipseIn: CGRect(x: cx - neckWidth / 2, y: notch.height - neckHeight / 2,
                                            width: neckWidth, height: neckHeight)))

        // The panel hanging from the notch's bottom edge. It leaves the notch at the notch's
        // width and swells to the panel's width over the first 60% of the drop (smoothstep), so
        // it drips out of the notch instead of appearing as a full-width bar.
        let height = p * panel.height
        let bottom = notch.height + height
        let swell = min(1, p / 0.6)
        let width = notch.width + (panel.width - notch.width) * swell * swell * (3 - 2 * swell)
        paths.append(Path(roundedRect: CGRect(x: cx - width / 2, y: notch.height, width: width, height: height),
                          cornerRadius: min(cornerRadius, height / 2), style: .continuous))

        // Droplets hanging below the falling edge, lagging it by (1 - p) * 40 so they merge back
        // as it lands. Their size fades in and out at both ends so nothing pops.
        if !reduceMotion, p < 1 {
            let lag = (1 - p) * 40
            let envelope = min(1, p * 5, (1 - p) * 5)
            for drop in droplets {
                let r = drop.radius * envelope
                paths.append(Path(ellipseIn: CGRect(x: cx + drop.dx - r, y: bottom + lag - r, width: 2 * r, height: 2 * r)))
            }
        }
        return paths
    }
}
