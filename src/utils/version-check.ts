import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadConfig, saveConfig } from "../config/store.js";

const execFileAsync = promisify(execFile);

function findPackageJson(): { version: string } {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i += 1) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, "utf8")) as { version: string };
    dir = dirname(dir);
  }
  return { version: "0.0.0" };
}

const pkg = findPackageJson();

export function getCurrentVersion(): string {
  return pkg.version;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export function isHomebrewInstall(scriptPath: string = process.argv[1] ?? ""): boolean {
  return /\/(?:Cellar|homebrew|Homebrew)\//.test(scriptPath);
}

export function upgradeCommand(homebrew: boolean): string {
  return homebrew ? "brew upgrade pux" : "npm install -g pux.sh@latest";
}

export function formatUpdateNotice(current: string, latest: string, homebrew: boolean): string {
  return `pux ${latest} available (you have ${current}) · ${upgradeCommand(homebrew)}`;
}

async function fetchLatestFromNpm(): Promise<string> {
  const { stdout } = await execFileAsync("npm", ["view", "pux.sh", "version"], { encoding: "utf8", timeout: 3000 });
  return stdout.trim();
}

export type CheckOptions = {
  current?: string;
  fetchLatest?: () => Promise<string>;
  now?: Date;
};

const cacheTtlMs = 24 * 60 * 60 * 1000;

/** Returns the newest published version when it is newer than `current`, checking npm at most once a day. */
export async function checkForUpdate({
  current = pkg.version,
  fetchLatest = fetchLatestFromNpm,
  now = new Date(),
}: CheckOptions = {}): Promise<string | null> {
  const config = await loadConfig();
  const cached = config.updateCheck;
  let latest: string | null;

  if (cached && now.getTime() - Date.parse(cached.checkedAt) < cacheTtlMs) {
    latest = cached.latest;
  } else {
    try {
      latest = await fetchLatest();
    } catch {
      latest = null;
    }
    try {
      await saveConfig({ ...config, updateCheck: { checkedAt: now.toISOString(), latest } });
    } catch {
      // A read-only config dir just means we check again next time.
    }
  }

  return latest && isNewerVersion(latest, current) ? latest : null;
}

/** One dim line to show when an update exists, or null. Never throws. */
export async function getUpdateNotice(): Promise<string | null> {
  try {
    const latest = await checkForUpdate();
    return latest ? formatUpdateNotice(pkg.version, latest, isHomebrewInstall()) : null;
  } catch {
    return null;
  }
}
