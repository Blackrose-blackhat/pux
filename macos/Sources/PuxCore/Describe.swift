import Foundation

/// One-line summary of a fix result, worded exactly like the CLI's `describeFixResult`
/// (src/commands/fix.ts); an engine error is its message.
public func describe(_ result: FixResultPayload) -> String {
    switch result {
    case let .noChanges(_, agentLabel):
        return "\(agentLabel) made no changes; no branch was created."
    case let .fixed(branch, _, files, _, pushed, agentLabel):
        let count = files.count == 1 ? "1 file" : "\(files.count) files"
        return "\(branch) · \(count) changed by \(agentLabel)\(pushed ? " · pushed" : "")"
    case let .error(message):
        return message
    }
}
