import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addWatchedRepo, listWatchedRepos } from "../config/store.js";
import type { ServeCommand, ServeEvent } from "./protocol.js";
import { createSupervisor, type Supervisor, type SupervisorDeps, type WorkerHandle } from "./supervisor.js";

type FakeWorker = {
  root: string;
  sent: ServeCommand[];
  killed: boolean;
  emitLine(line: string): void;
  exit(code: number | null, stderrTail: string): void;
};

function fakeSpawner() {
  const workers: FakeWorker[] = [];
  const spawnWorker = (root: string): WorkerHandle => {
    const lineCbs: ((line: string) => void)[] = [];
    const exitCbs: ((code: number | null, stderrTail: string) => void)[] = [];
    const worker: FakeWorker = {
      root,
      sent: [],
      killed: false,
      emitLine: (line) => lineCbs.forEach((cb) => cb(line)),
      exit: (code, tail) => exitCbs.forEach((cb) => cb(code, tail)),
    };
    workers.push(worker);
    return {
      send: (command) => worker.sent.push(command),
      kill: () => {
        worker.killed = true;
      },
      onLine: (cb) => lineCbs.push(cb),
      onExit: (cb) => exitCbs.push(cb),
    };
  };
  return { workers, spawnWorker, roots: () => workers.map((w) => w.root) };
}

let dir: string;
let written: string[];
let missing: Set<string>;
let spawner: ReturnType<typeof fakeSpawner>;
let supervisor: Supervisor | null;

const a = "/work/a";
const b = "/work/b";

function events(): ServeEvent[] {
  return written.map((line) => JSON.parse(line) as ServeEvent);
}

function make(): Supervisor {
  const deps: SupervisorDeps = {
    spawnWorker: spawner.spawnWorker,
    write: (line) => written.push(line),
    exists: async (path) => !missing.has(path),
    watchConfig: () => () => {},
    version: "9.9.9",
  };
  supervisor = createSupervisor(deps);
  return supervisor;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pux-config-"));
  process.env.PUX_CONFIG_DIR = dir;
  written = [];
  missing = new Set();
  spawner = fakeSpawner();
  supervisor = null;
  // Added out of order so the test proves the supervisor sorts by path.
  await addWatchedRepo(b, "u/b", new Date("2026-10-16T10:00:00Z"));
  await addWatchedRepo(a, "u/a", new Date("2026-10-16T09:00:00Z"));
});

afterEach(async () => {
  supervisor?.stop();
  delete process.env.PUX_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("createSupervisor", () => {
  it("spawns one worker per existing repo and announces them", async () => {
    await make().start();

    expect(spawner.roots()).toEqual([a, b]);
    expect(written.every((line) => line.endsWith("\n"))).toBe(true);
    const [hello, repos, ...rest] = events();
    expect(hello).toEqual({ type: "hello", version: "9.9.9" });
    expect(repos).toEqual({
      type: "repos",
      repos: [
        { repo: a, repository: "u/a", addedAt: "2026-10-16T09:00:00.000Z" },
        { repo: b, repository: "u/b", addedAt: "2026-10-16T10:00:00.000Z" },
      ],
    });
    expect(rest).toEqual([]);
  });

  it("drops a missing repo with an error event and removes it from config", async () => {
    missing.add(b);
    await make().start();

    expect(events()).toEqual([
      { type: "hello", version: "9.9.9" },
      { type: "error", repo: b, message: `${b} no longer exists; removed from watch list` },
      { type: "repos", repos: [{ repo: a, repository: "u/a", addedAt: "2026-10-16T09:00:00.000Z" }] },
    ]);
    expect(Object.keys(await listWatchedRepos())).toEqual([a]);
    expect(spawner.roots()).toEqual([a]);
  });

  it("forwards worker lines verbatim and routes commands by repo", async () => {
    const sup = make();
    await sup.start();
    written = [];
    const [workerA, workerB] = spawner.workers;

    const line = `{"type":"rerun-done","repo":"${a}","pipelineId":"7","ok":true}`;
    workerA.emitLine(line);
    expect(written).toEqual([`${line}\n`]);

    await sup.handleLine(JSON.stringify({ type: "rerun", repo: b, pipelineId: "42" }));
    expect(workerB.sent).toEqual([{ type: "rerun", repo: b, pipelineId: "42" }]);
    expect(workerA.sent).toEqual([]);

    await sup.handleLine("not json");
    expect(events().at(-1)).toMatchObject({ type: "error" });
    expect(workerA.sent).toEqual([]);
    expect(workerB.sent).toHaveLength(1);
  });

  it("restarts a crashed worker once", async () => {
    await make().start();
    written = [];

    spawner.workers[0].exit(1, "boom");
    expect(events()).toEqual([{ type: "error", repo: a, message: "engine worker exited (1): boom" }]);
    expect(spawner.roots()).toEqual([a, b, a]);

    spawner.workers[2].exit(1, "boom again");
    expect(events().at(-1)).toEqual({ type: "error", repo: a, message: "engine worker exited (1): boom again" });
    expect(spawner.roots()).toEqual([a, b, a]);

    // The stopped repo's commands are refused rather than sent to a dead handle.
    await supervisor!.handleLine(JSON.stringify({ type: "rerun", repo: a, pipelineId: "1" }));
    expect(spawner.workers[2].sent).toEqual([]);
    expect(events().at(-1)).toMatchObject({ type: "error", repo: a });
  });

  it("remove-repo kills the worker and re-announces", async () => {
    const sup = make();
    await sup.start();
    written = [];
    const [workerA, workerB] = spawner.workers;

    await sup.handleLine(JSON.stringify({ type: "remove-repo", repo: a }));

    expect(workerA.killed).toBe(true);
    expect(workerB.killed).toBe(false);
    expect(Object.keys(await listWatchedRepos())).toEqual([b]);
    expect(events()).toEqual([
      { type: "repos", repos: [{ repo: b, repository: "u/b", addedAt: "2026-10-16T10:00:00.000Z" }] },
    ]);

    // The killed worker's exit is expected, not a crash: no error, no restart.
    workerA.exit(null, "");
    expect(events()).toHaveLength(1);
    expect(spawner.roots()).toEqual([a, b]);
  });
});
