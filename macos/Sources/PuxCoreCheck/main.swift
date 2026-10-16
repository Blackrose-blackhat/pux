import Foundation
import PuxCore

check("runner reports a pass") {
  try expectEqual(1 + 1, 2)
}

check("decodes a state event with an active snapshot") {
  let e = try ProtocolCodec.decode(line: #"{"type":"state","repo":"/r","repository":"u/r","branch":"main","commit":"abc","providers":[{"provider":"GitHub Actions","snapshot":{"kind":"active","pipelines":[{"provider":"github-actions","id":"1","name":"CI","status":"failed","actor":null,"url":null,"commit":"abc","commitSha":"abc","startedAt":null,"steps":[{"name":"test","status":"failed"}]}]}}]}"#)
  guard case let .state(repo, _, _, _, providers) = e else { throw CheckError("wrong case") }
  try expectEqual(repo, "/r")
  guard case let .active(pipelines) = providers[0].snapshot else { throw CheckError("not active") }
  try expectEqual(pipelines[0].status, .failed)
}

check("decodes a state event with null fields and waiting / unavailable snapshots") {
  let e = try ProtocolCodec.decode(line: #"{"type":"state","repo":"/r","repository":null,"branch":null,"commit":null,"providers":[{"provider":"Vercel","snapshot":{"kind":"waiting"}},{"provider":"GitHub Actions","snapshot":{"kind":"unavailable"}}]}"#)
  try expectEqual(e, .state(repo: "/r", repository: nil, branch: nil, commit: nil, providers: [
    ProviderSummary(provider: "Vercel", snapshot: .waiting),
    ProviderSummary(provider: "GitHub Actions", snapshot: .unavailable),
  ]))
}

check("decodes failure, consent-needed, fix-done (fixed / no-changes / error), rerun-done, error, hello, repos") {
  // failure: pipeline without the optional commit / steps keys
  let failure = try ProtocolCodec.decode(line: #"{"type":"failure","repo":"/r","pipeline":{"provider":"vercel","id":"dpl_1","name":"web","status":"failed","actor":"me","url":"https://x","commitSha":null,"startedAt":"2026-10-16T10:00:00.000Z"},"contextPath":"/r/.ai-context/failure.md","errorWindow":"boom","failedStep":null,"exitCode":1}"#)
  try expectEqual(failure, .failure(
    repo: "/r",
    pipeline: Pipeline(provider: "vercel", id: "dpl_1", name: "web", status: .failed, actor: "me", url: "https://x", commit: nil, commitSha: nil, startedAt: "2026-10-16T10:00:00.000Z", steps: nil),
    contextPath: "/r/.ai-context/failure.md", errorWindow: "boom", failedStep: nil, exitCode: 1))

  let consent = try ProtocolCodec.decode(line: #"{"type":"consent-needed","repo":"/r","repository":"u/r","plan":{"entries":[{"agent":"Claude Code","path":"CLAUDE.md","action":"append"},{"agent":"Cursor","path":".cursor/rules/pux.mdc","action":"create"}]}}"#)
  try expectEqual(consent, .consentNeeded(repo: "/r", repository: "u/r", plan: AgentPlan(entries: [
    AgentPlanEntry(agent: "Claude Code", path: "CLAUDE.md", action: "append"),
    AgentPlanEntry(agent: "Cursor", path: ".cursor/rules/pux.mdc", action: "create"),
  ])))

  let progress = try ProtocolCodec.decode(line: #"{"type":"fix-progress","repo":"/r","stage":"agent","agent":"Claude Code"}"#)
  try expectEqual(progress, .fixProgress(repo: "/r", stage: "agent", agent: "Claude Code"))
  let starting = try ProtocolCodec.decode(line: #"{"type":"fix-progress","repo":"/r","stage":"starting","agent":null}"#)
  try expectEqual(starting, .fixProgress(repo: "/r", stage: "starting", agent: nil))

  let fixed = try ProtocolCodec.decode(line: #"{"type":"fix-done","repo":"/r","result":{"kind":"fixed","agent":{"id":"claude","label":"Claude Code","binary":"claude"},"branch":"pux/fix-1","commit":"def","files":["a.ts","b.ts"],"explanation":"fixed it","pushed":true}}"#)
  try expectEqual(fixed, .fixDone(repo: "/r", result: .fixed(branch: "pux/fix-1", commit: "def", files: ["a.ts", "b.ts"], explanation: "fixed it", pushed: true, agentLabel: "Claude Code")))

  let noChanges = try ProtocolCodec.decode(line: #"{"type":"fix-done","repo":"/r","result":{"kind":"no-changes","agent":{"id":"codex","label":"Codex","binary":"codex"},"explanation":null}}"#)
  try expectEqual(noChanges, .fixDone(repo: "/r", result: .noChanges(explanation: nil, agentLabel: "Codex")))

  let fixError = try ProtocolCodec.decode(line: #"{"type":"fix-done","repo":"/r","result":{"kind":"error","message":"no agent installed"}}"#)
  try expectEqual(fixError, .fixDone(repo: "/r", result: .error(message: "no agent installed")))

  let rerun = try ProtocolCodec.decode(line: #"{"type":"rerun-done","repo":"/r","pipelineId":"1","ok":true}"#)
  try expectEqual(rerun, .rerunDone(repo: "/r", pipelineId: "1", ok: true))

  let error = try ProtocolCodec.decode(line: #"{"type":"error","repo":"/r","message":"bad"}"#)
  try expectEqual(error, .error(repo: "/r", message: "bad"))
  let globalError = try ProtocolCodec.decode(line: #"{"type":"error","message":"unknown command"}"#)
  try expectEqual(globalError, .error(repo: nil, message: "unknown command"))

  let hello = try ProtocolCodec.decode(line: #"{"type":"hello","version":"0.1.5"}"#)
  try expectEqual(hello, .hello(version: "0.1.5"))

  let repos = try ProtocolCodec.decode(line: #"{"type":"repos","repos":[{"repo":"/r","repository":"u/r","addedAt":"2026-10-16T10:00:00.000Z"},{"repo":"/s","repository":null,"addedAt":"2026-10-16T11:00:00.000Z"}]}"#)
  try expectEqual(repos, .repos([
    RepoSummary(repo: "/r", repository: "u/r", addedAt: "2026-10-16T10:00:00.000Z"),
    RepoSummary(repo: "/s", repository: nil, addedAt: "2026-10-16T11:00:00.000Z"),
  ]))
}

check("decodes a line with a trailing newline") {
  try expectEqual(try ProtocolCodec.decode(line: #"{"type":"hello","version":"1"}"# + "\n"), .hello(version: "1"))
}

check("encodes commands with the engine's key names") {
  try expectEqual(ProtocolCodec.encode(.removeRepo(repo: "/r")), #"{"type":"remove-repo","repo":"/r"}"# + "\n")
  try expectEqual(ProtocolCodec.encode(.rerun(repo: "/r", pipelineId: "1")), #"{"type":"rerun","repo":"/r","pipelineId":"1"}"# + "\n")
}

check("encodes fix, consent and shutdown, omitting absent optional fields") {
  try expectEqual(ProtocolCodec.encode(.fix(repo: "/r", agent: nil, push: nil)), #"{"type":"fix","repo":"/r"}"# + "\n")
  try expectEqual(ProtocolCodec.encode(.fix(repo: "/r", agent: "codex", push: true)), #"{"type":"fix","repo":"/r","agent":"codex","push":true}"# + "\n")
  try expectEqual(ProtocolCodec.encode(.consent(repo: "/r", repository: "u/r", allow: false)), #"{"type":"consent","repo":"/r","repository":"u/r","allow":false}"# + "\n")
  try expectEqual(ProtocolCodec.encode(.shutdown), #"{"type":"shutdown"}"# + "\n")
}

check("escapes strings the way JSON.stringify does") {
  try expectEqual(ProtocolCodec.encode(.removeRepo(repo: "a\"b\\c\n\u{01}/é")), #"{"type":"remove-repo","repo":"a\"b\\c\n\u0001/é"}"# + "\n")
}

check("rejects an unknown type") { try expect((try? ProtocolCodec.decode(line: #"{"type":"nope"}"#)) == nil) }

check("rejects malformed JSON and missing fields") {
  try expect((try? ProtocolCodec.decode(line: "not json")) == nil)
  try expect((try? ProtocolCodec.decode(line: #"{"type":"rerun-done","repo":"/r"}"#)) == nil)
  try expect((try? ProtocolCodec.decode(line: #"{"type":"state","repo":"/r","repository":null,"branch":null,"commit":null,"providers":[{"provider":"x","snapshot":{"kind":"weird"}}]}"#)) == nil)
}

check("notched display: window is flush with the hardware notch") {
  let m = ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1512, height: 982), safeAreaTop: 32,
                        auxiliaryTopLeft: CGRect(x: 0, y: 950, width: 656, height: 32), auxiliaryTopRight: CGRect(x: 856, y: 950, width: 656, height: 32))
  let l = NotchGeometry.layout(for: m)
  try expect(l.hasNotch); try expectEqual(l.notchRect, CGRect(x: 656, y: 950, width: 200, height: 32))
  try expectEqual(l.windowFrame, CGRect(x: 576, y: 982 - 272, width: 360, height: 272))
}

check("plain display: centred 160x30 pill") {
  let m = ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 2560, height: 1440), safeAreaTop: 0, auxiliaryTopLeft: nil, auxiliaryTopRight: nil)
  let l = NotchGeometry.layout(for: m)
  try expect(!l.hasNotch); try expectEqual(l.notchRect, CGRect(x: 1200, y: 1410, width: 160, height: 30))
  try expectEqual(l.windowFrame.size, CGSize(width: 360, height: 270))
}

check("collapsed rect: ears beside a hardware notch, the bare pill otherwise") {
  let notched = NotchGeometry.layout(for: ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1512, height: 982), safeAreaTop: 32,
                        auxiliaryTopLeft: CGRect(x: 0, y: 950, width: 656, height: 32), auxiliaryTopRight: CGRect(x: 856, y: 950, width: 656, height: 32)))
  try expectEqual(notched.collapsedRect, CGRect(x: 656 - 44, y: 950, width: 200 + 88, height: 32))
  let plain = NotchGeometry.layout(for: ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 2560, height: 1440), safeAreaTop: 0, auxiliaryTopLeft: nil, auxiliaryTopRight: nil))
  try expectEqual(plain.collapsedRect, plain.notchRect)
}

// MARK: - Reducer

let t0 = Date(timeIntervalSince1970: 1_000_000)

func apply(_ actions: [AppAction], from start: AppState = .initial, now: Date = t0) -> AppState {
  var state = start
  for action in actions { state = reduce(state, action, now: now) }
  return state
}

func pipe(_ id: String, _ status: PipelineStatus) -> Pipeline {
  Pipeline(provider: "github-actions", id: id, name: "CI", status: status, actor: nil, url: nil, commit: "abc", commitSha: nil, startedAt: nil, steps: nil)
}

func stateEvent(_ repo: String, _ repository: String?, _ statuses: [PipelineStatus]) -> AppAction {
  let pipelines = statuses.enumerated().map { pipe(String($0.offset + 1), $0.element) }
  return .engineEvent(.state(repo: repo, repository: repository, branch: "main", commit: "abc",
                             providers: [ProviderSummary(provider: "GitHub Actions", snapshot: .active(pipelines)),
                                         ProviderSummary(provider: "Vercel", snapshot: .waiting)]))
}

func failureEvent(_ repo: String) -> AppAction {
  .engineEvent(.failure(repo: repo, pipeline: pipe("1", .failed), contextPath: repo + "/.ai-context/failure.md", errorWindow: "boom", failedStep: "test", exitCode: 1))
}

func reposEvent(_ repos: [(String, String?)]) -> AppAction {
  .engineEvent(.repos(repos.map { RepoSummary(repo: $0.0, repository: $0.1, addedAt: "2026-10-16T10:00:00.000Z") }))
}

check("failed repo sorts first and is auto-selected") {
  let s = apply([reposEvent([("/a", "u/a"), ("/b", "u/b")]), stateEvent("/a", "u/a", [.completed]), stateEvent("/b", "u/b", [.failed]), failureEvent("/b")])
  try expectEqual(s.repos.map(\.path), ["/b", "/a"])
  try expectEqual(s.repos[0].worst, .failed)
  try expect(s.repos[0].failure != nil, "failure recorded")
  try expectEqual(s.selectedRepo, "/b")
  try expectEqual(s.panel, .autoDropped(until: t0 + 5))
  try expectEqual(s.mood, .failed)
}

check("a failure while pinned does not steal selection or unpin") {
  let pinned = apply([reposEvent([("/a", "u/a"), ("/b", "u/b")]), stateEvent("/a", "u/a", [.completed]), stateEvent("/b", "u/b", [.completed]),
                      .tabSelected("/a"), .notchClicked])
  try expectEqual(pinned.panel, .pinned)
  let s = apply([stateEvent("/b", "u/b", [.failed]), failureEvent("/b")], from: pinned)
  try expectEqual(s.panel, .pinned)
  try expectEqual(s.selectedRepo, "/a")
  try expectEqual(s.repos.map(\.path), ["/b", "/a"])
  try expect(s.repos[0].failure != nil, "failure still recorded on /b")
  try expectEqual(s.mood, .failed)
}

check("passed glow lasts five seconds then idle") {
  let s = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.failed]), failureEvent("/a"), stateEvent("/a", "u/a", [.completed])])
  try expectEqual(s.mood, .passed)
  try expectEqual(s.repos[0].failure, nil)
  try expectEqual(s.repos[0].fix, .idle)
  try expectEqual(s.repos[0].rerun, .idle)
  try expectEqual(s.passedUntil, t0 + 5)
  let during = apply([.tick(t0 + 4)], from: s)
  try expectEqual(during.mood, .passed)
  let after = apply([.tick(t0 + 6)], from: s)
  try expectEqual(after.mood, .idle)
  try expectEqual(after.passedUntil, nil)
}

check("hover peeks, leave collapses, click pins, escape unpins") {
  var s = apply([.hoverEntered])
  try expectEqual(s.panel, .peeking)
  s = apply([.hoverLeft], from: s)
  try expectEqual(s.panel, .collapsed)
  s = apply([.hoverEntered, .notchClicked], from: s)
  try expectEqual(s.panel, .pinned)
  s = apply([.hoverLeft, .hoverEntered], from: s)
  try expectEqual(s.panel, .pinned)
  s = apply([.toggleSettings], from: s)
  try expect(s.showingSettings, "settings shown")
  s = apply([.escapePressed], from: s)
  try expectEqual(s.panel, .collapsed)
  try expect(!s.showingSettings, "escape hides settings")
  s = apply([.notchClicked], from: s)
  try expectEqual(s.panel, .pinned)
  s = apply([.notchClicked], from: s)
  try expectEqual(s.panel, .collapsed)
  s = apply([.notchClicked, .toggleSettings, .clickedOutside], from: s)
  try expectEqual(s.panel, .collapsed)
  try expect(!s.showingSettings, "click outside hides settings")
}

check("tick expires auto-drop") {
  let dropped = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.failed]), failureEvent("/a")])
  try expectEqual(dropped.panel, .autoDropped(until: t0 + 5))
  try expectEqual(apply([.tick(t0 + 4.9)], from: dropped).panel, .autoDropped(until: t0 + 5))
  try expectEqual(apply([.tick(t0 + 5.1)], from: dropped).panel, .collapsed)
  // Hovering the dropped panel keeps it open past the timer; clicking it pins it.
  try expectEqual(apply([.hoverEntered, .tick(t0 + 5.1)], from: dropped).panel, .peeking)
  try expectEqual(apply([.notchClicked, .tick(t0 + 5.1)], from: dropped).panel, .pinned)
}

check("three fast engine exits go offline with the stderr line") {
  let tail = "error: unknown command 'serve'"
  var s = apply([.engineStarted])
  try expectEqual(s.engine, .running(version: ""))
  s = apply([.engineEvent(.hello(version: "0.1.5"))], from: s)
  try expectEqual(s.engine, .running(version: "0.1.5"))
  s = apply([.engineExited(code: 1, stderrTail: tail, restartsInLastMinute: 1)], from: s)
  try expectEqual(s.engine, .starting)
  s = apply([.engineStarted, .engineExited(code: 1, stderrTail: tail, restartsInLastMinute: 2)], from: s)
  try expectEqual(s.engine, .starting)
  s = apply([.engineStarted, .engineExited(code: 1, stderrTail: tail, restartsInLastMinute: 3)], from: s)
  try expectEqual(s.engine, .offline(reason: tail))
  try expectEqual(apply([.engineMissing]).engine, .missing)
}

check("repos event removes vanished repos and keeps order stable") {
  var s = apply([reposEvent([("/c", "u/c"), ("/a", "u/a"), ("/b", "u/b")])])
  try expectEqual(s.repos.map(\.path), ["/a", "/b", "/c"])
  try expectEqual(s.selectedRepo, "/a")
  s = apply([stateEvent("/a", "u/a", [.completed]), stateEvent("/c", "u/c", [.completed]), .tabSelected("/b"), .tabSelected("/nope")], from: s)
  try expectEqual(s.selectedRepo, "/b")
  s = apply([reposEvent([("/c", "u/c"), ("/a", "u/a")])], from: s)
  try expectEqual(s.repos.map(\.path), ["/a", "/c"])
  try expectEqual(s.selectedRepo, "/a")
  try expectEqual(s.repos[0].worst, .completed)
  try expectEqual(s.repos[0].branch, "main")
  // The same list again changes nothing.
  try expectEqual(apply([reposEvent([("/a", "u/a"), ("/c", "u/c")])], from: s), s)
  // Ties on tier fall back to repository, then path.
  let t = apply([reposEvent([("/z", nil), ("/y", "u/a"), ("/x", "u/a")])])
  try expectEqual(t.repos.map(\.path), ["/z", "/x", "/y"])
  try expectEqual(apply([reposEvent([])], from: s).selectedRepo, nil)
}

check("rerun that passes clears failure so Fix is unavailable") {
  var s = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.failed]), failureEvent("/a"), .rerunRequested(repo: "/a")])
  try expectEqual(s.repos[0].rerun, .running)
  s = apply([.engineEvent(.rerunDone(repo: "/a", pipelineId: "1", ok: true))], from: s)
  try expectEqual(s.repos[0].rerun, .done(ok: true))
  try expect(s.repos[0].failure != nil, "rerun-done alone keeps the failure")
  s = apply([stateEvent("/a", "u/a", [.completed])], from: s)
  try expectEqual(s.repos[0].failure, nil)
  try expectEqual(s.mood, .passed)
  // Through building: the running pipeline clears the failure, the pass then glows.
  let b = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.failed]), failureEvent("/a"),
                 .engineEvent(.rerunDone(repo: "/a", pipelineId: "1", ok: true)), stateEvent("/a", "u/a", [.building])])
  try expectEqual(b.repos[0].failure, nil)
  try expectEqual(b.passedUntil, nil)
  try expectEqual(b.mood, .watching)
}

check("rerun that passes after building still glows green") {
  var s = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.failed]), failureEvent("/a"),
                 .engineEvent(.rerunDone(repo: "/a", pipelineId: "1", ok: true)), stateEvent("/a", "u/a", [.building])])
  try expectEqual(s.repos[0].failure, nil)
  try expectEqual(s.mood, .watching)
  s = apply([stateEvent("/a", "u/a", [.completed])], from: s)
  try expectEqual(s.mood, .passed)
  try expectEqual(s.passedUntil, t0 + 5)
  try expectEqual(s.repos[0].rerun, .idle)
  try expectEqual(s.repos[0].fix, .idle)
  try expectEqual(apply([.tick(t0 + 6)], from: s).mood, .idle)
  // A completed state after the glow has been used up does not glow again.
  try expectEqual(apply([.tick(t0 + 6), stateEvent("/a", "u/a", [.completed])], from: s).mood, .idle)
}

check("failure while peeking keeps the panel peeking") {
  let peeking = apply([reposEvent([("/a", "u/a"), ("/b", "u/b")]), stateEvent("/a", "u/a", [.completed]), stateEvent("/b", "u/b", [.completed]),
                       .hoverEntered])
  try expectEqual(peeking.panel, .peeking)
  try expectEqual(peeking.selectedRepo, "/a")
  let s = apply([stateEvent("/b", "u/b", [.failed]), failureEvent("/b")], from: peeking)
  try expectEqual(s.panel, .peeking)
  try expectEqual(s.selectedRepo, "/b")
  try expectEqual(s.mood, .failed)
  // An already dropped panel restarts its timer on a second failure.
  let first = apply([.hoverLeft, failureEvent("/b")], from: peeking)
  try expectEqual(first.panel, .autoDropped(until: t0 + 5))
  let again = apply([failureEvent("/a")], from: first, now: t0 + 3)
  try expectEqual(again.panel, .autoDropped(until: t0 + 8))
}

check("global error before hello goes offline, after hello is ignored") {
  let started = apply([.engineStarted])
  try expectEqual(started.engine, .running(version: ""))
  try expectEqual(apply([.engineEvent(.error(repo: nil, message: "boom"))], from: started).engine, .offline(reason: "boom"))
  try expectEqual(apply([.engineEvent(.error(repo: nil, message: "boom"))]).engine, .offline(reason: "boom"))
  let hello = apply([.engineEvent(.hello(version: "0.1.5"))], from: started)
  try expectEqual(apply([.engineEvent(.error(repo: nil, message: "boom"))], from: hello).engine, .running(version: "0.1.5"))
}

check("removing the auto-dropped repo collapses the panel") {
  let dropped = apply([reposEvent([("/a", "u/a"), ("/b", "u/b")]), stateEvent("/b", "u/b", [.failed]), failureEvent("/b")])
  try expectEqual(dropped.panel, .autoDropped(until: t0 + 5))
  let s = apply([reposEvent([("/a", "u/a")])], from: dropped)
  try expectEqual(s.panel, .collapsed)
  try expectEqual(s.selectedRepo, "/a")
  // Removing some other repo leaves the drop alone; pinned and peeking are never touched.
  try expectEqual(apply([reposEvent([("/b", "u/b")])], from: dropped).panel, .autoDropped(until: t0 + 5))
  try expectEqual(apply([.notchClicked, reposEvent([("/a", "u/a")])], from: dropped).panel, .pinned)
  try expectEqual(apply([.hoverEntered, reposEvent([("/a", "u/a")])], from: dropped).panel, .peeking)
  // Duplicate paths in one event collapse to the first occurrence.
  let dup = apply([.engineEvent(.repos([RepoSummary(repo: "/a", repository: "u/a", addedAt: "x"), RepoSummary(repo: "/a", repository: "u/z", addedAt: "y")]))])
  try expectEqual(dup.repos.map(\.path), ["/a"])
  try expectEqual(dup.repos[0].repository, "u/a")
}

check("engine errors, consent and fix progress land on their repo") {
  let plan = AgentPlan(entries: [AgentPlanEntry(agent: "Claude Code", path: "CLAUDE.md", action: "append")])
  var s = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.failed, .queued, .completed]), failureEvent("/a")])
  try expectEqual(s.repos[0].worst, .failed)
  s = apply([.engineEvent(.consentNeeded(repo: "/a", repository: "u/a", plan: plan)), stateEvent("/a", "u/a", [.failed])], from: s)
  try expectEqual(s.repos[0].consent, plan)
  s = apply([.consentAnswered(repo: "/a")], from: s)
  try expectEqual(s.repos[0].consent, nil)
  s = apply([.engineEvent(.fixProgress(repo: "/a", stage: "agent", agent: "Claude Code"))], from: s)
  try expectEqual(s.repos[0].fix, .running(stage: "agent", agent: "Claude Code"))
  s = apply([.engineEvent(.fixDone(repo: "/a", result: .noChanges(explanation: nil, agentLabel: "Claude Code")))], from: s)
  try expectEqual(s.repos[0].fix, .done(.noChanges(explanation: nil, agentLabel: "Claude Code")))
  s = apply([.engineEvent(.error(repo: "/a", message: "bad")), .engineEvent(.error(repo: "/nope", message: "x"))], from: s)
  try expectEqual(s.repos[0].lastError, "bad")
  try expectEqual(s.repos.count, 1)
  let running = apply([.engineEvent(.hello(version: "1")), .engineEvent(.error(repo: nil, message: "boom"))])
  try expectEqual(running.engine, .running(version: "1"))
  try expectEqual(apply([.engineEvent(.error(repo: nil, message: "boom"))]).engine, .offline(reason: "boom"))
  // Watching while a pipeline runs; no pipelines at all is idle with a nil worst.
  let w = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.completed, .queued])])
  try expectEqual(w.repos[0].worst, .queued)
  try expectEqual(w.mood, .watching)
  let none = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [])])
  try expectEqual(none.repos[0].worst, nil)
  try expectEqual(none.mood, .idle)
}

check("describe matches the CLI wording") {
  try expectEqual(describe(.noChanges(explanation: nil, agentLabel: "Claude Code")), "Claude Code made no changes; no branch was created.")
  try expectEqual(describe(.fixed(branch: "pux/fix-1", commit: "abc", files: ["a", "b"], explanation: nil, pushed: true, agentLabel: "Codex")),
                  "pux/fix-1 · 2 files changed by Codex · pushed")
  try expectEqual(describe(.fixed(branch: "pux/fix-1", commit: "abc", files: ["a"], explanation: nil, pushed: false, agentLabel: "Codex")),
                  "pux/fix-1 · 1 file changed by Codex")
  try expectEqual(describe(.error(message: "agent crashed")), "agent crashed")
}

check("a failure while a fix is running keeps the fix running") {
  var s = apply([reposEvent([("/a", "u/a")]), stateEvent("/a", "u/a", [.failed]), failureEvent("/a")])
  s = apply([.engineEvent(.fixProgress(repo: "/a", stage: "agent", agent: "Claude Code")), failureEvent("/a")], from: s)
  try expectEqual(s.repos[0].fix, .running(stage: "agent", agent: "Claude Code"))
  // A finished fix is still cleared by a new failure.
  s = apply([.engineEvent(.fixDone(repo: "/a", result: .error(message: "x"))), failureEvent("/a")], from: s)
  try expectEqual(s.repos[0].fix, .idle)
}

// MARK: - Registry (the `watched` key of ~/.config/pux/config.json)

/// 2026-10-16T10:00:00.000Z plus `ms` milliseconds.
func registryDate(ms: Double = 0) -> Date {
  Date(timeIntervalSince1970: 1_792_144_800 + ms / 1000)
}

func parsedObject(_ text: String) throws -> NSDictionary {
  guard let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? NSDictionary else {
    throw CheckError("not a JSON object: \(text)")
  }
  return object
}

check("registry: adding to {} writes one watched entry, as the engine would") {
  let text = try Registry.adding(path: "/r", repository: "o/n", now: registryDate(), to: "{}")
  let watched = try parsedObject(text)["watched"] as? NSDictionary
  try expectEqual(watched?.count, 1)
  let entry = watched?["/r"] as? NSDictionary
  try expectEqual(entry?["repository"] as? String, "o/n")
  try expectEqual(entry?["addedAt"] as? String, "2026-10-16T10:00:00.000Z")
  // Byte-for-byte what `addWatchedRepo` (JSON.stringify(config, null, 2) + "\n") writes.
  try expectEqual(text, #"""
  {
    "repos": {},
    "watched": {
      "/r": {
        "repository": "o/n",
        "addedAt": "2026-10-16T10:00:00.000Z"
      }
    }
  }
  """# + "\n")
}

check("registry: a nil repository is null and addedAt keeps milliseconds") {
  let text = try Registry.adding(path: "/r", repository: nil, now: registryDate(ms: 250), to: "{}")
  let entry = (try parsedObject(text)["watched"] as? NSDictionary)?["/r"] as? NSDictionary
  try expect(entry?["repository"] is NSNull, "repository should be null")
  try expectEqual(entry?["addedAt"] as? String, "2026-10-16T10:00:00.250Z")
}

check("registry: adding keeps every other key, in order, as the engine writes it") {
  // Input and expected output generated with node from store.ts's loadConfig / addWatchedRepo /
  // saveConfig logic (the engine moves `repos` first; new keys go last).
  let existing = #"""
  {
    "updateCheck": {
      "checkedAt": "2026-10-15T08:00:00.000Z",
      "latest": "0.1.6"
    },
    "repos": {
      "o/n": {
        "agentFiles": true
      }
    },
    "autoUpdate": false,
    "watched": {
      "/a": {
        "repository": "o/a",
        "addedAt": "2026-10-01T00:00:00.000Z"
      }
    },
    "extra": {
      "s": "tab\there \"q\" \\ é \u0001 /",
      "n": [
        1.5,
        -2,
        1e+21,
        null,
        [],
        {}
      ]
    }
  }
  """# + "\n"
  let expected = #"""
  {
    "repos": {
      "o/n": {
        "agentFiles": true
      }
    },
    "updateCheck": {
      "checkedAt": "2026-10-15T08:00:00.000Z",
      "latest": "0.1.6"
    },
    "autoUpdate": false,
    "watched": {
      "/a": {
        "repository": "o/a",
        "addedAt": "2026-10-01T00:00:00.000Z"
      },
      "/b": {
        "repository": null,
        "addedAt": "2026-10-16T10:00:00.000Z"
      }
    },
    "extra": {
      "s": "tab\there \"q\" \\ é \u0001 /",
      "n": [
        1.5,
        -2,
        1e+21,
        null,
        [],
        {}
      ]
    }
  }
  """# + "\n"
  let text = try Registry.adding(path: "/b", repository: nil, now: registryDate(), to: existing)
  let before = try parsedObject(existing), after = try parsedObject(text)
  for key in ["repos", "updateCheck", "autoUpdate", "extra"] {
    try expect((before[key] as? NSObject)?.isEqual(after[key]) == true, "\(key) changed")
  }
  try expectEqual(text, expected)
}

check("registry: unicode escapes are decoded and written as JSON.stringify writes them") {
  let text = try Registry.adding(path: "/x/é 😀", repository: "o/n", now: registryDate(),
                                 to: #"{"repos":{},"s":"😀 \/ é"}"#)
  try expectEqual(text, "{\n  \"repos\": {},\n  \"s\": \"😀 / é\",\n  \"watched\": {\n    \"/x/é 😀\": {\n      \"repository\": \"o/n\",\n      \"addedAt\": \"2026-10-16T10:00:00.000Z\"\n    }\n  }\n}\n")
}

check("registry: a leading U+FEFF inside a string survives the round trip") {
  let text = try Registry.adding(path: "/r", repository: "o/n", now: registryDate(),
                                 to: "{\"repos\": {}, \"s\": \"\u{FEFF}a\"}")
  // Compared as scalars: String equality and JSONSerialization can both hide a U+FEFF.
  let expected = "{\n  \"repos\": {},\n  \"s\": \"\u{FEFF}a\",\n  \"watched\": {\n    \"/r\": {\n      \"repository\": \"o/n\",\n      \"addedAt\": \"2026-10-16T10:00:00.000Z\"\n    }\n  }\n}\n"
  try expectEqual(Array(text.unicodeScalars), Array(expected.unicodeScalars))
}

check("registry: parsesAsObject is true only for a complete JSON object") {
  try expect(Registry.parsesAsObject("{}"))
  try expect(Registry.parsesAsObject(#"{"repos": {}, "watched": {"/r": {"repository": null}}}"#))
  for text in ["[]", #""x""#, #"{"repos": {"#, "", "  ", "null", "{} x"] {
    try expect(!Registry.parsesAsObject(text), "\(text) should not parse as an object")
  }
}

check("registry: adding a watched path throws alreadyWatched") {
  let once = try Registry.adding(path: "/r", repository: "o/n", now: registryDate(), to: "{}")
  do {
    _ = try Registry.adding(path: "/r", repository: "o/n", now: registryDate(ms: 5000), to: once)
    throw CheckError("expected alreadyWatched")
  } catch let error as RegistryError {
    try expectEqual(error, .alreadyWatched)
  }
}

check("registry: empty or invalid JSON is treated as {}") {
  let fresh = try Registry.adding(path: "/r", repository: "o/n", now: registryDate(), to: "{}")
  for input in ["", "   ", "{not json", "[1, 2]", "null", #"{"a": 1} trailing"#] {
    try expectEqual(try Registry.adding(path: "/r", repository: "o/n", now: registryDate(), to: input), fresh)
  }
}

check("registry: repositorySlug reads GitHub remotes only") {
  for remote in ["https://github.com/o/n.git", "https://github.com/o/n", "git@github.com:o/n.git", "ssh://git@github.com/o/n.git"] {
    try expectEqual(Registry.repositorySlug(fromRemote: remote), "o/n")
  }
  try expectEqual(Registry.repositorySlug(fromRemote: "https://github.com/o/n/\n"), "o/n")
  try expectEqual(Registry.repositorySlug(fromRemote: "https://gitlab.com/o/n.git"), nil)
  try expectEqual(Registry.repositorySlug(fromRemote: "git@gitlab.com:o/n.git"), nil)
  try expectEqual(Registry.repositorySlug(fromRemote: "https://github.com/o"), nil)
  try expectEqual(Registry.repositorySlug(fromRemote: "/local/path/repo.git"), nil)
}

check("registry: configURL honours PUX_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config") {
  let home = URL(fileURLWithPath: "/Users/me")
  try expectEqual(Registry.configURL(environment: ["PUX_CONFIG_DIR": "/tmp/p", "XDG_CONFIG_HOME": "/x"], home: home).path,
                  "/tmp/p/config.json")
  try expectEqual(Registry.configURL(environment: ["PUX_CONFIG_DIR": "", "XDG_CONFIG_HOME": "/x"], home: home).path,
                  "/x/pux/config.json")
  try expectEqual(Registry.configURL(environment: ["XDG_CONFIG_HOME": ""], home: home).path,
                  "/Users/me/.config/pux/config.json")
  try expectEqual(Registry.configURL(environment: [:], home: home).path, "/Users/me/.config/pux/config.json")
}

finish()
