import PuxCore
import SwiftUI

/// The selected repo: where it stands (repository, branch, commit, age), what failed, and either
/// the consent prompt, the error window, the running pipeline's steps or a one-line status.
struct RepoBodyView: View {
    var repo: RepoState
    var onConsent: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(Self.headline(repo))
                .font(.system(size: 11))
                .foregroundStyle(Color.white.opacity(0.55))
                .lineLimit(1)
                .truncationMode(.middle)
            // The consent prompt needs the room; the pipeline line comes back once it's answered.
            if repo.consent == nil, let line = Self.pipelineLine(repo) {
                Text(line)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(repo.failure != nil ? Palette.red : Color.white)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            detail
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipped()
    }

    @ViewBuilder
    private var detail: some View {
        if let plan = repo.consent {
            ConsentView(plan: plan, onAnswer: onConsent)
        } else if let failure = repo.failure {
            ErrorWindowBox(text: failure.errorWindow)
        } else if let pipeline = repo.primaryPipeline, pipeline.status == .building || pipeline.status == .queued,
                  let steps = pipeline.steps, !steps.isEmpty {
            StepList(steps: steps)
        } else {
            Text(Self.statusLine(repo))
                .font(.system(size: 11))
                .foregroundStyle(Color.white.opacity(0.55))
        }
    }

    // MARK: - Text

    /// "u/r · main · abc1234 · 2m ago", leaving out whatever is unknown.
    static func headline(_ repo: RepoState) -> String {
        var parts = [repo.displayName]
        if let branch = repo.branch { parts.append(branch) }
        if let commit = repo.commit ?? repo.primaryPipeline?.commit { parts.append(String(commit.prefix(7))) }
        if let startedAt = repo.primaryPipeline?.startedAt { parts.append(relativeTime(startedAt)) }
        return parts.joined(separator: " · ")
    }

    /// "<pipeline> › <failed step> · exit <code>" for a failure; "<pipeline> · <status>" otherwise.
    static func pipelineLine(_ repo: RepoState) -> String? {
        if let failure = repo.failure {
            var line = failure.pipeline.name
            if let step = failure.failedStep { line += " › \(step)" }
            if let code = failure.exitCode { line += " · exit \(code)" }
            return line
        }
        guard let pipeline = repo.primaryPipeline else { return nil }
        return "\(pipeline.name) · \(pipeline.status.rawValue)"
    }

    static func statusLine(_ repo: RepoState) -> String {
        switch repo.worst {
        case .completed: return "All pipelines passed."
        case .cancelled: return "The last pipeline was cancelled."
        case .building, .queued: return "Pipeline running…"
        case .failed: return "Pipeline failed; capturing the failure context…"
        case nil: return "Waiting for a pipeline…"
        }
    }

    /// "2m ago" from an ISO 8601 timestamp (with or without fractional seconds); the raw string
    /// when it does not parse.
    static func relativeTime(_ iso: String, now: Date = Date()) -> String {
        guard let date = parseISO(iso) else { return iso }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: min(date, now), relativeTo: now)
    }

    private static func parseISO(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }
}

/// The captured error output: monospaced, selectable, six lines tall before it scrolls.
private struct ErrorWindowBox: View {
    var text: String

    static let maxHeight: CGFloat = 84

    var body: some View {
        ScrollView(.vertical) {
            Text(text)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color.white.opacity(0.85))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
                .padding(.horizontal, 8)
        }
        .frame(maxHeight: Self.maxHeight)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.white.opacity(0.06))
        .overlay(alignment: .leading) { Rectangle().fill(Palette.red).frame(width: 2) }
    }
}

/// The running pipeline's jobs, the active one highlighted.
private struct StepList: View {
    var steps: [PipelineStep]

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                    let active = step.status == "building"
                    HStack(spacing: 6) {
                        Text(Self.glyph(step.status))
                            .foregroundStyle(Self.color(step.status))
                            .frame(width: 10)
                        Text(step.name)
                            .foregroundStyle(Color.white.opacity(active ? 1 : 0.55))
                            .fontWeight(active ? .semibold : .regular)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    .font(.system(size: 11))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: ErrorWindowBox.maxHeight)
        .fixedSize(horizontal: false, vertical: true)
    }

    static func glyph(_ status: String) -> String {
        switch status {
        case "completed": return "✓"
        case "failed": return "✗"
        case "building": return "◌"
        default: return "○"
        }
    }

    static func color(_ status: String) -> Color {
        switch status {
        case "completed": return Palette.green
        case "failed": return Palette.red
        case "building": return Palette.amber
        default: return Palette.grey
        }
    }
}

/// The agent-instructions consent prompt, worded as in the TUI.
private struct ConsentView: View {
    var plan: AgentPlan
    var onAnswer: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Connect your AI agents to Pux failure context?")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.amber)
            Text("This writes the following into this repository:")
                .font(.system(size: 11))
                .foregroundStyle(Color.white.opacity(0.55))
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(plan.entries.filter { $0.action != "present" }.enumerated()), id: \.offset) { _, entry in
                        let create = entry.action == "create"
                        entryLine(mark: create ? "+" : "~", markColor: create ? Palette.green : Color.cyan, path: entry.path,
                                  note: "\(create ? "create" : "append") for \(entry.agent)")
                    }
                    entryLine(mark: "+", markColor: Palette.green, path: ".gitignore", note: "add .ai-context/")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 46)
            .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                Button("Connect") { onAnswer(true) }.buttonStyle(PillButtonStyle(primary: true))
                Button("Skip") { onAnswer(false) }.buttonStyle(PillButtonStyle())
                Text("(remembered for this repository)")
                    .font(.system(size: 10))
                    .foregroundStyle(Color.white.opacity(0.4))
                    .lineLimit(1)
            }
            .padding(.top, 2)
        }
    }

    private func entryLine(mark: String, markColor: Color, path: String, note: String) -> some View {
        HStack(spacing: 4) {
            Text(mark).foregroundStyle(markColor)
            Text(path).foregroundStyle(Color.white)
            Text("· \(note)").foregroundStyle(Color.white.opacity(0.45))
        }
        .font(.system(size: 11, design: .monospaced))
        .lineLimit(1)
    }
}
