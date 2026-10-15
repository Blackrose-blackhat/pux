import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRepo, type TempRepo } from "../__tests__/helpers.js";
import { githubProvider } from "./github.js";

let repo: TempRepo;

beforeEach(async () => {
  repo = await makeRepo();
});

afterEach(() => repo.cleanup());

describe("githubProvider.poll", () => {
  it("carries the full commit SHA and start time on each pipeline", async () => {
    await repo.fakeBin("gh", `case "$*" in
  "run list --commit"*) echo '[{"databaseId":7,"status":"completed","conclusion":"failure","name":"CI","workflowName":"CI","headSha":"abcdef0123456789abcdef0123456789abcdef01","createdAt":"2026-07-18T10:00:00Z"}]' ;;
  "run view 7 --json jobs") echo '{"jobs":[]}' ;;
  "api repos/u/r/actions/runs/7 --jq .actor.login") echo octocat ;;
  *) exit 1 ;;
esac`);

    const snapshot = await githubProvider.poll("u/r", "abcdef0123456789abcdef0123456789abcdef01");

    expect(snapshot.kind).toBe("active");
    if (snapshot.kind !== "active") return;
    expect(snapshot.pipelines[0]).toMatchObject({
      id: "7",
      status: "failed",
      commit: "abcdef0",
      commitSha: "abcdef0123456789abcdef0123456789abcdef01",
      startedAt: "2026-07-18T10:00:00Z",
      actor: "octocat",
    });
  });
});

describe("githubProvider.getLogs", () => {
  const pipeline = {
    provider: "github-actions" as const, id: "7", name: "CI", status: "failed" as const, actor: null, url: null,
    commit: null, commitSha: null, startedAt: null,
  };

  it("returns the failed-step log when available", async () => {
    await repo.fakeBin("gh", `case "$*" in
  "run view 7 --log-failed") echo "failed step output" ;;
  *) exit 1 ;;
esac`);
    expect(await githubProvider.getLogs(pipeline)).toBe("failed step output");
  });

  it("falls back to the full log when the failed-step log is empty", async () => {
    await repo.fakeBin("gh", `case "$*" in
  "run view 7 --log-failed") echo "" ;;
  "run view 7 --log") echo "full log output" ;;
  *) exit 1 ;;
esac`);
    expect(await githubProvider.getLogs(pipeline)).toBe("full log output");
  });
});

describe("githubProvider.poll caching", () => {
  const run = (status: string, conclusion: string | null) =>
    `[{"databaseId":9,"status":"${status}","conclusion":${conclusion ? `"${conclusion}"` : "null"},"name":"CI","workflowName":"CI","headSha":"abc","createdAt":"2026-07-18T10:00:00Z"}]`;

  async function countingGh(runJson: string): Promise<string> {
    const log = `${repo.root}/gh-calls.log`;
    await repo.fakeBin("gh", `echo "$*" >> "${log}"
case "$*" in
  "run list --commit"*) echo '${runJson}' ;;
  "run view 9 --json jobs") echo '{"jobs":[{"databaseId":1,"name":"test","status":"completed","conclusion":"success","steps":[]}]}' ;;
  "api repos/u/r/actions/runs/9 --jq .actor.login") echo octocat ;;
  *) exit 1 ;;
esac`);
    return log;
  }

  async function calls(log: string): Promise<string[]> {
    const { readFile } = await import("node:fs/promises");
    return (await readFile(log, "utf8")).trim().split("\n");
  }

  it("fetches the actor only once per run", async () => {
    const { clearGitHubRunCache } = await import("./github.js");
    clearGitHubRunCache();
    const log = await countingGh(run("in_progress", null));

    await githubProvider.poll("u/r", "abc");
    await githubProvider.poll("u/r", "abc");

    const actorCalls = (await calls(log)).filter((c) => c.startsWith("api repos"));
    expect(actorCalls).toHaveLength(1);
  });

  it("stops fetching jobs once the run has completed", async () => {
    const { clearGitHubRunCache } = await import("./github.js");
    clearGitHubRunCache();
    const log = await countingGh(run("completed", "success"));

    const first = await githubProvider.poll("u/r", "abc");
    const second = await githubProvider.poll("u/r", "abc");

    const jobCalls = (await calls(log)).filter((c) => c.startsWith("run view 9 --json jobs"));
    expect(jobCalls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("keeps fetching jobs while the run is in progress", async () => {
    const { clearGitHubRunCache } = await import("./github.js");
    clearGitHubRunCache();
    const log = await countingGh(run("in_progress", null));

    await githubProvider.poll("u/r", "abc");
    await githubProvider.poll("u/r", "abc");

    const jobCalls = (await calls(log)).filter((c) => c.startsWith("run view 9 --json jobs"));
    expect(jobCalls).toHaveLength(2);
  });
});
