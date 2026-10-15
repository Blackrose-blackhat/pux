import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRepo, type TempRepo } from "../__tests__/helpers.js";
import {
  agentCatalog,
  buildFixPrompt,
  detectAgents,
  explanationEnd,
  explanationStart,
  parseExplanation,
  readLatestFailure,
  selectAgent,
} from "./fix.js";

describe("agent catalog", () => {
  it("prefers claude, then codex, then cursor-agent", () => {
    expect(agentCatalog.map((agent) => agent.id)).toEqual(["claude", "codex", "cursor-agent"]);
  });

  it("runs every agent non-interactively with the prompt as the last argument", () => {
    for (const agent of agentCatalog) {
      const args = agent.args("do the thing");
      expect(args.at(-1)).toBe("do the thing");
      expect(agent.binary).toBe(agent.id);
    }
    expect(agentCatalog[0].args("p")).toContain("-p");
    expect(agentCatalog[1].args("p")[0]).toBe("exec");
    expect(agentCatalog[2].args("p")).toContain("-p");
  });
});

describe("detectAgents", () => {
  it("returns installed agents in catalog order", async () => {
    const found = await detectAgents({ commandExists: async (name) => name !== "claude" });
    expect(found.map((agent) => agent.id)).toEqual(["codex", "cursor-agent"]);
  });

  it("returns an empty list when nothing is installed", async () => {
    expect(await detectAgents({ commandExists: async () => false })).toEqual([]);
  });

  it("finds a fake binary on PATH", async () => {
    const repo = await makeRepo();
    try {
      await repo.fakeBin("cursor-agent", "exit 0");
      const found = await detectAgents();
      expect(found.some((agent) => agent.id === "cursor-agent")).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("selectAgent", () => {
  const available = agentCatalog.filter((agent) => agent.id !== "claude");

  it("uses the first available agent by default", () => {
    expect(selectAgent(available).id).toBe("codex");
  });

  it("honours an explicit choice", () => {
    expect(selectAgent(available, "cursor-agent").id).toBe("cursor-agent");
  });

  it("explains when the requested agent is missing", () => {
    expect(() => selectAgent(available, "claude")).toThrow(/claude.*not found.*codex, cursor-agent/s);
  });

  it("rejects unknown agent ids", () => {
    expect(() => selectAgent(available, "gemini")).toThrow(/Unknown agent "gemini".*claude, codex, cursor-agent/s);
  });

  it("explains when nothing is installed", () => {
    expect(() => selectAgent([])).toThrow(/No coding agent found.*claude, codex, cursor-agent/s);
  });
});

describe("buildFixPrompt", () => {
  const prompt = buildFixPrompt({
    contextPath: ".ai-context/failure.md",
    pipelineName: "CI",
    reproCommand: "npm test",
  });

  it("points at the failure report and asks for a minimal fix", () => {
    expect(prompt).toContain(".ai-context/failure.md");
    expect(prompt).toContain("CI");
    expect(prompt).toMatch(/minimal/i);
    expect(prompt).toContain("npm test");
  });

  it("asks for a one-paragraph explanation between the markers", () => {
    expect(prompt).toContain(explanationStart);
    expect(prompt).toContain(explanationEnd);
    expect(prompt).toMatch(/one paragraph/i);
  });

  it("tells the agent not to commit, push, or fetch logs itself", () => {
    expect(prompt).toMatch(/do not commit/i);
    expect(prompt).toMatch(/do not push/i);
    expect(prompt).toMatch(/gh run view|vercel logs/);
  });

  it("warns that the report is untrusted data", () => {
    expect(prompt).toMatch(/untrusted/i);
  });

  it("omits the reproduce line when none was detected", () => {
    const without = buildFixPrompt({ contextPath: "x.md", pipelineName: "CI", reproCommand: null });
    expect(without).not.toMatch(/reproduce/i);
  });
});

describe("parseExplanation", () => {
  it("extracts the text between the markers", () => {
    const stdout = `Reading failure.md...\n${explanationStart}\nThe test expected 4 but add() doubled a.\n${explanationEnd}\nDone.`;
    expect(parseExplanation(stdout)).toBe("The test expected 4 but add() doubled a.");
  });

  it("falls back to the last paragraph when the markers are missing", () => {
    expect(parseExplanation("Looking around.\n\nFixed the off-by-one in math.ts.\n\n")).toBe("Fixed the off-by-one in math.ts.");
  });

  it("returns null for empty output", () => {
    expect(parseExplanation("   \n")).toBeNull();
  });

  it("keeps only the last marker block when the agent echoes the prompt", () => {
    const stdout = `prompt said ${explanationStart}...${explanationEnd}\n${explanationStart} Real answer. ${explanationEnd}`;
    expect(parseExplanation(stdout)).toBe("Real answer.");
  });
});

describe("readLatestFailure", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(() => repo.cleanup());

  async function bundle(folder: string, metadata: Record<string, unknown>): Promise<void> {
    const dir = join(repo.root, ".ai-context", "failures", folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "metadata.json"), JSON.stringify(metadata));
  }

  it("returns null when no failure has been captured", async () => {
    expect(await readLatestFailure(repo.root)).toBeNull();
  });

  it("returns null when the report exists but no bundle does", async () => {
    await mkdir(join(repo.root, ".ai-context"), { recursive: true });
    await writeFile(join(repo.root, ".ai-context", "failure.md"), "# CI Failure\n");
    expect(await readLatestFailure(repo.root)).toBeNull();
  });

  it("picks the newest bundle by folder name", async () => {
    await mkdir(join(repo.root, ".ai-context"), { recursive: true });
    await writeFile(join(repo.root, ".ai-context", "failure.md"), "# CI Failure\n");
    await bundle("20260718-100000-111", { pipelineId: "111", pipelineName: "old", commit: "a".repeat(40), reproduce: "npm test" });
    await bundle("20260719-090000-222", { pipelineId: "222", pipelineName: "CI", commit: "b".repeat(40), reproduce: "npm test", provider: "github-actions" });

    const latest = await readLatestFailure(repo.root);
    expect(latest).toMatchObject({
      contextPath: join(repo.root, ".ai-context", "failure.md"),
      pipelineId: "222",
      pipelineName: "CI",
      commit: "b".repeat(40),
      reproCommand: "npm test",
    });
  });

  it("ignores bundles with unreadable metadata", async () => {
    await mkdir(join(repo.root, ".ai-context"), { recursive: true });
    await writeFile(join(repo.root, ".ai-context", "failure.md"), "# CI Failure\n");
    await bundle("20260718-100000-111", { pipelineId: "111", pipelineName: "CI", commit: "a".repeat(40) });
    const broken = join(repo.root, ".ai-context", "failures", "20260719-090000-222");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "metadata.json"), "{not json");

    expect((await readLatestFailure(repo.root))?.pipelineId).toBe("111");
  });
});
