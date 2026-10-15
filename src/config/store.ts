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

export type PuxConfig = {
  repos: Record<string, RepoDecision>;
  updateCheck?: UpdateCheck;
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
