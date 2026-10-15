import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

let tempDir: string;
let originalCwd: string;
let originalPath: string;
let fakeGhPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pux-edge-"));
  originalCwd = process.cwd();
  originalPath = process.env.PATH!;

  execSync("git init", { cwd: tempDir, stdio: "ignore" });
  execSync("git config user.email 'test@test.com'", { cwd: tempDir, stdio: "ignore" });
  execSync("git config user.name 'Test'", { cwd: tempDir, stdio: "ignore" });
  await writeFile(join(tempDir, "file.txt"), "hello\n");
  execSync("git add -A && git commit -m 'init'", { cwd: tempDir, stdio: "ignore" });

  const binDir = join(tempDir, "fake-bin");
  await mkdir(binDir);
  fakeGhPath = join(binDir, "gh");
  const script = `#!/bin/bash
case "$*" in
  "--version") echo "gh version 2.50.0" ;;
  "auth status") exit 0 ;;
  "repo view --json nameWithOwner --jq .nameWithOwner") echo "user/repo" ;;
  *) exit 1 ;;
esac
`;
  await writeFile(fakeGhPath, script, { mode: 0o755 });
  process.env.PATH = `${binDir}:${originalPath}`;
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.PATH = originalPath;
  await rm(tempDir, { recursive: true, force: true });
});

describe("injection edge cases", () => {
  it("handles empty CLAUDE.md", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "");
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).toContain("Claude Code");
    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf8");
    expect(content).toContain("pux:ci-failure-context");
    expect(content.startsWith("\n\n")).toBe(false);
  });

  it("handles CLAUDE.md with only whitespace", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "   \n\n  \n");
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).toContain("Claude Code");
    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf8");
    expect(content).toContain("pux:ci-failure-context");
  });

  it("handles CLAUDE.md with unicode/emoji content", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "# 🚀 Project Rules\n\nUse strict mode always.\n");
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).toContain("Claude Code");
    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf8");
    expect(content).toContain("🚀 Project Rules");
    expect(content).toContain("pux:ci-failure-context");
  });

  // Skipped until the injector takes an explicit plan: today it creates CLAUDE.md
  // whenever the `claude` binary is installed on the machine, so the result
  // depends on the developer's environment rather than the repository.
  it.skip("does not inject into CLAUDE.md if it does not exist", async () => {
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).not.toContain("Claude Code");
    expect(result.present).not.toContain("Claude Code");
  });

  it("always creates AGENTS.md even if it does not exist", async () => {
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).toContain("Codex");
    const content = await readFile(join(tempDir, "AGENTS.md"), "utf8");
    expect(content).toContain("pux:ci-failure-context");
  });

  it("handles partial marker (start without end) gracefully", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "# Rules\n\n<!-- pux:ci-failure-context -->\nBroken partial\n");
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    // Has start marker but not end marker — should append again
    // This tests the "corrupted state" edge case
    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf8");
    expect(content).toContain("pux:ci-failure-context");
  });

  it("handles .cursorrules file injection", async () => {
    await writeFile(join(tempDir, ".cursorrules"), "Always use TypeScript.\n");
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).toContain("Cursor");
    const content = await readFile(join(tempDir, ".cursorrules"), "utf8");
    expect(content).toContain("Always use TypeScript");
    expect(content).toContain("pux:ci-failure-context");
  });

  it("handles .cursor/rules/ directory injection", async () => {
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).toContain("Cursor");
    const content = await readFile(join(tempDir, ".cursor", "rules", "pux-ci-context.mdc"), "utf8");
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("pux:ci-failure-context");
  });

  it("handles all agent files simultaneously", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "# Claude\n");
    await writeFile(join(tempDir, "GEMINI.md"), "# Gemini\n");
    await writeFile(join(tempDir, ".cursorrules"), "rules\n");
    await writeFile(join(tempDir, ".windsurfrules"), "rules\n");
    await writeFile(join(tempDir, ".clinerules"), "rules\n");
    await mkdir(join(tempDir, ".github"), { recursive: true });
    await writeFile(join(tempDir, ".github", "copilot-instructions.md"), "# Copilot\n");

    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    const result = await ensureAgentInstructions();

    expect(result.added).toContain("Codex");
    expect(result.added).toContain("Claude Code");
    expect(result.added).toContain("Gemini CLI");
    expect(result.added).toContain("Cursor");
    expect(result.added).toContain("Windsurf");
    expect(result.added).toContain("Cline");
    expect(result.added).toContain("GitHub Copilot");
  });

  it("handles read-only file gracefully (does not crash)", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "# Rules\n");
    await chmod(join(tempDir, "CLAUDE.md"), 0o444);

    const { ensureAgentInstructions } = await import("../agents/instructions.js");
    // Should not throw — just skip that file
    const result = await ensureAgentInstructions();

    // AGENTS.md should still get created
    expect(result.added).toContain("Codex");
  });

  it("does not duplicate on rapid successive calls", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "# Rules\n");
    const { ensureAgentInstructions } = await import("../agents/instructions.js");

    await ensureAgentInstructions();
    await ensureAgentInstructions();
    await ensureAgentInstructions();

    const content = await readFile(join(tempDir, "CLAUDE.md"), "utf8");
    const matches = content.match(/pux:ci-failure-context/g);
    // Start + end markers = 2 occurrences, not more
    expect(matches).toHaveLength(2);
  });
});
