import Foundation

/// The next state for one action. Pure: `now` is the clock for everything time-based except
/// `.tick`, which carries its own date.
public func reduce(_ state: AppState, _ action: AppAction, now: Date) -> AppState {
    var s = state
    var clock = now

    switch action {
    case let .engineEvent(event):
        reduceEvent(&s, event, now: now)

    case .engineStarted:
        switch s.engine {
        case .starting, .offline, .missing: s.engine = .running(version: "")
        case .running: break
        }
    case .engineMissing:
        s.engine = .missing
    case let .engineExited(_, stderrTail, restartsInLastMinute):
        // Under the limit the supervisor restarts the engine; at it, stop and show why.
        s.engine = restartsInLastMinute >= 3 ? .offline(reason: stderrTail) : .starting

    case .hoverEntered:
        switch s.panel {
        case .collapsed, .autoDropped: s.panel = .peeking
        case .peeking, .pinned: break
        }
    case .hoverLeft:
        if s.panel == .peeking { s.panel = .collapsed }
    case .notchClicked:
        s.panel = s.panel == .pinned ? .collapsed : .pinned
    case .escapePressed, .clickedOutside:
        s.panel = .collapsed
        s.showingSettings = false
    case let .tabSelected(path):
        if s.repos.contains(where: { $0.path == path }) { s.selectedRepo = path }
    case .toggleSettings:
        s.showingSettings.toggle()

    case let .rerunRequested(repo):
        update(&s, repo) { $0.rerun = .running }
    case let .consentAnswered(repo):
        update(&s, repo) { $0.consent = nil }

    case let .tick(date):
        clock = date
        if case let .autoDropped(until) = s.panel, until <= date { s.panel = .collapsed }
        if let until = s.passedUntil, until <= date { s.passedUntil = nil }
    }

    s.mood = mood(of: s, at: clock)
    return s
}

// MARK: - Engine events

private func reduceEvent(_ s: inout AppState, _ event: ServeEvent, now: Date) {
    switch event {
    case let .hello(version):
        s.engine = .running(version: version)

    case let .repos(summaries):
        let existing = Dictionary(s.repos.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        s.repos = summaries.compactMap { summary in
            guard seen.insert(summary.repo).inserted else { return nil }
            var repo = existing[summary.repo] ?? RepoState(path: summary.repo)
            repo.repository = summary.repository
            return repo
        }
        sortRepos(&s)
        if s.selectedRepo.map({ path in !s.repos.contains { $0.path == path } }) ?? true {
            // The repo the panel dropped open for is gone: close it rather than show another.
            if s.selectedRepo != nil, case .autoDropped = s.panel { s.panel = .collapsed }
            s.selectedRepo = s.repos.first?.path
        }

    case let .state(path, repository, branch, commit, providers):
        // Workers can report before the supervisor's first `repos` event; `repos` prunes later.
        var passed = false
        upsert(&s, path) { repo in
            repo.repository = repository
            repo.branch = branch
            repo.commit = commit
            repo.providers = providers
            repo.worst = worst(of: providers)
            switch repo.worst {
            case .completed where repo.failure != nil || repo.recovering:
                repo.failure = nil
                repo.recovering = false
                repo.fix = .idle
                repo.rerun = .idle
                passed = true
            case .building where repo.failure != nil, .queued where repo.failure != nil:
                // The pipeline is running again: the failure is stale, but a pass still glows.
                repo.failure = nil
                repo.recovering = true
            case .failed:
                // Failed again; the `failure` event that follows takes over.
                repo.recovering = false
            default:
                break
            }
        }
        if passed { s.passedUntil = now + Timing.passedGlow }
        sortRepos(&s)

    case let .failure(path, pipeline, contextPath, errorWindow, failedStep, exitCode):
        upsert(&s, path) { repo in
            repo.failure = RepoFailure(pipeline: pipeline, contextPath: contextPath, errorWindow: errorWindow, failedStep: failedStep, exitCode: exitCode)
            repo.fix = .idle
            repo.rerun = .idle
            repo.recovering = false
        }
        sortRepos(&s)
        switch s.panel {
        case .pinned:
            break
        case .peeking:
            // The pointer is on the panel already: show the failure there without a timer.
            s.selectedRepo = path
        case .collapsed, .autoDropped:
            s.panel = .autoDropped(until: now + Timing.autoDrop)
            s.selectedRepo = path
        }

    case let .consentNeeded(path, repository, plan):
        upsert(&s, path) { repo in
            repo.repository = repository
            repo.consent = plan
        }
        sortRepos(&s)

    case let .fixProgress(path, stage, agent):
        update(&s, path) { $0.fix = .running(stage: stage, agent: agent) }
    case let .fixDone(path, result):
        update(&s, path) { $0.fix = .done(result) }
    case let .rerunDone(path, _, ok):
        update(&s, path) { $0.rerun = .done(ok: ok) }

    case let .error(path?, message):
        update(&s, path) { $0.lastError = message }
    case let .error(nil, message):
        // A global error before hello means the engine never started properly.
        if s.engine == .starting || s.engine == .running(version: "") { s.engine = .offline(reason: message) }
    }
}

// MARK: - Helpers

/// Applies `change` to a known repo; events for unknown repos are dropped.
private func update(_ s: inout AppState, _ path: String, _ change: (inout RepoState) -> Void) {
    guard let i = s.repos.firstIndex(where: { $0.path == path }) else { return }
    change(&s.repos[i])
}

/// Applies `change` to a repo, adding it first when it is not known yet.
private func upsert(_ s: inout AppState, _ path: String, _ change: (inout RepoState) -> Void) {
    if !s.repos.contains(where: { $0.path == path }) {
        s.repos.append(RepoState(path: path))
        if s.selectedRepo == nil { s.selectedRepo = path }
    }
    update(&s, path, change)
}

private func isFailed(_ repo: RepoState) -> Bool {
    repo.worst == .failed || repo.failure != nil
}

private func tier(_ repo: RepoState) -> Int {
    if isFailed(repo) { return 0 }
    switch repo.worst {
    case .building, .queued: return 1
    case .completed: return 2
    case .failed: return 0
    case .cancelled, nil: return 3
    }
}

private func sortRepos(_ s: inout AppState) {
    s.repos.sort { a, b in
        let (ta, tb) = (tier(a), tier(b))
        if ta != tb { return ta < tb }
        let (ra, rb) = (a.repository ?? "", b.repository ?? "")
        if ra != rb { return ra < rb }
        return a.path < b.path
    }
}

private func rank(_ status: PipelineStatus) -> Int {
    switch status {
    case .failed: return 4
    case .building: return 3
    case .queued: return 2
    case .completed: return 1
    case .cancelled: return 0
    }
}

private func worst(of providers: [ProviderSummary]) -> PipelineStatus? {
    var result: PipelineStatus?
    for summary in providers {
        guard case let .active(pipelines) = summary.snapshot else { continue }
        for pipeline in pipelines where result.map({ rank(pipeline.status) > rank($0) }) ?? true {
            result = pipeline.status
        }
    }
    return result
}

private func mood(of s: AppState, at date: Date) -> Mood {
    if s.repos.contains(where: isFailed) { return .failed }
    if let until = s.passedUntil, until > date { return .passed }
    if s.repos.contains(where: { $0.worst == .building || $0.worst == .queued }) { return .watching }
    return .idle
}
