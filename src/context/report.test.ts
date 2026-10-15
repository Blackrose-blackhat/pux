import { describe, expect, it } from "vitest";
import {
  cleanLine,
  detectReproCommand,
  extractErrorWindow,
  findOverlap,
  parseExitCode,
  parseFailedLog,
  renderReport,
  scoreLine,
} from "./report.js";

const ts = (line: string, t = "2026-07-18T10:01:25.1234567Z") => `${t} ${line}`;

describe("cleanLine", () => {
  it("strips gh job/step prefix, timestamp and ANSI codes", () => {
    const raw = `test\tRun npm test\t2026-07-18T10:01:25.1234567Z \u001b[31mFAIL\u001b[0m src/a.test.ts`;
    expect(cleanLine(raw)).toBe("FAIL src/a.test.ts");
  });

  it("leaves lines without prefix or timestamp untouched", () => {
    expect(cleanLine("plain text")).toBe("plain text");
  });
});

describe("parseFailedLog", () => {
  it("groups lines by job and step in order of appearance", () => {
    const raw = [
      `build\tInstall\t${ts("npm ci")}`,
      `build\tInstall\t${ts("added 10 packages")}`,
      `build\tTest\t${ts("FAIL src/a.test.ts")}`,
      `lint\tRun eslint\t${ts("1 problem")}`,
    ].join("\n");
    const steps = parseFailedLog(raw);
    expect(steps.map((s) => [s.job, s.step, s.lines.length])).toEqual([
      ["build", "Install", 2],
      ["build", "Test", 1],
      ["lint", "Run eslint", 1],
    ]);
    expect(steps[1].lines[0]).toBe("FAIL src/a.test.ts");
  });

  it("puts unprefixed logs into one anonymous step", () => {
    const steps = parseFailedLog("line one\nline two");
    expect(steps).toEqual([{ job: null, step: null, lines: ["line one", "line two"] }]);
  });
});

describe("scoreLine", () => {
  it("ranks explicit error markers above bare keywords", () => {
    expect(scoreLine("##[error]Process completed with exit code 1.")).toBeGreaterThan(scoreLine("the build failed"));
    expect(scoreLine("src/a.ts(3,5): error TS2322: Type 'string'")).toBeGreaterThan(scoreLine("an error occurred"));
    expect(scoreLine("Traceback (most recent call last):")).toBeGreaterThan(scoreLine("error"));
  });

  it("gives zero to noise that merely contains the keywords", () => {
    expect(scoreLine("Found 0 errors. Watching for file changes.")).toBe(0);
    expect(scoreLine("Warning: Failed to restore cache, continuing")).toBe(0);
    expect(scoreLine("warning: unused variable")).toBe(0);
    expect(scoreLine("npm run build --if-present")).toBe(0);
  });
});

describe("extractErrorWindow", () => {
  it("centers on the real error, not on an earlier cache warning", () => {
    const lines = [
      "Restoring cache",
      "Warning: Failed to restore cache, continuing",
      ...Array.from({ length: 40 }, (_, i) => `installing package ${i}`),
      "> vitest run",
      "FAIL src/math.test.ts > add",
      "AssertionError: expected 4 to be 5",
      "Tests: 1 failed, 3 passed",
      "##[error]Process completed with exit code 1.",
    ];
    const window = extractErrorWindow(lines);
    expect(window).toContain("AssertionError: expected 4 to be 5");
    expect(window).toContain("> vitest run");
    expect(window).not.toContain("installing package 0");
  });

  it("keeps context before and after the best line", () => {
    const lines = Array.from({ length: 200 }, (_, i) => (i === 100 ? "npm ERR! code ELIFECYCLE" : `line ${i}`));
    const window = extractErrorWindow(lines);
    expect(window).toContain("line 90");
    expect(window).toContain("line 120");
    expect(window).not.toContain("line 50");
    expect(window).not.toContain("line 160");
  });

  it("falls back to the tail when nothing matches", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const window = extractErrorWindow(lines);
    expect(window).toContain("line 99");
    expect(window).not.toContain("line 10");
  });
});

describe("parseExitCode", () => {
  it("reads the exit code from the GitHub step summary", () => {
    expect(parseExitCode(["##[error]Process completed with exit code 2."])).toBe(2);
  });

  it("reads npm style exit codes", () => {
    expect(parseExitCode(["error Command failed with exit code 1"])).toBe(1);
  });

  it("returns null when the log never states one", () => {
    expect(parseExitCode(["FAIL src/a.test.ts", "done"])).toBeNull();
  });
});

describe("detectReproCommand", () => {
  it("picks the test runner for test output", () => {
    expect(detectReproCommand("> vitest run\nFAIL", "CI", "github-actions")).toBe("npm test");
  });

  it("picks tsc for type errors", () => {
    expect(detectReproCommand("src/a.ts(3,5): error TS2322", "CI", "github-actions")).toBe("npx tsc --noEmit");
  });

  it("uses vercel build for vercel deployments", () => {
    expect(detectReproCommand("Error: Command \"npm run build\" exited with 1", "site", "vercel")).toBe("vercel build");
  });
});

describe("findOverlap", () => {
  it("matches changed files by full path or basename", () => {
    const error = "FAIL src/math.test.ts\n  at src/lib/add.ts:5:18";
    expect(findOverlap(error, ["src/lib/add.ts", "README.md", "src/math.test.ts"])).toEqual([
      "src/lib/add.ts",
      "src/math.test.ts",
    ]);
  });
});

describe("renderReport", () => {
  const base = {
    provider: "github-actions" as const,
    pipelineName: "CI",
    commit: "abc1234",
    exitCode: 1 as number | null,
    reproCommand: "npm test",
    steps: [{ job: "test", step: "Run npm test", error: "AssertionError: expected 4 to be 5" }],
    overlapping: ["src/add.ts"],
    diffRange: "origin/main...abc1234",
    diff: "--- a/src/add.ts\n+++ b/src/add.ts",
  };

  it("includes one error section per failed step", () => {
    const md = renderReport({
      ...base,
      steps: [
        { job: "test", step: "Run npm test", error: "AssertionError" },
        { job: "lint", step: "Run eslint", error: "1 problem" },
      ],
    });
    expect(md).toContain("## Error · test › Run npm test");
    expect(md).toContain("## Error · lint › Run eslint");
  });

  it("omits the exit code line when unknown", () => {
    expect(renderReport({ ...base, exitCode: null })).not.toContain("Exit code");
    expect(renderReport(base)).toContain("- Exit code: 1");
  });

  it("states the diff range and escapes fences", () => {
    const md = renderReport({ ...base, diff: "```injected```" });
    expect(md).toContain("origin/main...abc1234");
    expect(md).not.toContain("```injected```");
  });
});
