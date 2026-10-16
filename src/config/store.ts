import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type RepoDecision = {
  /** Whether Pux may create or edit agent instruction files in this repository. */
  agentFiles: boolean;
};

export type UpdateCheck = {
  checkedAt: string;
  latest: string | null;
};

/** The background install Pux last started, so it is retried at most daily and announced once. */
export type UpdateAttempt = {
  version: string;
  startedAt: string;
};

/** A repository checkout the notch bar watches, keyed by its absolute path in `PuxConfig.watched`. */
export type WatchedRepo = {
  /** `owner/name` when the checkout has a GitHub remote, else null. */
  repository: string | null;
  addedAt: string;
};

export type PuxConfig = {
  repos: Record<string, RepoDecision>;
  updateCheck?: UpdateCheck;
  /** Set to false to keep the update notice but never install anything. */
  autoUpdate?: boolean;
  updateAttempt?: UpdateAttempt;
  /** Checkouts the notch bar watches, keyed by absolute path. */
  watched?: Record<string, WatchedRepo>;
};

const defaults: PuxConfig = { repos: {} };

/** `$PUX_CONFIG_DIR`, else `$XDG_CONFIG_HOME/pux`, else `~/.config/pux`. */
export function configDir(): string {
  if (process.env.PUX_CONFIG_DIR) return process.env.PUX_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "pux");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export async function loadConfig(): Promise<PuxConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8")) as Partial<PuxConfig>;
    return { ...defaults, ...parsed, repos: { ...(parsed.repos ?? {}) } };
  } catch {
    return { ...defaults, repos: {} };
  }
}

export async function saveConfig(config: PuxConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function setRepoDecision(repository: string, agentFiles: boolean): Promise<void> {
  const config = await loadConfig();
  config.repos[repository] = { agentFiles };
  await saveConfig(config);
}

/** Starts watching a checkout; a repeat call keeps the original `addedAt`. */
export async function addWatchedRepo(path: string, repository: string | null, now: Date = new Date()): Promise<void> {
  const config = await loadConfig();
  const watched = config.watched ?? {};
  watched[path] = { repository, addedAt: watched[path]?.addedAt ?? now.toISOString() };
  config.watched = watched;
  await saveConfig(config);
}

export async function removeWatchedRepo(path: string): Promise<void> {
  const config = await loadConfig();
  if (!config.watched) return;
  delete config.watched[path];
  await saveConfig(config);
}

export async function listWatchedRepos(): Promise<Record<string, WatchedRepo>> {
  return (await loadConfig()).watched ?? {};
}
