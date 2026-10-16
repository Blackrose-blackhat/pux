import Foundation
import PuxCore

enum RepoProbeResult: Equatable {
    case ok(root: String, repository: String?)
    case notGit
    case noGitHubRemote(remote: String?)
}

/// Finds the repository a folder belongs to and its GitHub `owner/name`, with `/usr/bin/git`.
enum RepoProbe {
    /// Off the main thread. `git -C path rev-parse --show-toplevel`, then `git -C root remote get-url origin`.
    static func probe(_ path: String) async -> RepoProbeResult {
        await Task.detached(priority: .userInitiated) { probeNow(path) }.value
    }

    private static func probeNow(_ path: String) -> RepoProbeResult {
        guard let root = git(["-C", path, "rev-parse", "--show-toplevel"]) else { return .notGit }
        guard let remote = git(["-C", root, "remote", "get-url", "origin"]) else { return .noGitHubRemote(remote: nil) }
        guard let slug = Registry.repositorySlug(fromRemote: remote) else { return .noGitHubRemote(remote: remote) }
        return .ok(root: root, repository: slug)
    }

    /// The command's trimmed stdout, or nil when it fails or prints nothing.
    private static func git(_ arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        var env = ProcessInfo.processInfo.environment
        env["GIT_TERMINAL_PROMPT"] = "0"
        process.environment = env
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return nil
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }
}
