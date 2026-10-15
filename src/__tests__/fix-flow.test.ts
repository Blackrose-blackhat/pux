import { execSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentCatalog,
  detectAgents,
  explanationEnd,
  explanationStart,
  readLatestFailure,
  runFix,
  selectAgent,
  type LatestFailure,
} from "../agents/fix.js";
import { makeRepo, type TempRepo } from "./helpers.js";

const claude = agentCatalog[0];

let repo: TempRepo;
let brokenSha: string;
let failure: LatestFailure;

async function captureFailure(root: string, commit: string, pipelineId = "12345"): Promise<LatestFailure> {
  const bundleDir = join(root, ".ai-context", "failures", `20260718-100000-${pipelineId}`);
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(root, ".ai-context", "failure.md"), "# CI Failure\n\nAssertionError: expected 4 to be 5\n");
  await writeFile(
    join(bundleDir, "metadata.json"),
    JSON.stringify({ provider: "github-actions", pipelineId, pipelineName: "CI", commit, reproduce: "npm test" }),
  );
  const latest = await readLatestFailure(root);
  if (!latest) throw new Error("fixture failure not readable");
  return latest;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit("src/math.ts", "export const add = (a: number, b: number) => a + b;\n", "add math");
  brokenSha = await repo.commit("src/math.ts", "export const add = (a: number, b: number) => a + a;\n", "break math");
  // The user keeps working after the push: a new commit plus an uncommitted edit.
  await repo.commit("notes.md", "wip\n", "wip");
  await writeFile(join(repo.root, "README.md"), "# test\n\nlocal edit\n");
  failure = await captureFailure(repo.root, brokenSha);
});

afterEach(() => repo.cleanup());

describe("pux fix with a fake claude on PATH", () => {
  it("creates pux/fix-<id> from the run's commit with the agent's change committed", async () => {
    await repo.fakeBin("claude", `
echo "$@" > "$PWD/../claude-args.txt"
test -f src/math.ts || { echo "not in the fix worktree" >&2; exit 1; }
printf 'export const add = (a: number, b: number) => a + b;\\n' > src/math.ts
echo "Reading the report."
echo "${explanationStart}"
echo "add() doubled a instead of adding b; restored a + b."
echo "${explanationEnd}"`);

    const agent = selectAgent(await detectAgents());
    expect(agent.id).toBe("claude");

    const result = await runFix({ root: repo.root, failure, agent });
    expect(result).toMatchObject({
      kind: "fixed",
      branch: "pux/fix-12345",
      files: ["src/math.ts"],
      explanation: "add() doubled a instead of adding b; restored a + b.",
      pushed: false,
    });
    if (result.kind !== "fixed") throw new Error("expected a fix");

    // Branch sits exactly one commit above the failed run's commit.
    expect(repo.git(`rev-parse pux/fix-12345^`)).toBe(brokenSha);
    expect(repo.git(`rev-parse pux/fix-12345`)).toBe(result.commit);
    expect(repo.git(`show pux/fix-12345:src/math.ts`)).toContain("a + b");
    const message = repo.git(`log -1 --format=%B pux/fix-12345`);
    expect(message).toContain("fix: CI failure");
    expect(message).toContain("restored a + b");
    expect(message).toContain("Pux-Agent: claude");

    // The prompt reached the agent and pointed at the report.
    const args = await readFile(join(repo.root, ".ai-context", "fix", "claude-args.txt"), "utf8");
    expect(args).toContain("-p");
    expect(args).toContain(failure.contextPath);

    // The user's checkout is untouched: same HEAD, same branch, local edit still there.
    expect(repo.git("branch --show-current")).toBe("main");
    expect(repo.git("status --porcelain --untracked-files=no")).toBe("M README.md");
    expect(await readFile(join(repo.root, "README.md"), "utf8")).toContain("local edit");

    // The temporary worktree is gone.
    expect(await exists(join(repo.root, ".ai-context", "fix", "pux-fix-12345"))).toBe(false);
    expect(repo.git("worktree list")).not.toContain("pux-fix-12345");
  });

  it("leaves no branch behind when the agent changes nothing", async () => {
    await repo.fakeBin("claude", `echo "${explanationStart}"; echo "Flaky test, nothing to change."; echo "${explanationEnd}"`);

    const result = await runFix({ root: repo.root, failure, agent: claude });
    expect(result).toEqual({ kind: "no-changes", agent: claude, explanation: "Flaky test, nothing to change." });
    expect(repo.git("branch --list pux/fix-12345")).toBe("");
    expect(await exists(join(repo.root, ".ai-context", "fix", "pux-fix-12345"))).toBe(false);
  });

  it("keeps a commit the agent made itself", async () => {
    await repo.fakeBin("claude", `
printf 'export const add = (a: number, b: number) => a + b;\\n' > src/math.ts
git add -A && git commit -q -m "agent commit"
echo "committed myself"`);

    const result = await runFix({ root: repo.root, failure, agent: claude });
    expect(result).toMatchObject({ kind: "fixed", files: ["src/math.ts"], explanation: "committed myself" });
    expect(repo.git("log -1 --format=%s pux/fix-12345")).toBe("agent commit");
  });

  it("never commits the failure context itself", async () => {
    // The run's commit predates .ai-context/ being ignored, so the worktree would pick it up.
    await repo.fakeBin("claude", `
mkdir -p .ai-context && echo junk > .ai-context/failure.md
printf 'export const add = (a: number, b: number) => a + b;\\n' > src/math.ts`);

    const result = await runFix({ root: repo.root, failure, agent: claude });
    expect(result).toMatchObject({ kind: "fixed", files: ["src/math.ts"] });
  });

  it("surfaces an agent crash and leaves no branch behind", async () => {
    await repo.fakeBin("claude", `echo "boom: not logged in" >&2; exit 3`);

    await expect(runFix({ root: repo.root, failure, agent: claude })).rejects.toThrow(/Claude Code exited with code 3[\s\S]*not logged in/);
    expect(repo.git("branch --list pux/fix-12345")).toBe("");
    expect(repo.git("worktree list")).not.toContain("pux-fix-12345");
  });

  it("treats a failed exit with no changes as an error, even when the agent wrote to stdout", async () => {
    // claude -p prints "Failed to authenticate: OAuth session expired" to stdout and exits 1.
    await repo.fakeBin("claude", `echo "Failed to authenticate: OAuth session expired"; exit 1`);

    await expect(runFix({ root: repo.root, failure, agent: claude })).rejects.toThrow(/Claude Code exited with code 1[\s\S]*Failed to authenticate/);
    expect(repo.git("branch --list pux/fix-12345")).toBe("");
  });

  it("keeps changes the agent made before exiting with an error", async () => {
    await repo.fakeBin("claude", `printf 'export const add = (a: number, b: number) => a + b;\\n' > src/math.ts; echo "done"; exit 2`);

    const result = await runFix({ root: repo.root, failure, agent: claude });
    expect(result).toMatchObject({ kind: "fixed", files: ["src/math.ts"] });
  });

  it("refuses to overwrite an existing fix branch", async () => {
    repo.git("branch pux/fix-12345");
    await repo.fakeBin("claude", `exit 0`);

    await expect(runFix({ root: repo.root, failure, agent: claude })).rejects.toThrow(/pux\/fix-12345 already exists/);
  });

  it("pushes the branch only with --push", async () => {
    const remote = await mkdtemp(join(tmpdir(), "pux-remote-"));
    execSync("git init -q --bare", { cwd: remote });
    repo.git(`remote add origin ${remote}`);
    await repo.fakeBin("claude", `printf 'export const add = (a: number, b: number) => a + b;\\n' > src/math.ts`);

    const result = await runFix({ root: repo.root, failure, agent: claude, push: true });
    expect(result).toMatchObject({ kind: "fixed", pushed: true });
    const remoteHead = execSync("git rev-parse pux/fix-12345", { cwd: remote, encoding: "utf8" }).trim();
    expect(remoteHead).toBe(repo.git("rev-parse pux/fix-12345"));
  });

  it("reports progress stages in order", async () => {
    await repo.fakeBin("claude", `printf 'export const add = (a: number, b: number) => a + b;\\n' > src/math.ts`);
    const stages: string[] = [];
    await runFix({ root: repo.root, failure, agent: claude, onProgress: (p) => stages.push(p.stage) });
    expect(stages).toEqual(["branch", "agent", "commit"]);
  });
});
