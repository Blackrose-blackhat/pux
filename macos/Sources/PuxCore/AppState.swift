import Foundation

// The app's whole state and every input that can change it. `reduce` (Reducer.swift) is the
// only thing that produces a new `AppState`; the window and panel just render it.

public enum Timing {
    /// How long a failure drops the panel open on its own.
    public static let autoDrop: TimeInterval = 5
    /// How long the notch glows green after a failing repo passes again.
    public static let passedGlow: TimeInterval = 5
}

public enum Mood: Equatable, Sendable {
    case idle, watching, passed, failed
}

public enum PanelMode: Equatable, Sendable {
    case collapsed
    case peeking
    case pinned
    case autoDropped(until: Date)
}

public enum EngineStatus: Equatable, Sendable {
    case starting
    case running(version: String)
    case missing
    case offline(reason: String)
}

public struct RepoFailure: Equatable, Sendable {
    public var pipeline: Pipeline
    public var contextPath: String
    public var errorWindow: String
    public var failedStep: String?
    public var exitCode: Int?

    public init(pipeline: Pipeline, contextPath: String, errorWindow: String, failedStep: String?, exitCode: Int?) {
        self.pipeline = pipeline
        self.contextPath = contextPath
        self.errorWindow = errorWindow
        self.failedStep = failedStep
        self.exitCode = exitCode
    }
}

public enum FixStatus: Equatable, Sendable {
    case idle
    case running(stage: String, agent: String?)
    case done(FixResultPayload)
}

public enum RerunStatus: Equatable, Sendable {
    case idle, running
    case done(ok: Bool)
}

public struct RepoState: Equatable, Identifiable, Sendable {
    public var id: String { path }
    public var path: String
    public var repository: String?
    public var branch: String?
    public var commit: String?
    public var providers: [ProviderSummary]
    public var failure: RepoFailure?
    public var consent: AgentPlan?
    public var fix: FixStatus
    public var rerun: RerunStatus
    public var lastError: String?
    /// Worst status across every active provider's pipelines: failed > building > queued >
    /// completed > cancelled; nil when there are no pipelines. Kept in step with `providers` by `reduce`.
    public var worst: PipelineStatus?

    public init(path: String, repository: String? = nil, branch: String? = nil, commit: String? = nil,
                providers: [ProviderSummary] = [], failure: RepoFailure? = nil, consent: AgentPlan? = nil,
                fix: FixStatus = .idle, rerun: RerunStatus = .idle, lastError: String? = nil, worst: PipelineStatus? = nil) {
        self.path = path
        self.repository = repository
        self.branch = branch
        self.commit = commit
        self.providers = providers
        self.failure = failure
        self.consent = consent
        self.fix = fix
        self.rerun = rerun
        self.lastError = lastError
        self.worst = worst
    }
}

public struct AppState: Equatable, Sendable {
    public var engine: EngineStatus
    /// Sorted: failed, then building/queued, then passed, then idle; ties by repository, then path.
    public var repos: [RepoState]
    public var selectedRepo: String?
    public var panel: PanelMode
    public var mood: Mood
    public var passedUntil: Date?
    public var showingSettings: Bool

    public init(engine: EngineStatus, repos: [RepoState], selectedRepo: String?, panel: PanelMode, mood: Mood, passedUntil: Date?, showingSettings: Bool) {
        self.engine = engine
        self.repos = repos
        self.selectedRepo = selectedRepo
        self.panel = panel
        self.mood = mood
        self.passedUntil = passedUntil
        self.showingSettings = showingSettings
    }

    public static let initial = AppState(engine: .starting, repos: [], selectedRepo: nil, panel: .collapsed, mood: .idle, passedUntil: nil, showingSettings: false)
}

public enum AppAction: Equatable, Sendable {
    case engineEvent(ServeEvent)
    case engineStarted
    case engineMissing
    case engineExited(code: Int32, stderrTail: String, restartsInLastMinute: Int)
    case hoverEntered
    case hoverLeft
    case notchClicked
    case escapePressed
    case clickedOutside
    case tabSelected(String)
    case toggleSettings
    /// The user sent a `rerun` command for this repo; cleared by the engine's `rerun-done`.
    case rerunRequested(repo: String)
    /// The user answered the consent prompt (the view sends the `consent` command itself).
    case consentAnswered(repo: String)
    case tick(Date)
}
