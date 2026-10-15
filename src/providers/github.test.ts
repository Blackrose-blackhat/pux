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
