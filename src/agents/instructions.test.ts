import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRepo, type TempRepo } from "../__tests__/helpers.js";
import { applyAgentInstructions, planAgentInstructions, startMarker } from "./instructions.js";

let repo: TempRepo;
const none = async (): Promise<string[]> => [];

beforeEach(async () => {
  repo = await makeRepo("pux-agents-");
});

afterEach(() => repo.cleanup());

describe("planAgentInstructions", () => {
  it("always plans AGENTS.md and appends to instruction files that exist", async () => {
    await writeFile(join(repo.root, "CLAUDE.md"), "# project\n");

    const plan = await planAgentInstructions(repo.root, { detectInstalled: none });

    expect(plan.entries).toContainEqual({ agent: "Codex", path: "AGENTS.md", action: "create" });
    expect(plan.entries).toContainEqual({ agent: "Claude Code", path: "CLAUDE.md", action: "append" });
    expect(plan.entries.find((e) => e.path === "GEMINI.md")).toBeUndefined();
  });

  it("marks files that already carry the pointer as present", async () => {
    await writeFile(join(repo.root, "AGENTS.md"), `${startMarker}\nold\n<!-- /pux:ci-failure-context -->\n`);

    const plan = await planAgentInstructions(repo.root, { detectInstalled: none });

    expect(plan.entries).toContainEqual({ agent: "Codex", path: "AGENTS.md", action: "present" });
  });

  it("plans a new file for an installed agent", async () => {
    const plan = await planAgentInstructions(repo.root, { detectInstalled: async () => ["Claude Code", "Cursor"] });

    expect(plan.entries).toContainEqual({ agent: "Claude Code", path: "CLAUDE.md", action: "create" });
    expect(plan.entries).toContainEqual({ agent: "Cursor", path: join(".cursor", "rules", "pux-ci-context.mdc"), action: "create" });
  });

  it("treats an existing .cursor/rules directory as evidence Cursor is in use", async () => {
    await mkdir(join(repo.root, ".cursor", "rules"), { recursive: true });

    const plan = await planAgentInstructions(repo.root, { detectInstalled: none });

    expect(plan.entries).toContainEqual({ agent: "Cursor", path: join(".cursor", "rules", "pux-ci-context.mdc"), action: "create" });
  });

  it("does not write anything", async () => {
    await planAgentInstructions(repo.root, { detectInstalled: async () => ["Claude Code"] });

    expect(repo.git("status --porcelain")).toBe("");
  });
});

describe("applyAgentInstructions", () => {
  it("writes exactly the planned files", async () => {
    await writeFile(join(repo.root, "CLAUDE.md"), "# project\n");
    const plan = await planAgentInstructions(repo.root, { detectInstalled: async () => ["Cursor"] });

    const result = await applyAgentInstructions(repo.root, plan);

    expect(result.added.sort()).toEqual(["Claude Code", "Codex", "Cursor"]);
    expect(await readFile(join(repo.root, "AGENTS.md"), "utf8")).toContain(startMarker);
    expect(await readFile(join(repo.root, "CLAUDE.md"), "utf8")).toMatch(/^# project\n\n/);
    expect(await readFile(join(repo.root, ".cursor", "rules", "pux-ci-context.mdc"), "utf8")).toContain("alwaysApply: true");
  });

  it("is idempotent", async () => {
    const first = await planAgentInstructions(repo.root, { detectInstalled: none });
    await applyAgentInstructions(repo.root, first);
    const second = await planAgentInstructions(repo.root, { detectInstalled: none });
    const result = await applyAgentInstructions(repo.root, second);

    expect(result.added).toEqual([]);
    expect(result.present).toEqual(["Codex"]);
    const content = await readFile(join(repo.root, "AGENTS.md"), "utf8");
    expect(content.split(startMarker)).toHaveLength(2);
  });

  it("only ignores .ai-context, never the agent rule files", async () => {
    await writeFile(join(repo.root, ".gitignore"), "node_modules/\n");
    const plan = await planAgentInstructions(repo.root, { detectInstalled: async () => ["Cursor", "Cline"] });

    await applyAgentInstructions(repo.root, plan);

    expect(await readFile(join(repo.root, ".gitignore"), "utf8")).toBe("node_modules/\n.ai-context/\n");
  });

  it("skips a read-only file without failing the rest", async () => {
    await writeFile(join(repo.root, "CLAUDE.md"), "# locked\n", { mode: 0o444 });
    await mkdir(join(repo.root, ".cursor", "rules"), { recursive: true });
    const plan = await planAgentInstructions(repo.root, { detectInstalled: none });

    const result = await applyAgentInstructions(repo.root, plan);

    expect(result.added).toContain("Codex");
    expect(result.added).not.toContain("Claude Code");
  });
});
