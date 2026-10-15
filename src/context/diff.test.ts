import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectDiff } from "./diff.js";

let repo: string;

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

async function commit(file: string, content: string, message: string): Promise<string> {
  await writeFile(join(repo, file), content);
  git("add -A");
  git(`commit -q -m "${message}"`);
  return git("rev-parse HEAD");
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pux-diff-"));
  git("init -q -b main");
  git("config user.email t@t.io");
  git("config user.name T");
  await commit("a.txt", "a\n", "initial");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("collectDiff", () => {
  it("diffs a feature branch from its merge-base with the default branch", async () => {
    git("update-ref refs/remotes/origin/main HEAD");
    git("checkout -q -b feature");
    await commit("b.txt", "b\n", "first");
    const sha = await commit("c.txt", "c\n", "second");

    const result = await collectDiff({ root: repo, sha, defaultBranch: "main" });

    expect(result.changedFiles).toEqual(["b.txt", "c.txt"]);
    expect(result.range).toBe(`origin/main...${sha.slice(0, 7)}`);
    expect(result.diff).toContain("+b");
    expect(result.diff).toContain("+c");
  });

  it("diffs a single commit when it is on the default branch", async () => {
    await commit("b.txt", "b\n", "first");
    const sha = await commit("c.txt", "c\n", "second");
    git("update-ref refs/remotes/origin/main HEAD");

    const result = await collectDiff({ root: repo, sha, defaultBranch: "main" });

    expect(result.changedFiles).toEqual(["c.txt"]);
    expect(result.range).toBe(`${sha.slice(0, 7)}^..${sha.slice(0, 7)}`);
  });

  it("falls back to the parent commit when no default branch is known", async () => {
    const sha = await commit("b.txt", "b\n", "first");

    const result = await collectDiff({ root: repo, sha, defaultBranch: null });

    expect(result.changedFiles).toEqual(["b.txt"]);
    expect(result.range).toBe(`${sha.slice(0, 7)}^..${sha.slice(0, 7)}`);
  });

  it("returns an empty result for a root commit", async () => {
    const sha = git("rev-parse HEAD");

    const result = await collectDiff({ root: repo, sha, defaultBranch: null });

    expect(result).toEqual({ range: null, base: null, changedFiles: [], diff: null });
  });

  it("returns an empty result when the commit is not available locally", async () => {
    const result = await collectDiff({ root: repo, sha: "0123456789abcdef0123456789abcdef01234567", defaultBranch: "main" });

    expect(result.diff).toBeNull();
    expect(result.changedFiles).toEqual([]);
  });

  it("restricts the diff to the requested paths", async () => {
    await commit("b.txt", "b\n", "first");
    const sha = await commit("c.txt", "c\n", "second");
    git("update-ref refs/remotes/origin/main HEAD~2");

    const result = await collectDiff({ root: repo, sha, defaultBranch: "main", paths: ["c.txt"] });

    expect(result.changedFiles).toEqual(["b.txt", "c.txt"]);
    expect(result.diff).toContain("+c");
    expect(result.diff).not.toContain("+b");
  });
});
