import PuxCore
import SwiftUI

/// One pill per repo with a status dot; scrolls sideways past six repos.
struct TabStrip: View {
    var repos: [RepoState]
    var selected: String?
    var onSelect: (String) -> Void

    static let scrollThreshold = 6

    var body: some View {
        Group {
            if repos.count > Self.scrollThreshold {
                ScrollView(.horizontal, showsIndicators: false) { pills }
            } else {
                pills.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(height: 28)
    }

    private var pills: some View {
        HStack(spacing: 6) {
            ForEach(repos) { repo in
                let isSelected = repo.path == selected
                Button { onSelect(repo.path) } label: {
                    HStack(spacing: 5) {
                        Circle().fill(Self.color(for: repo)).frame(width: 7, height: 7)
                        Text(Self.shortName(repo))
                            .font(.system(size: 11, weight: isSelected ? .semibold : .regular))
                            .lineLimit(1)
                            .foregroundStyle(Color.white.opacity(isSelected ? 1 : 0.65))
                    }
                    .padding(.horizontal, 9)
                    .frame(height: 22)
                    .fixedSize()
                    .background(Capsule().fill(Color.white.opacity(isSelected ? 0.18 : 0.06)))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help(repo.repository ?? repo.path)
            }
        }
    }

    static let maxNameLength = 18

    /// The repo part of "owner/repo", or the folder name, cut to `maxNameLength` characters.
    static func shortName(_ repo: RepoState) -> String {
        var name = repo.displayName
        if repo.repository != nil, let last = name.split(separator: "/").last { name = String(last) }
        return name.count > maxNameLength ? name.prefix(maxNameLength - 1) + "…" : name
    }

    static func color(for repo: RepoState) -> Color {
        if repo.failure != nil { return Palette.red }
        switch repo.worst {
        case .failed: return Palette.red
        case .building, .queued: return Palette.amber
        case .completed: return Palette.green
        case .cancelled, nil: return Palette.grey
        }
    }
}
