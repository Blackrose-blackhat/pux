import PuxCore
import SwiftUI

/// The repo's action buttons: Fix, Re-run, Copy context, GitHub and the editor.
struct ActionRow: View {
    var repo: RepoState
    var editorLabel = "Editor"
    var onFix: () -> Void
    var onRerun: () -> Void
    var onCopy: () -> Void
    var onGitHub: () -> Void
    var onEditor: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Button("Fix", action: onFix)
                .buttonStyle(PillButtonStyle(primary: true))
                .disabled(!Self.canFix(repo))
                .help("Ask a coding agent to fix this failure on a new branch")
            Button("Re-run", action: onRerun)
                .buttonStyle(PillButtonStyle())
                .disabled(!Self.canRerun(repo))
            Button("Copy context", action: onCopy)
                .buttonStyle(PillButtonStyle())
                .disabled(repo.failure == nil)
                .help("Copy the failure context for an AI agent")
            Button("GitHub", action: onGitHub)
                .buttonStyle(PillButtonStyle())
                .disabled(repo.failure?.pipeline.url.flatMap(URL.init(string:)) == nil)
            Spacer(minLength: 0)
            Button(editorLabel, action: onEditor)
                .buttonStyle(PillButtonStyle())
                .help("Open the repository in \(editorLabel)")
        }
        .frame(height: 28)
    }

    static func canFix(_ repo: RepoState) -> Bool {
        guard repo.failure != nil else { return false }
        if case .running = repo.fix { return false }
        return true
    }

    static func canRerun(_ repo: RepoState) -> Bool {
        repo.firstFailedPipeline != nil && repo.rerun != .running
    }

    /// The fix status for the footer: the TUI's stage wording while running, then `describe`.
    static func fixLine(_ fix: FixStatus) -> String? {
        switch fix {
        case .idle:
            return nil
        case let .running(stage, agent):
            let label = agent ?? "agent"
            let line: String
            switch stage {
            case "branch": line = "Creating fix branch…"
            case "agent": return "Running \(label)… this can take a few minutes"
            case "commit": line = "Committing changes…"
            case "push": line = "Pushing branch…"
            default: line = "Looking for a coding agent…"
            }
            return agent.map { "\($0) · \(line)" } ?? line
        case let .done(result):
            return describe(result)
        }
    }
}

extension RepoState {
    /// The pipeline Re-run targets: the first failed one across providers, else the captured failure's.
    var firstFailedPipeline: Pipeline? {
        for summary in providers {
            guard case let .active(pipelines) = summary.snapshot else { continue }
            if let failed = pipelines.first(where: { $0.status == .failed }) { return failed }
        }
        return failure?.pipeline
    }

    /// The pipeline the panel describes: the failure's, else the first with the worst status, else the first.
    var primaryPipeline: Pipeline? {
        if let failure { return failure.pipeline }
        let all = providers.flatMap { summary -> [Pipeline] in
            if case let .active(pipelines) = summary.snapshot { return pipelines }
            return []
        }
        return all.first { $0.status == worst } ?? all.first
    }

    var displayName: String {
        repository ?? URL(fileURLWithPath: path).lastPathComponent
    }
}

/// A capsule button: translucent white, or solid white with black text for the primary action.
/// Disabled buttons drop to 40% opacity.
struct PillButtonStyle: ButtonStyle {
    var primary = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: primary ? .semibold : .regular))
            .lineLimit(1)
            .foregroundStyle(primary ? Color.black : Color.white)
            .padding(.horizontal, 10)
            .frame(height: 22)
            .background(Capsule().fill(primary ? Color.white : Color.white.opacity(0.1)))
            .contentShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}
