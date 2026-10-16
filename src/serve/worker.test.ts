import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRepo, type TempRepo } from "../__tests__/helpers.js";
import { agentCatalog, type FixResult, type LatestFailure } from "../agents/fix.js";
import { loadConfig, setRepoDecision } from "../config/store.js";
import type { Pipeline, Provider, ProviderSnapshot } from "../providers/index.js";
import type { ServeEvent } from "./protocol.js";
import { createWorker, type Worker, type WorkerDeps } from "./worker.js";

const ghLog = `test\tRun npm test\t2026-07-18T10:01:24.000Z > vitest run
test\tRun npm test\t2026-07-18T10:01:25.100Z FAIL src/math.test.ts > add
test\tRun npm test\t2026-07-18T10:01:25.200Z AssertionError: expected 4 to be 5
test\tRun npm test\t2026-07-18T10:01:25.300Z     at src/math.test.ts:5:18
test\tRun npm test\t2026-07-18T10:01:25.600Z ##[error]Process completed with exit code 1.`;

function fakeProvider(snapshots: ProviderSnapshot[], extra: Partial<Provider> = {}): Provider {
  let index = 0;
  return {
    name: "GitHub Actions",
    detect: async () => true,
    poll: async () => snapshots[Math.min(index++, snapshots.length - 1)],
    getLogs: async () => ghLog,
    ...extra,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let repo: TempRepo;
let configDir: string;
let pipeline: Pipeline;
let events: ServeEvent[];
let deps: WorkerDeps;
let worker: Worker | null;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "pux-config-"));
  process.env.PUX_CONFIG_DIR = configDir;
  repo = await makeRepo();
  const sha = await repo.commit("src/math.ts", "export const add = (a: number, b: number) => a + a;\n", "break math");
  await repo.fakeBin("gh", `case "$*" in
  "repo view --json defaultBranchRef --jq .defaultBranchRef.name") echo main ;;
  *) exit 1 ;;
esac`);
  // Keep agent detection off the real machine's PATH.
  await repo.fakeBin("which", "exit 1");
  await repo.fakeBin("code", "exit 1");
  pipeline = {
    provider: "github-actions", id: "12345", name: "CI", status: "building", actor: "me",
    url: "https://github.com/u/r/actions/runs/12345", commit: sha.slice(0, 7), commitSha: sha,
    startedAt: "2026-07-18T10:00:00Z",
  };
  // Each test gets its own sink so a straggling async step can never land in the next test's events.
  const sink: ServeEvent[] = [];
  events = sink;
  worker = null;
  deps = { root: repo.root, repository: "u/r", providers: [], emit: (e) => sink.push(e) };
});

afterEach(async () => {
  worker?.stop();
  await repo.cleanup();
  delete process.env.PUX_CONFIG_DIR;
  await rm(configDir, { recursive: true, force: true });
});

describe("createWorker", () => {
  it("emits state then exactly one failure when a run goes building → failed → failed", async () => {
    const building = { ...pipeline, status: "building" as const };
    const failed = { ...pipeline, status: "failed" as const };
    worker = createWorker({ ...deps, providers: [fakeProvider([
      { kind: "active", pipelines: [building] }, { kind: "active", pipelines: [failed] }, { kind: "active", pipelines: [failed] },
    ])] });
    await worker.tick(); await worker.tick(); await worker.tick();
    expect(events.filter((e) => e.type === "state")).toHaveLength(2);
    const failures = events.filter((e) => e.type === "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ repo: repo.root, contextPath: join(repo.root, ".ai-context", "failure.md"), exitCode: 1, failedStep: "test › Run npm test" });
    expect((failures[0] as any).errorWindow).toContain("AssertionError: expected 4 to be 5");
    // A `##[error]` log line is not a heading, and the markdown fence is not part of the window.
    expect((failures[0] as any).errorWindow).toContain("##[error]Process completed with exit code 1.");
    expect((failures[0] as any).errorWindow).not.toContain("```");
  });

  it("does not emit state when nothing changed", async () => {
    worker = createWorker({ ...deps, providers: [fakeProvider([
      { kind: "active", pipelines: [pipeline] }, { kind: "active", pipelines: [pipeline] },
    ])] });
    await worker.tick(); await worker.tick();
    const states = events.filter((e) => e.type === "state");
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      repo: repo.root, repository: "u/r", branch: "main", commit: pipeline.commitSha,
      providers: [{ provider: "GitHub Actions", snapshot: { kind: "active", pipelines: [pipeline] } }],
    });
  });

  it("captures again when a re-run fails again, and reports the passing state", async () => {
    const failed = { ...pipeline, status: "failed" as const };
    const completed = { ...pipeline, status: "completed" as const };
    worker = createWorker({ ...deps, providers: [fakeProvider([
      { kind: "active", pipelines: [failed] }, { kind: "active", pipelines: [pipeline] },
      { kind: "active", pipelines: [failed] }, { kind: "active", pipelines: [completed] },
    ])] });
    for (let i = 0; i < 4; i++) await worker.tick();
    expect(events.filter((e) => e.type === "failure")).toHaveLength(2);
    const last = events.filter((e) => e.type === "state").at(-1);
    expect(last).toMatchObject({ providers: [{ snapshot: { kind: "active", pipelines: [{ status: "completed" }] } }] });
  });

  it("does not capture again after a provider blip hides the failed run", async () => {
    const failed = { ...pipeline, status: "failed" as const };
    worker = createWorker({ ...deps, providers: [fakeProvider([
      { kind: "active", pipelines: [failed] }, { kind: "unavailable" }, { kind: "active", pipelines: [failed] },
    ])] });
    for (let i = 0; i < 3; i++) await worker.tick();
    expect(events.filter((e) => e.type === "failure")).toHaveLength(1);
  });

  it("turns a throwing poll into an error event instead of rejecting", async () => {
    worker = createWorker({ ...deps, providers: [fakeProvider([], { poll: async () => { throw new Error("gh exploded"); } })] });
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "error", repo: repo.root, message: "gh exploded" }]);
  });

  it("emits consent-needed on start when no decision is stored, and applies on allow", async () => {
    worker = createWorker({ ...deps, providers: [fakeProvider([{ kind: "waiting" }])] });
    worker.start();
    await vi.waitFor(() => expect(events.some((e) => e.type === "state")).toBe(true), { timeout: 10_000 });
    const consent = events.find((e) => e.type === "consent-needed");
    expect(consent).toMatchObject({ repo: repo.root, repository: "u/r" });
    const plan = (consent as Extract<ServeEvent, { type: "consent-needed" }>).plan;
    expect(plan.entries.length).toBeGreaterThan(0);

    await worker.handle({ type: "consent", repo: repo.root, repository: "u/r", allow: true });

    expect((await loadConfig()).repos["u/r"]?.agentFiles).toBe(true);
    const written = plan.entries.filter((entry) => entry.action === "create" || entry.action === "append");
    expect(written.length).toBeGreaterThan(0);
    for (const entry of written) expect(await exists(join(repo.root, entry.path))).toBe(true);
  });

  it("applies silently on start when the repository was already allowed", async () => {
    await setRepoDecision("u/r", true);
    worker = createWorker({ ...deps, providers: [fakeProvider([{ kind: "waiting" }])] });
    worker.start();
    await vi.waitFor(() => expect(events.some((e) => e.type === "state")).toBe(true), { timeout: 10_000 });
    expect(events.some((e) => e.type === "consent-needed")).toBe(false);
    expect(await exists(join(repo.root, "AGENTS.md"))).toBe(true);
  });

  it("routes rerun to the provider and reports the outcome", async () => {
    const rerun = vi.fn(async () => true);
    const failed = { ...pipeline, status: "failed" as const };
    worker = createWorker({ ...deps, providers: [fakeProvider([{ kind: "active", pipelines: [failed] }], { rerun })] });
    await worker.tick();
    await worker.handle({ type: "rerun", repo: repo.root, pipelineId: "12345" });
    expect(rerun).toHaveBeenCalledWith(failed);
    expect(events).toContainEqual({ type: "rerun-done", repo: repo.root, pipelineId: "12345", ok: true });
  });

  it("reports a fix error inline when no failure was captured", async () => {
    const runFix = vi.fn();
    worker = createWorker({ ...deps, fix: { readLatestFailure: async () => null, detectAgents: async () => [], runFix } });
    await worker.handle({ type: "fix", repo: repo.root });
    expect(runFix).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "fix-progress", repo: repo.root, stage: "starting", agent: null },
      { type: "fix-done", repo: repo.root, result: { kind: "error", message: "No captured failure in .ai-context/ yet." } },
    ]);
  });

  it("forwards fix progress stages and the result", async () => {
    const agent = agentCatalog[0];
    const failure: LatestFailure = {
      contextPath: join(repo.root, ".ai-context", "failure.md"), bundleDir: repo.root, pipelineId: "12345",
      pipelineName: "CI", commit: pipeline.commitSha!, reproCommand: "npm test",
    };
    const result: FixResult = { kind: "no-changes", agent, explanation: "nothing to do" };
    const runFix = vi.fn(async (options: { push?: boolean; onProgress?: (p: { stage: "commit" }) => void }) => {
      options.onProgress?.({ stage: "commit" });
      return result;
    });
    worker = createWorker({ ...deps, fix: { readLatestFailure: async () => failure, detectAgents: async () => [agent], runFix: runFix as any } });
    await worker.handle({ type: "fix", repo: repo.root, push: true });
    expect(runFix.mock.calls[0][0]).toMatchObject({ root: repo.root, failure, agent, push: true });
    expect(events).toEqual([
      { type: "fix-progress", repo: repo.root, stage: "starting", agent: null },
      { type: "fix-progress", repo: repo.root, stage: "commit", agent: agent.label },
      { type: "fix-done", repo: repo.root, result },
    ]);
  });
});
