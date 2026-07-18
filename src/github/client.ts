import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitHubRun = {
  databaseId: number;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  name: string;
  workflowName: string | null;
  headSha: string;
  createdAt: string;
  actor: { login: string } | null;
};

export type GitHubStep = {
  name: string;
  number: number;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
};

export type GitHubJob = {
  databaseId: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  steps: GitHubStep[];
};

export type WatchSnapshot =
  | { kind: "checking" }
  | { kind: "no-repository" }
  | { kind: "gh-unavailable" }
  | { kind: "not-authenticated" }
  | { kind: "no-workflows" }
  | { kind: "waiting"; repository: string; commit: string }
  | { kind: "run"; repository: string; commit: string; run: GitHubRun; jobs: GitHubJob[] };

export async function command(binary: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, args, { encoding: "utf8" });
    return stdout.trim();
  } catch {
    return null;
  }
}

function parseList<T>(raw: string | null): T[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function parseObject<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Reads GitHub Actions state for the commit checked out in the current directory. */
export async function getWatchSnapshot(): Promise<WatchSnapshot> {
  const root = await command("git", ["rev-parse", "--show-toplevel"]);
  if (!root) return { kind: "no-repository" };

  if ((await command("gh", ["--version"])) === null) return { kind: "gh-unavailable" };
  if ((await command("gh", ["auth", "status"])) === null) return { kind: "not-authenticated" };

  const repository = await command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const commit = await command("git", ["rev-parse", "HEAD"]);
  if (!repository || !commit) return { kind: "no-repository" };

  const workflows = parseList<{ id: number }>(await command("gh", ["workflow", "list", "--all", "--json", "id"]));
  if (workflows === null || workflows.length === 0) return { kind: "no-workflows" };

  const runs = parseList<GitHubRun>(
    await command("gh", [
      "run",
      "list",
      "--commit",
      commit,
      "--limit",
      "1",
      "--json",
      "databaseId,status,conclusion,name,workflowName,headSha,createdAt,actor"
    ])
  );
  const run = runs?.[0];
  if (!run) return { kind: "waiting", repository, commit };

  const detail = parseObject<{ jobs?: GitHubJob[] }>(
    await command("gh", ["run", "view", String(run.databaseId), "--json", "jobs"])
  );
  return { kind: "run", repository, commit, run, jobs: detail?.jobs ?? [] };
}
