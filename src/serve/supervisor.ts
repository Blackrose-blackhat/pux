/**
 * The parent process behind `pux serve`: one `pux serve-worker <path>` child per watched repo,
 * their event lines multiplexed onto one stdout, stdin commands routed to the worker they name.
 */

import { spawn } from "node:child_process";
import { mkdirSync, watch } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { configDir, listWatchedRepos, removeWatchedRepo } from "../config/store.js";
import { encodeEvent, parseCommand, type RepoSummary, type ServeCommand, type ServeEvent } from "./protocol.js";

export type WorkerHandle = {
  send(command: ServeCommand): void;
  kill(): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: (code: number | null, stderrTail: string) => void): void;
};

export type SupervisorDeps = {
  /** Default: `spawnWorkerProcess`. */
  spawnWorker: (root: string) => WorkerHandle;
  /** Default: process.stdout.write. */
  write: (line: string) => void;
  /** Default: fs access. */
  exists: (path: string) => Promise<boolean>;
  /** Default: `watchConfigDir`. Returns an unsubscribe. */
  watchConfig: (cb: () => void) => () => void;
  version: string;
};

export type Supervisor = {
  start(): Promise<void>;
  handleLine(line: string): Promise<void>;
  stop(): void;
  reload(): Promise<void>;
  /** Resolves once stop() has run, whether called directly or by a `shutdown` command. */
  closed: Promise<void>;
};

/** A worker that exits again within this long of its restart is left stopped. */
const restartWindowMs = 60_000;
const stderrTailLines = 5;
const configDebounceMs = 1_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Entry = {
  /** Null once the worker has crashed twice inside the restart window. */
  handle: WorkerHandle | null;
  restartedAt: number | null;
};

export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const { spawnWorker, write, exists, watchConfig, version } = deps;
  const workers = new Map<string, Entry>();
  let unwatch: (() => void) | null = null;
  let stopped = false;
  let reloading: Promise<void> = Promise.resolve();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const emit = (event: ServeEvent) => write(encodeEvent(event));

  function launch(root: string, entry: Entry): void {
    const handle = spawnWorker(root);
    entry.handle = handle;
    handle.onLine((line) => {
      if (workers.get(root) !== entry || entry.handle !== handle || line.trim() === "") return;
      write(`${line}\n`);
    });
    handle.onExit((code, stderrTail) => {
      // A worker we killed (removed repo, shutdown) or already replaced is not a crash.
      if (stopped || workers.get(root) !== entry || entry.handle !== handle) return;
      emit({ type: "error", repo: root, message: `engine worker exited (${code}): ${stderrTail}` });
      const now = Date.now();
      if (entry.restartedAt !== null && now - entry.restartedAt < restartWindowMs) {
        entry.handle = null;
        return;
      }
      entry.restartedAt = now;
      launch(root, entry);
    });
  }

  async function doReload(): Promise<void> {
    if (stopped) return;
    const watched = await listWatchedRepos();
    const present: RepoSummary[] = [];
    for (const path of Object.keys(watched).sort()) {
      if (await exists(path)) {
        present.push({ repo: path, repository: watched[path].repository, addedAt: watched[path].addedAt });
        continue;
      }
      emit({ type: "error", repo: path, message: `${path} no longer exists; removed from watch list` });
      await removeWatchedRepo(path);
    }
    if (stopped) return;

    const keep = new Set(present.map((summary) => summary.repo));
    for (const [path, entry] of workers) {
      if (keep.has(path)) continue;
      workers.delete(path);
      entry.handle?.kill();
    }
    for (const path of keep) {
      if (workers.has(path)) continue;
      const entry: Entry = { handle: null, restartedAt: null };
      workers.set(path, entry);
      launch(path, entry);
    }
    emit({ type: "repos", repos: present });
  }

  /** Reloads run one at a time so a config change mid-reload cannot double-spawn a repo. */
  function reload(): Promise<void> {
    const next = reloading.then(doReload);
    reloading = next.catch(() => {});
    return next;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    unwatch?.();
    unwatch = null;
    for (const entry of workers.values()) entry.handle?.kill();
    workers.clear();
    resolveClosed();
  }

  async function handleLine(line: string): Promise<void> {
    if (line.trim() === "") return;
    const command = parseCommand(line);
    if (!command) {
      emit({ type: "error", message: `Unrecognized command: ${line.slice(0, 200)}` });
      return;
    }
    if (command.type === "shutdown") {
      stop();
      return;
    }
    if (command.type === "remove-repo") {
      try {
        await removeWatchedRepo(command.repo);
        await reload();
      } catch (error) {
        emit({ type: "error", repo: command.repo, message: `Removing ${command.repo} failed: ${describe(error)}` });
      }
      return;
    }
    const entry = workers.get(command.repo);
    if (!entry) {
      emit({ type: "error", repo: command.repo, message: `${command.repo} is not a watched repo` });
      return;
    }
    if (!entry.handle) {
      emit({ type: "error", repo: command.repo, message: "engine worker is stopped after repeated crashes" });
      return;
    }
    entry.handle.send(command);
  }

  async function start(): Promise<void> {
    emit({ type: "hello", version });
    await reload();
    if (stopped) return;
    unwatch = watchConfig(() => {
      void reload().catch((error: unknown) => {
        emit({ type: "error", message: `Reloading watch list failed: ${describe(error)}` });
      });
    });
  }

  return { start, handleLine, stop, reload, closed };
}

/** Runs `pux serve-worker <root>` from the repo itself, since the engine resolves the repo root from cwd. */
export function spawnWorkerProcess(root: string): WorkerHandle {
  // process.argv[1] is the bundled dist/cli.js, which owns `serve-worker`.
  const child = spawn(process.execPath, [process.argv[1], "serve-worker", root], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const tail: string[] = [];
  const pushTail = (line: string) => {
    tail.push(line);
    if (tail.length > stderrTailLines) tail.shift();
  };
  createInterface({ input: child.stderr }).on("line", pushTail);
  const stdout = createInterface({ input: child.stdout });
  child.stdin.on("error", () => {});
  child.on("error", (error) => pushTail(error.message));

  return {
    send(command) {
      if (child.stdin.writable) child.stdin.write(`${JSON.stringify(command)}\n`);
    },
    kill() {
      child.kill();
    },
    onLine(cb) {
      stdout.on("line", cb);
    },
    onExit(cb) {
      // "close" waits for stdio to drain, so the stderr tail is complete.
      child.on("close", (code) => cb(code, tail.join("\n")));
    },
  };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Calls cb at most once per second of quiet after config.json changes. */
export function watchConfigDir(cb: () => void): () => void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(dir, (_event, filename) => {
    if (filename && filename !== "config.json") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      cb();
    }, configDebounceMs);
  });
  watcher.on("error", () => {});
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher.close();
  };
}

export function defaultSupervisorDeps(version: string): SupervisorDeps {
  return {
    spawnWorker: spawnWorkerProcess,
    write: (line) => {
      process.stdout.write(line);
    },
    exists: pathExists,
    watchConfig: watchConfigDir,
    version,
  };
}
