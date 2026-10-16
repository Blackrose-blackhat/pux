import Foundation

// The engine's watch list: the `watched` key of ~/.config/pux/config.json, which `pux serve`
// re-reads when the file changes. The TypeScript writer is `addWatchedRepo` in
// src/config/store.ts; `adding` produces the same text it would.

public enum RegistryError: Error, Equatable {
    case alreadyWatched
}

/// One `watched` entry: `owner/name` (nil without a GitHub remote) and when it was added.
public struct WatchedRepoEntry: Equatable {
    public var repository: String?
    public var addedAt: String

    public init(repository: String?, addedAt: String) {
        self.repository = repository
        self.addedAt = addedAt
    }
}

public enum Registry {
    /// Returns the JSON text with `watched[path]` added. Throws `.alreadyWatched` when present.
    /// `existing` may be empty or invalid JSON (treated as `{}`), matching the engine's loadConfig fallback.
    ///
    /// The result is what the engine's `loadConfig` + `saveConfig` would write: other keys keep
    /// their order and values, `repos` comes first (created empty if missing), a new `watched`
    /// goes last, 2-space indentation, trailing newline. JSON that isn't an object counts as `{}`.
    /// A `repos` value that isn't an object is kept as it is (the engine would write `{}` there).
    /// Callers writing a file should check `parsesAsObject` first rather than replace a file that
    /// doesn't parse.
    public static func adding(path: String, repository: String?, now: Date, to existing: String) throws -> String {
        var config = (try? OrderedJSON.parse(existing)).flatMap { value -> OrderedJSON? in
            if case .object = value { return value }
            return nil
        } ?? .object([])

        // `{ ...defaults, ...parsed }` with defaults `{ repos: {} }`: repos is always the first key.
        if case var .object(members) = config {
            let repos = members.firstIndex { $0.key == "repos" }.map { members.remove(at: $0).value } ?? .object([])
            members.insert(.init(key: "repos", value: repos), at: 0)
            config = .object(members)
        }

        var watched: OrderedJSON = .object([])
        if let current = config["watched"], case .object = current { watched = current }
        guard watched[path] == nil else { throw RegistryError.alreadyWatched }
        let entry = WatchedRepoEntry(repository: repository, addedAt: timestamp(now))
        watched.set(path, .object([
            .init(key: "repository", value: entry.repository.map(OrderedJSON.string) ?? .null),
            .init(key: "addedAt", value: .string(entry.addedAt)),
        ]))
        config.set("watched", watched)
        return config.stringified() + "\n"
    }

    /// Whether `text` is a complete JSON object, i.e. what `adding` keeps rather than treating as `{}`.
    public static func parsesAsObject(_ text: String) -> Bool {
        guard case .object = try? OrderedJSON.parse(text) else { return false }
        return true
    }

    /// Default config file: $PUX_CONFIG_DIR/config.json, else $XDG_CONFIG_HOME/pux/config.json, else ~/.config/pux/config.json
    /// (empty variables count as unset, as in the engine's `configDir`).
    public static func configURL(environment: [String: String] = ProcessInfo.processInfo.environment,
                                 home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        let dir: URL
        if let custom = environment["PUX_CONFIG_DIR"], !custom.isEmpty {
            dir = URL(fileURLWithPath: custom, isDirectory: true)
        } else if let xdg = environment["XDG_CONFIG_HOME"], !xdg.isEmpty {
            dir = URL(fileURLWithPath: xdg, isDirectory: true).appendingPathComponent("pux", isDirectory: true)
        } else {
            dir = home.appendingPathComponent(".config", isDirectory: true).appendingPathComponent("pux", isDirectory: true)
        }
        return dir.appendingPathComponent("config.json", isDirectory: false)
    }

    /// "owner/name" from a GitHub remote URL, nil when it is not github.com. Handles
    /// https://github.com/o/n.git, https://github.com/o/n, git@github.com:o/n.git, ssh://git@github.com/o/n.git
    public static func repositorySlug(fromRemote url: String) -> String? {
        let remote = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let path: Substring
        if let colon = remote.firstIndex(of: ":"), remote[..<colon].lowercased() == "git@github.com" {
            path = remote[remote.index(after: colon)...]   // scp-like: git@github.com:o/n.git
        } else if let parsed = URLComponents(string: remote),
                  let scheme = parsed.scheme?.lowercased(), ["https", "http", "ssh", "git"].contains(scheme),
                  parsed.host?.lowercased() == "github.com" {
            path = Substring(parsed.path)
        } else {
            return nil
        }
        var parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count == 2 else { return nil }
        if parts[1].hasSuffix(".git") { parts[1].removeLast(4) }
        guard !parts[0].isEmpty, !parts[1].isEmpty else { return nil }
        return "\(parts[0])/\(parts[1])"
    }

    /// ISO 8601 in UTC with milliseconds, like `Date.prototype.toISOString`: 2026-10-16T10:00:00.000Z.
    static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}
