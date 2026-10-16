import AppKit
import SwiftUI

/// The user's settings, kept in UserDefaults.
@MainActor
final class Preferences: ObservableObject {
    /// The editor "Open in editor" uses; defaults to the first installed one.
    @AppStorage("editor") var editor: Editor = Editor.preferredDefault
    /// Whether a failure posts a system notification.
    @AppStorage("notifications") var notifications = true

    enum Editor: String, CaseIterable, Identifiable {
        case cursor = "com.todesktop.230313mzl4w4u92"
        case vscode = "com.microsoft.VSCode"
        case zed = "dev.zed.Zed"

        var id: String { rawValue }
        var bundleId: String { rawValue }

        var label: String {
            switch self {
            case .cursor: return "Cursor"
            case .vscode: return "VS Code"
            case .zed: return "Zed"
            }
        }

        var installed: Bool {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: rawValue) != nil
        }

        /// The first installed editor in declaration order, else Cursor.
        static var preferredDefault: Editor {
            allCases.first(where: \.installed) ?? .cursor
        }
    }
}
