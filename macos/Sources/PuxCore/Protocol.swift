import Foundation

// Swift mirror of the JSON-lines protocol `pux serve` speaks (src/serve/protocol.ts).
// Field names are the contract and must match the TypeScript side character for character;
// JSON `null` and absent fields both decode to `nil`.

// MARK: - Pipelines (src/providers/types.ts)

public enum PipelineStatus: String, Codable, Equatable, Sendable {
    case queued, building, completed, failed, cancelled
}

public struct PipelineStep: Codable, Equatable, Sendable {
    public let name: String
    public let status: String

    public init(name: String, status: String) {
        self.name = name
        self.status = status
    }
}

public struct Pipeline: Codable, Equatable, Sendable {
    /// `"github-actions"` or `"vercel"`.
    public let provider: String
    public let id: String
    public let name: String
    public let status: PipelineStatus
    public let actor: String?
    public let url: String?
    /// Short commit hash for display.
    public let commit: String?
    /// Full commit SHA the pipeline ran for, when the provider exposes it.
    public let commitSha: String?
    /// ISO timestamp the pipeline started.
    public let startedAt: String?
    public let steps: [PipelineStep]?

    public init(provider: String, id: String, name: String, status: PipelineStatus, actor: String?, url: String?, commit: String?, commitSha: String?, startedAt: String?, steps: [PipelineStep]?) {
        self.provider = provider
        self.id = id
        self.name = name
        self.status = status
        self.actor = actor
        self.url = url
        self.commit = commit
        self.commitSha = commitSha
        self.startedAt = startedAt
        self.steps = steps
    }
}

public enum ProviderSnapshot: Codable, Equatable, Sendable {
    case unavailable
    case waiting
    case active([Pipeline])

    private enum CodingKeys: String, CodingKey { case kind, pipelines }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        switch kind {
        case "unavailable": self = .unavailable
        case "waiting": self = .waiting
        case "active": self = .active(try c.decode([Pipeline].self, forKey: .pipelines))
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown snapshot kind \(kind)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .unavailable: try c.encode("unavailable", forKey: .kind)
        case .waiting: try c.encode("waiting", forKey: .kind)
        case let .active(pipelines):
            try c.encode("active", forKey: .kind)
            try c.encode(pipelines, forKey: .pipelines)
        }
    }
}

// MARK: - Summaries (src/serve/protocol.ts)

public struct ProviderSummary: Codable, Equatable, Sendable {
    public let provider: String
    public let snapshot: ProviderSnapshot

    public init(provider: String, snapshot: ProviderSnapshot) {
        self.provider = provider
        self.snapshot = snapshot
    }
}

public struct RepoSummary: Codable, Equatable, Sendable {
    public let repo: String
    public let repository: String?
    public let addedAt: String

    public init(repo: String, repository: String?, addedAt: String) {
        self.repo = repo
        self.repository = repository
        self.addedAt = addedAt
    }
}

// MARK: - Agent instructions (src/agents/instructions.ts)

public struct AgentPlanEntry: Codable, Equatable, Sendable {
    public let agent: String
    /// Path relative to the repository root.
    public let path: String
    /// `"create"`, `"append"` or `"present"`.
    public let action: String

    public init(agent: String, path: String, action: String) {
        self.agent = agent
        self.path = path
        self.action = action
    }
}

public struct AgentPlan: Codable, Equatable, Sendable {
    public let entries: [AgentPlanEntry]

    public init(entries: [AgentPlanEntry]) {
        self.entries = entries
    }
}

// MARK: - Fix results (src/agents/fix.ts)

/// The `result` of a `fix-done` event: a `FixResult` or `{ kind: "error", message }`.
/// The agent is reduced to its display label (`result.agent.label`).
public enum FixResultPayload: Codable, Equatable, Sendable {
    case fixed(branch: String, commit: String, files: [String], explanation: String?, pushed: Bool, agentLabel: String)
    case noChanges(explanation: String?, agentLabel: String)
    case error(message: String)

    private enum CodingKeys: String, CodingKey { case kind, agent, branch, commit, files, explanation, pushed, message }
    private enum AgentKeys: String, CodingKey { case label }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        switch kind {
        case "fixed":
            self = .fixed(
                branch: try c.decode(String.self, forKey: .branch),
                commit: try c.decode(String.self, forKey: .commit),
                files: try c.decode([String].self, forKey: .files),
                explanation: try c.decodeIfPresent(String.self, forKey: .explanation),
                pushed: try c.decode(Bool.self, forKey: .pushed),
                agentLabel: try Self.agentLabel(c))
        case "no-changes":
            self = .noChanges(
                explanation: try c.decodeIfPresent(String.self, forKey: .explanation),
                agentLabel: try Self.agentLabel(c))
        case "error":
            self = .error(message: try c.decode(String.self, forKey: .message))
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown fix result kind \(kind)")
        }
    }

    private static func agentLabel(_ c: KeyedDecodingContainer<CodingKeys>) throws -> String {
        try c.nestedContainer(keyedBy: AgentKeys.self, forKey: .agent).decode(String.self, forKey: .label)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .fixed(branch, commit, files, explanation, pushed, agentLabel):
            try c.encode("fixed", forKey: .kind)
            var agent = c.nestedContainer(keyedBy: AgentKeys.self, forKey: .agent)
            try agent.encode(agentLabel, forKey: .label)
            try c.encode(branch, forKey: .branch)
            try c.encode(commit, forKey: .commit)
            try c.encode(files, forKey: .files)
            try c.encode(explanation, forKey: .explanation)
            try c.encode(pushed, forKey: .pushed)
        case let .noChanges(explanation, agentLabel):
            try c.encode("no-changes", forKey: .kind)
            var agent = c.nestedContainer(keyedBy: AgentKeys.self, forKey: .agent)
            try agent.encode(agentLabel, forKey: .label)
            try c.encode(explanation, forKey: .explanation)
        case let .error(message):
            try c.encode("error", forKey: .kind)
            try c.encode(message, forKey: .message)
        }
    }
}

// MARK: - Events (serve -> bar)

public enum ServeEvent: Equatable, Sendable {
    case hello(version: String)
    case repos([RepoSummary])
    case state(repo: String, repository: String?, branch: String?, commit: String?, providers: [ProviderSummary])
    case failure(repo: String, pipeline: Pipeline, contextPath: String, errorWindow: String, failedStep: String?, exitCode: Int?)
    case consentNeeded(repo: String, repository: String, plan: AgentPlan)
    /// `stage` is `starting`, `branch`, `agent`, `commit` or `push`.
    case fixProgress(repo: String, stage: String, agent: String?)
    case fixDone(repo: String, result: FixResultPayload)
    case rerunDone(repo: String, pipelineId: String, ok: Bool)
    case error(repo: String?, message: String)
}

extension ServeEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, version, repos, repo, repository, branch, commit, providers, pipeline, contextPath, errorWindow, failedStep, exitCode, plan, stage, agent, result, pipelineId, ok, message
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "hello":
            self = .hello(version: try c.decode(String.self, forKey: .version))
        case "repos":
            self = .repos(try c.decode([RepoSummary].self, forKey: .repos))
        case "state":
            self = .state(
                repo: try c.decode(String.self, forKey: .repo),
                repository: try c.decodeIfPresent(String.self, forKey: .repository),
                branch: try c.decodeIfPresent(String.self, forKey: .branch),
                commit: try c.decodeIfPresent(String.self, forKey: .commit),
                providers: try c.decode([ProviderSummary].self, forKey: .providers))
        case "failure":
            self = .failure(
                repo: try c.decode(String.self, forKey: .repo),
                pipeline: try c.decode(Pipeline.self, forKey: .pipeline),
                contextPath: try c.decode(String.self, forKey: .contextPath),
                errorWindow: try c.decode(String.self, forKey: .errorWindow),
                failedStep: try c.decodeIfPresent(String.self, forKey: .failedStep),
                exitCode: try c.decodeIfPresent(Int.self, forKey: .exitCode))
        case "consent-needed":
            self = .consentNeeded(
                repo: try c.decode(String.self, forKey: .repo),
                repository: try c.decode(String.self, forKey: .repository),
                plan: try c.decode(AgentPlan.self, forKey: .plan))
        case "fix-progress":
            self = .fixProgress(
                repo: try c.decode(String.self, forKey: .repo),
                stage: try c.decode(String.self, forKey: .stage),
                agent: try c.decodeIfPresent(String.self, forKey: .agent))
        case "fix-done":
            self = .fixDone(
                repo: try c.decode(String.self, forKey: .repo),
                result: try c.decode(FixResultPayload.self, forKey: .result))
        case "rerun-done":
            self = .rerunDone(
                repo: try c.decode(String.self, forKey: .repo),
                pipelineId: try c.decode(String.self, forKey: .pipelineId),
                ok: try c.decode(Bool.self, forKey: .ok))
        case "error":
            self = .error(
                repo: try c.decodeIfPresent(String.self, forKey: .repo),
                message: try c.decode(String.self, forKey: .message))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown event type \(type)")
        }
    }
}

// MARK: - Commands (bar -> serve)

public enum ServeCommand: Encodable, Equatable, Sendable {
    case rerun(repo: String, pipelineId: String)
    case fix(repo: String, agent: String?, push: Bool?)
    case consent(repo: String, repository: String, allow: Bool)
    case removeRepo(repo: String)
    case shutdown

    private enum CodingKeys: String, CodingKey { case type, repo, pipelineId, agent, push, repository, allow }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .rerun(repo, pipelineId):
            try c.encode("rerun", forKey: .type)
            try c.encode(repo, forKey: .repo)
            try c.encode(pipelineId, forKey: .pipelineId)
        case let .fix(repo, agent, push):
            try c.encode("fix", forKey: .type)
            try c.encode(repo, forKey: .repo)
            // The engine's schema treats these as optional, not nullable: omit when absent.
            try c.encodeIfPresent(agent, forKey: .agent)
            try c.encodeIfPresent(push, forKey: .push)
        case let .consent(repo, repository, allow):
            try c.encode("consent", forKey: .type)
            try c.encode(repo, forKey: .repo)
            try c.encode(repository, forKey: .repository)
            try c.encode(allow, forKey: .allow)
        case let .removeRepo(repo):
            try c.encode("remove-repo", forKey: .type)
            try c.encode(repo, forKey: .repo)
        case .shutdown:
            try c.encode("shutdown", forKey: .type)
        }
    }
}

// MARK: - Codec

public enum ProtocolCodec {
    /// Decodes one stdout line from `pux serve`. Throws on malformed JSON, an unknown `type`,
    /// or a missing or mistyped field.
    public static func decode(line: String) throws -> ServeEvent {
        try JSONDecoder().decode(ServeEvent.self, from: Data(line.utf8))
    }

    /// One command as a single compact JSON line, newline included. Keys are written in
    /// declaration order (`type` first) so the output is stable byte for byte; the JSON is
    /// built by hand rather than with JSONEncoder, whose key order is not guaranteed on every
    /// supported macOS release.
    public static func encode(_ c: ServeCommand) -> String {
        var fields: [(String, String)] = []
        switch c {
        case let .rerun(repo, pipelineId):
            fields = [("type", string("rerun")), ("repo", string(repo)), ("pipelineId", string(pipelineId))]
        case let .fix(repo, agent, push):
            fields = [("type", string("fix")), ("repo", string(repo))]
            if let agent { fields.append(("agent", string(agent))) }
            if let push { fields.append(("push", push ? "true" : "false")) }
        case let .consent(repo, repository, allow):
            fields = [("type", string("consent")), ("repo", string(repo)), ("repository", string(repository)), ("allow", allow ? "true" : "false")]
        case let .removeRepo(repo):
            fields = [("type", string("remove-repo")), ("repo", string(repo))]
        case .shutdown:
            fields = [("type", string("shutdown"))]
        }
        return "{" + fields.map { "\(string($0.0)):\($0.1)" }.joined(separator: ",") + "}\n"
    }

    /// A JSON string literal, escaped the way `JSON.stringify` does it.
    private static func string(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case _ where scalar.value < 0x20:
                out += String(format: "\\u%04x", scalar.value)
            default:
                out.unicodeScalars.append(scalar)
            }
        }
        return out + "\""
    }
}
