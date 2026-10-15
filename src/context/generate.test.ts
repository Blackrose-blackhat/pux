import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRepo, type TempRepo } from "../__tests__/helpers.js";
import { githubProvider } from "../providers/github.js";
import { vercelProvider } from "../providers/vercel.js";
import type { Pipeline } from "../providers/types.js";
import { generateFailureContext } from "./generate.js";

const ghLog = `test\tRun npm test\t2026-07-18T10:01:24.000Z > vitest run
test\tRun npm test\t2026-07-18T10:01:25.100Z FAIL src/math.test.ts > add
test\tRun npm test\t2026-07-18T10:01:25.200Z AssertionError: expected 4 to be 5
test\tRun npm test\t2026-07-18T10:01:25.300Z     at src/math.test.ts:5:18
test\tRun npm test\t2026-07-18T10:01:25.600Z ##[error]Process completed with exit code 1.`;

let repo: TempRepo;
let sha: string;

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit("src/math.ts", "export const add = (a: number, b: number) => a + b;\n", "add math");
  sha = await repo.commit("src/math.ts", "export const add = (a: number, b: number) => a + a;\n", "break math");
});

afterEach(() => repo.cleanup());

describe("generateFailureContext", () => {
  it("writes a report for a failed GitHub Actions run", async () => {
    await repo.fakeBin("gh", `case "$*" in
  "repo view --json defaultBranchRef --jq .defaultBranchRef.name") echo main ;;
  "run view 12345 --log-failed") cat <<'LOG'
${ghLog}
LOG
  ;;
  *) exit 1 ;;
esac`);
    const pipeline: Pipeline = {
      provider: "github-actions", id: "12345", name: "CI", status: "failed", actor: "me",
      url: "https://github.com/u/r/actions/runs/12345", commit: sha.slice(0, 7), commitSha: sha,
      startedAt: "2026-07-18T10:00:00Z",
    };

    const bundleDir = await generateFailureContext({ provider: githubProvider, pipeline, repository: "u/r" });

    const md = await readFile(join(repo.root, ".ai-context", "failure.md"), "utf8");
    expect(md).toContain("Provider: github-actions");
    expect(md).toContain("## Error · test › Run npm test");
    expect(md).toContain("AssertionError: expected 4 to be 5");
    expect(md).toContain("- Exit code: 1");
    expect(md).toContain("src/math.ts");
    expect(md).toContain("+export const add = (a: number, b: number) => a + a;");

    const metadata = JSON.parse(await readFile(join(bundleDir, "metadata.json"), "utf8"));
    expect(metadata).toMatchObject({ provider: "github-actions", pipelineId: "12345", repository: "u/r", commit: sha });
    expect(bundleDir).toContain(join("failures", "20260718-100000-12345"));
  });

  it("writes a report for a failed Vercel deployment", async () => {
    await repo.fakeBin("vercel", `case "$*" in
  "inspect site-abc.vercel.app --logs") printf 'Running "npm run build"\\nError: Command "npm run build" exited with 1\\n' ;;
  *) exit 1 ;;
esac`);
    await repo.fakeBin("gh", `exit 1`);
    const pipeline: Pipeline = {
      provider: "vercel", id: "site-abc.vercel.app", name: "site", status: "failed", actor: null,
      url: "https://site-abc.vercel.app", commit: sha.slice(0, 7), commitSha: sha, startedAt: "2026-07-18T11:00:00Z",
    };

    const bundleDir = await generateFailureContext({ provider: vercelProvider, pipeline, repository: "u/r" });

    const md = await readFile(join(repo.root, ".ai-context", "failure.md"), "utf8");
    expect(md).toContain("Provider: vercel");
    expect(md).toContain("Reproduce: `vercel build`");
    expect(md).toContain('Error: Command "npm run build" exited with 1');
    expect(bundleDir).toContain(join("failures", "20260718-110000-site-abc.vercel.app"));
  });

  it("throws when the provider has no logs", async () => {
    await repo.fakeBin("gh", `exit 1`);
    const pipeline: Pipeline = {
      provider: "github-actions", id: "1", name: "CI", status: "failed", actor: null, url: null,
      commit: null, commitSha: sha, startedAt: null,
    };

    await expect(generateFailureContext({ provider: githubProvider, pipeline, repository: "u/r" })).rejects.toThrow(/logs/);
  });
});
