import PuxCore
import SwiftUI

/// The dropped panel (360×240 below the notch): repo tabs on top, the selected repo (or the
/// engine's status, or settings) in the middle, actions and a status footer at the bottom.
struct PanelView: View {
    @ObservedObject var model: AppModel

    static let padding: CGFloat = 12

    var body: some View {
        let state = model.state
        let repo = state.repos.first { $0.path == state.selectedRepo } ?? state.repos.first
        let progress = min(1, max(0, model.openProgress))
        VStack(alignment: .leading, spacing: 6) {
            if case .running = state.engine, !state.repos.isEmpty {
                TabStrip(repos: state.repos, selected: repo?.path) { model.dispatch(.tabSelected($0)) }
                    .layoutPriority(1)
            }
            content(state, repo)
            footer(state, repo)
                .layoutPriority(1)
        }
        .padding(Self.padding)
        .frame(width: NotchGeometry.panelSize.width, height: NotchGeometry.panelSize.height, alignment: .topLeading)
        .focusable(false)
        .opacity(progress)
        .allowsHitTesting(model.openProgress > 0.9)
    }

    @ViewBuilder
    private func content(_ state: AppState, _ repo: RepoState?) -> some View {
        if state.showingSettings {
            SettingsView(prefs: model.prefs, selectedRepo: repo,
                         onRemoveRepo: { if let repo { model.removeRepo(repo: repo) } },
                         onQuit: model.quit)
        } else {
            switch state.engine {
            case .missing:
                EngineStatusView(kind: .install, onCopy: model.copyInstallCommand)
            case let .offline(reason):
                EngineStatusView(kind: .offline(reason), onRetry: model.retryEngine)
            case .starting:
                placeholder("Starting engine…")
            case .running:
                if let repo {
                    RepoBodyView(repo: repo) { model.answerConsent(repo: repo, allow: $0) }
                    ActionRow(repo: repo, editorLabel: model.prefs.editor.label,
                              onFix: { model.fix(repo: repo) }, onRerun: { model.rerun(repo: repo) },
                              onCopy: { model.copyContext(repo: repo) }, onGitHub: { model.openGitHub(repo: repo) },
                              onEditor: { model.openEditor(repo: repo) })
                        .layoutPriority(1)
                } else {
                    placeholder("No repos yet — run `pux watch` in a repository to add it.")
                }
            }
        }
    }

    private func placeholder(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(Color.white.opacity(0.55))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func footer(_ state: AppState, _ repo: RepoState?) -> some View {
        let status = Self.status(state, repo)
        return HStack(spacing: 6) {
            Text(status.text)
                .font(.system(size: 10))
                .foregroundStyle(status.color)
                .lineLimit(1)
                .truncationMode(.tail)
                .help(status.text)
            Spacer(minLength: 0)
            Button { model.dispatch(.toggleSettings) } label: {
                Image(systemName: state.showingSettings ? "gearshape.fill" : "gearshape")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.white.opacity(state.showingSettings ? 1 : 0.6))
                    .frame(width: 18, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(state.showingSettings ? "Back" : "Settings")
        }
        .frame(height: 18)
    }

    /// The footer line: fix progress, then re-run progress, then the repo's last error, then the engine version.
    static func status(_ state: AppState, _ repo: RepoState?) -> (text: String, color: Color) {
        let dim = Color.white.opacity(0.4)
        if let repo, case .running = state.engine, !state.showingSettings {
            if case .running = repo.fix, let line = ActionRow.fixLine(repo.fix) { return (line, Palette.amber) }
            if repo.rerun == .running { return ("Re-running…", Palette.amber) }
            if case let .done(result) = repo.fix {
                if case .error = result { return ("Fix failed · \(describe(result))", Palette.red) }
                return (describe(result), result.isFixed ? Palette.green : Palette.amber)
            }
            if case let .done(ok) = repo.rerun { return ok ? ("Re-run triggered", Palette.green) : ("Re-run failed", Palette.red) }
            if let error = repo.lastError { return (error, Palette.red) }
        }
        if case let .running(version) = state.engine, !version.isEmpty { return ("pux \(version)", dim) }
        return ("pux", dim)
    }
}

private extension FixResultPayload {
    var isFixed: Bool {
        if case .fixed = self { return true }
        return false
    }
}

/// The panel's status colours.
enum Palette {
    static let grey = Color(white: 0.55)
    static let amber = Color(red: 1, green: 0.75, blue: 0.2)
    static let green = Color(red: 0.3, green: 0.85, blue: 0.4)
    static let red = Color(red: 1, green: 0.33, blue: 0.3)

    static func color(for mood: Mood) -> Color {
        switch mood {
        case .idle: return grey
        case .watching: return amber
        case .passed: return green
        case .failed: return red
        }
    }
}
