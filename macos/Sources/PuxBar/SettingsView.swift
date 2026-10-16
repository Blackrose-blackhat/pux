import PuxCore
import SwiftUI

/// Replaces the repo body while the gear is on: editor, notifications, add and remove repos, quit.
struct SettingsView: View {
    @ObservedObject var prefs: Preferences
    var selectedRepo: RepoState?
    var onAddRepo: () -> Void
    var onRemoveRepo: () -> Void
    var onQuit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Settings")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white)
            HStack {
                Text("Editor").foregroundStyle(Color.white.opacity(0.75))
                Spacer()
                Picker("Editor", selection: $prefs.editor) {
                    ForEach(editors) { editor in
                        Text(editor.label).tag(editor)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .fixedSize()
            }
            Toggle(isOn: $prefs.notifications) {
                Text("Notify on failures").foregroundStyle(Color.white.opacity(0.75))
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
            HStack(spacing: 6) {
                Button("Add…", action: onAddRepo)
                    .buttonStyle(PillButtonStyle())
                    .help("Choose a repository to watch")
                Button(role: .destructive, action: onRemoveRepo) {
                    Text(selectedRepo.map { "Remove \($0.displayName)" } ?? "Remove repo")
                        .foregroundStyle(Palette.red)
                }
                .buttonStyle(PillButtonStyle())
                .disabled(selectedRepo == nil)
                Spacer(minLength: 0)
                Button("Quit Pux", action: onQuit).buttonStyle(PillButtonStyle())
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Installed editors, plus the saved choice so the picker always has a matching tag.
    private var editors: [Preferences.Editor] {
        Preferences.Editor.allCases.filter { $0.installed || $0 == prefs.editor }
    }
}
