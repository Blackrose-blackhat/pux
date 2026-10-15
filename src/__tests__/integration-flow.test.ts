import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const FAKE_LOG = `2026-07-18T10:01:23.456Z Run npm test
2026-07-18T10:01:24.789Z > vitest run
2026-07-18T10:01:25.000Z
2026-07-18T10:01:25.100Z FAIL src/math.test.ts > add > should sum two numbers
2026-07-18T10:01:25.200Z   AssertionError: expected 4 to be 5
2026-07-18T10:01:25.300Z     at src/math.test.ts:5:18
2026-07-18T10:01:25.400Z
2026-07-18T10:01:25.500Z Tests: 1 failed, 3 passed, 4 total
2026-07-18T10:01:25.600Z error Command failed with exit code 1`;

describe("pux context injection flow", () => {
  let tempDir: string;
  let fakeGhPath: string;
  let originalPath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pux-test-"));
    originalPath = process.env.PATH!;

    // Init a git repo in temp dir
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.name 'Test'", { cwd: tempDir, stdio: "ignore" });

    // Create some files and make two commits so HEAD^ works
    await writeFile(join(tempDir, "index.ts"), "export const add = (a: number, b: number) => a + b;\n");
    await writeFile(join(tempDir, "package.json"), JSON.stringify({ name: "test-app", scripts: { test: "vitest run" } }));
    await mkdir(join(tempDir, ".github", "workflows"), { recursive: true });
    await writeFile(join(tempDir, ".github", "workflows", "ci.yml"), "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n");
    execSync("git add -A && git commit -m 'initial'", { cwd: tempDir, stdio: "ignore" });

    // Second commit (the one that "broke" CI)
    await writeFile(join(tempDir, "index.ts"), "export const add = (a: number, b: number) => a + a; // bug\n");
    execSync("git add -A && git commit -m 'break things'", { cwd: tempDir, stdio: "ignore" });

    // Create a fake gh script that responds to the commands pux uses
    const binDir = join(tempDir, "fake-bin");
    await mkdir(binDir);
    fakeGhPath = join(binDir, "gh");

    const fakeGhScript = `#!/bin/bash
case "$*" in
  "--version")
    echo "gh version 2.50.0 (fake)"
    ;;
  "auth status")
    exit 0
    ;;
  "repo view --json nameWithOwner --jq .nameWithOwner")
    echo "testuser/test-app"
    ;;
  "workflow list --all --json id")
    echo '[{"id":1}]'
    ;;
  "run list --commit"*)
    echo '[{"databaseId":12345,"status":"completed","conclusion":"failure","name":"CI","workflowName":"CI","headSha":"abc123","createdAt":"2026-07-18T10:00:00Z"}]'
    ;;
  "run view 12345 --json jobs")
    echo '{"jobs":[{"databaseId":1,"name":"test","status":"completed","conclusion":"failure","steps":[{"name":"Run npm test","number":1,"status":"completed","conclusion":"failure"}]}]}'
    ;;
  "run view 12345 --log-failed")
    cat << 'FAKELOG'
${FAKE_LOG}
FAKELOG
    ;;
  *)
    echo "fake gh: unhandled: $*" >&2
    exit 1
    ;;
esac
`;
    await writeFile(fakeGhPath, fakeGhScript, { mode: 0o755 });

    // Prepend fake bin to PATH
    process.env.PATH = `${binDir}:${originalPath}`;
  });

  afterAll(async () => {
    process.env.PATH = originalPath;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("ensureAgentInstructions creates AGENTS.md with context pointer", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const { ensureAgentInstructions } = await import("../agents/instructions.js");
      const result = await ensureAgentInstructions();

      expect(result.added).toContain("Codex");
      const content = await readFile(join(tempDir, "AGENTS.md"), "utf8");
      expect(content).toContain("pux:ci-failure-context");
      expect(content).toContain(".ai-context/failure.md");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("ensureAgentInstructions is idempotent", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const { ensureAgentInstructions } = await import("../agents/instructions.js");
      const result = await ensureAgentInstructions();

      expect(result.present).toContain("Codex");
      expect(result.added).not.toContain("Codex");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("ensureAgentInstructions appends to existing CLAUDE.md", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      await writeFile(join(tempDir, "CLAUDE.md"), "# My Project\n\nExisting instructions here.\n");

      const { ensureAgentInstructions } = await import("../agents/instructions.js");
      const result = await ensureAgentInstructions();

      expect(result.added).toContain("Claude Code");
      const content = await readFile(join(tempDir, "CLAUDE.md"), "utf8");
      expect(content).toContain("# My Project");
      expect(content).toContain("pux:ci-failure-context");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("generateFailureContext writes .ai-context/failure.md", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const { generateFailureContext } = await import("../context/generate.js");

      const commit = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();
      const snapshot = {
        kind: "run" as const,
        repository: "testuser/test-app",
        commit,
        run: {
          databaseId: 12345,
          status: "completed" as const,
          conclusion: "failure" as const,
          name: "CI",
          workflowName: "CI",
          headSha: commit,
          createdAt: "2026-07-18T10:00:00Z",
          actor: { login: "testuser" },
        },
        jobs: [],
      };

      const bundleDir = await generateFailureContext(snapshot);
      expect(bundleDir).toContain(join(".ai-context", "failures"));

      const content = await readFile(join(tempDir, ".ai-context", "failure.md"), "utf8");
      expect(content).toContain("# CI Failure");
      expect(content).toContain("Pipeline: CI");
      expect(content).toContain(commit);
      expect(content).toContain("FAIL src/math.test.ts");
      expect(content).toContain("AssertionError: expected 4 to be 5");
      expect(content).toContain("index.ts");

      const metadata = JSON.parse(await readFile(join(bundleDir, "metadata.json"), "utf8"));
      expect(metadata.repository).toBe("testuser/test-app");
      expect(metadata.runId).toBe(12345);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("getWatchSnapshot returns run state via fake gh", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const { getWatchSnapshot } = await import("../github/client.js");
      const snapshot = await getWatchSnapshot();

      expect(snapshot.kind).toBe("run");
      if (snapshot.kind === "run") {
        expect(snapshot.repository).toBe("testuser/test-app");
        expect(snapshot.run.conclusion).toBe("failure");
        expect(snapshot.run.databaseId).toBe(12345);
        expect(snapshot.jobs).toHaveLength(1);
        expect(snapshot.jobs[0].name).toBe("test");
      }
    } finally {
      process.chdir(originalCwd);
    }
  });
});
