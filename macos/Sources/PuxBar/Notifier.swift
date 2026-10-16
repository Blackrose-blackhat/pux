import Foundation
import os
import PuxCore
import UserNotifications

/// Posts a system notification for each new failure; clicking it opens that repo's tab.
///
/// `UNUserNotificationCenter` needs an app bundle with a bundle identifier: from a bare
/// executable (`swift run`) `current()` raises an Objective-C exception, so the notifier stays
/// off there and only logs.
@MainActor
final class Notifier {
    private nonisolated static let logger = Logger(subsystem: "sh.pux.bar", category: "notifications")

    private let prefs: Preferences
    private let delegate: Delegate
    private var authorizationRequested = false

    init(prefs: Preferences, onOpen: @escaping @MainActor (String) -> Void) {
        self.prefs = prefs
        delegate = Delegate(onOpen: onOpen)
        if let center = Self.center() { center.delegate = delegate }
    }

    /// Notifies about `repo`'s current failure: title the repository (or the folder name), body
    /// "<pipeline> › <failed step>". One notification per repo; a newer one replaces it.
    func failure(repo: RepoState) {
        guard prefs.notifications, let failure = repo.failure, let center = Self.center() else { return }
        if !authorizationRequested {
            authorizationRequested = true
            center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                if let error {
                    Self.logger.error("notification authorization failed: \(String(describing: error), privacy: .public)")
                } else if !granted {
                    Self.logger.info("notifications not allowed by the user")
                }
            }
        }
        let content = UNMutableNotificationContent()
        content.title = repo.repository ?? URL(fileURLWithPath: repo.path).lastPathComponent
        content.body = "\(failure.pipeline.name) › \(failure.failedStep ?? "failed")"
        content.sound = .default
        content.userInfo = ["repo": repo.path]
        let request = UNNotificationRequest(identifier: repo.path, content: content, trigger: nil)
        center.add(request) { error in
            if let error {
                Self.logger.error("could not post notification: \(String(describing: error), privacy: .public)")
            }
        }
    }

    /// The notification centre, or nil when not running from an app bundle.
    private static func center() -> UNUserNotificationCenter? {
        guard Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else {
            logOnce()
            return nil
        }
        return UNUserNotificationCenter.current()
    }

    private static var loggedUnavailable = false
    private static func logOnce() {
        guard !loggedUnavailable else { return }
        loggedUnavailable = true
        logger.info("notifications unavailable: not running from an app bundle")
    }
}

private final class Delegate: NSObject, UNUserNotificationCenterDelegate {
    private let onOpen: @MainActor (String) -> Void

    init(onOpen: @escaping @MainActor (String) -> Void) {
        self.onOpen = onOpen
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let repo = response.notification.request.content.userInfo["repo"] as? String
        let onOpen = self.onOpen
        DispatchQueue.main.async {
            MainActor.assumeIsolated { if let repo { onOpen(repo) } }
            completionHandler()
        }
    }

    // Show the banner even if Pux happens to be the active app.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
