import { command } from "../github/client.js";

export type DiffResult = {
  /** Human readable git range the diff covers, e.g. `origin/main...abc1234`. */
  range: string | null;
  /** Resolved base commit the diff starts from. */
  base: string | null;
  changedFiles: string[];
  diff: string | null;
};

export type DiffOptions = {
  root: string;
  sha: string;
  defaultBranch: string | null;
  /** When set, `diff` only covers these paths; `changedFiles` still lists everything. */
  paths?: string[];
};

const empty: DiffResult = { range: null, base: null, changedFiles: [], diff: null };

async function git(root: string, args: string[]): Promise<string | null> {
  return command("git", args, { cwd: root });
}

async function commitExists(root: string, sha: string): Promise<boolean> {
  return (await git(root, ["cat-file", "-e", `${sha}^{commit}`])) !== null;
}

async function ensureCommit(root: string, sha: string): Promise<boolean> {
  if (await commitExists(root, sha)) return true;
  await git(root, ["fetch", "--quiet", "origin", sha]);
  return commitExists(root, sha);
}

async function resolveBase(root: string, sha: string, defaultBranch: string | null): Promise<{ base: string; label: string } | null> {
  const short = sha.slice(0, 7);

  if (defaultBranch) {
    for (const ref of [`origin/${defaultBranch}`, defaultBranch]) {
      const mergeBase = await git(root, ["merge-base", ref, sha]);
      if (!mergeBase) continue;
      if (mergeBase !== sha) return { base: mergeBase, label: `${ref}...${short}` };
      break; // The commit is already on the default branch: fall through to its parent.
    }
  }

  const parent = await git(root, ["rev-parse", "--verify", "--quiet", `${sha}^`]);
  if (!parent) return null;
  return { base: parent, label: `${short}^..${short}` };
}

/** Collects the diff that led to `sha`, measured from the branch base or the parent commit. */
export async function collectDiff({ root, sha, defaultBranch, paths }: DiffOptions): Promise<DiffResult> {
  if (!(await ensureCommit(root, sha))) return empty;

  const resolved = await resolveBase(root, sha, defaultBranch);
  if (!resolved) return empty;

  const [changedFilesRaw, diff] = await Promise.all([
    git(root, ["diff", "--name-only", resolved.base, sha]),
    git(root, ["diff", "--no-ext-diff", resolved.base, sha, ...(paths && paths.length > 0 ? ["--", ...paths] : [])]),
  ]);

  return {
    range: resolved.label,
    base: resolved.base,
    changedFiles: changedFilesRaw?.split("\n").map((f) => f.trim()).filter(Boolean) ?? [],
    diff: diff?.trim() || null,
  };
}
