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

finish()
