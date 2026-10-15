/**
 * Pure helpers that turn raw CI logs into the failure report.
 * Nothing in here touches the filesystem, git, or any CLI.
 */

export type LogStep = {
  job: string | null;
  step: string | null;
  lines: string[];
};

export type ReportStep = {
  job: string | null;
  step: string | null;
  error: string;
};

export type FailureReport = {
  provider: "github-actions" | "vercel";
  pipelineName: string;
  commit: string;
  exitCode: number | null;
  reproCommand: string;
  steps: ReportStep[];
  overlapping: string[];
  diffRange: string | null;
  diff: string | null;
};

const ansiPattern = /\u001b\[[0-9;]*[A-Za-z]/g;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;

/** Removes the gh job/step prefix, leading ISO timestamp and ANSI colour codes. */
export function cleanLine(raw: string): string {
  let line = raw.replace(ansiPattern, "");
  const parts = line.split("\t");
  if (parts.length >= 3) line = parts.slice(2).join("\t");
  return line.replace(timestampPattern, "").trimEnd();
}

/** Groups a `gh run view --log-failed` dump into ordered job/step buckets. */
export function parseFailedLog(raw: string): LogStep[] {
  const steps: LogStep[] = [];
  let current: LogStep | null = null;

  for (const rawLine of raw.split("\n")) {
    if (rawLine.length === 0) continue;
    const parts = rawLine.replace(ansiPattern, "").split("\t");
    const job = parts.length >= 3 ? parts[0] : null;
    const step = parts.length >= 3 ? parts[1] : null;
    if (!current || current.job !== job || current.step !== step) {
      current = { job, step, lines: [] };
      steps.push(current);
    }
    current.lines.push(cleanLine(rawLine));
  }

  return steps;
}

const noisePatterns = [
  /\b0 errors?\b/i,
  /\bno errors?\b/i,
  /failed to restore cache/i,
  /^\s*warning\b/i,
  /\bwarn(?:ing)?:/i,
  /--if-present/,
  /--no-error/,
  /error-free/i,
];

const strongPatterns = [
  /##\[error\]/,
  /\bnpm ERR!/,
  /\berror TS\d+/,
  /\berror\[E\d+\]/,
  /Traceback \(most recent call last\)/,
  /^\s*FAIL\b/,
  /\bpanic:/,
  /\bfatal:/,
  /\bError:/,
  /\b\w*(?:Error|Exception)\b:?/,
  /\bERROR\b/,
  /exit(?:ed)? (?:with )?(?:code )?[1-9]\d*\b/i,
  /\bELIFECYCLE\b/,
  /Segmentation fault/i,
];

const weakPatterns = [/\berror\b/i, /\bfailed\b/i, /\bfailure\b/i, /\bexit code\b/i];

/** Higher means more likely to be the line that explains the failure. */
export function scoreLine(line: string): number {
  if (noisePatterns.some((p) => p.test(line))) return 0;
  if (strongPatterns.some((p) => p.test(line))) return 3;
  if (weakPatterns.some((p) => p.test(line))) return 1;
  return 0;
}

const linesBefore = 20;
const linesAfter = 30;
const tailLines = 40;

/** Returns the slice of the log around the strongest error signal. */
export function extractErrorWindow(lines: string[]): string {
  let bestIndex = -1;
  let bestScore = 0;
  lines.forEach((line, index) => {
    const score = scoreLine(line);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex === -1) {
    return lines.slice(Math.max(0, lines.length - tailLines)).join("\n");
  }

  const start = Math.max(0, bestIndex - linesBefore);
  const end = Math.min(lines.length, bestIndex + linesAfter + 1);
  return lines.slice(start, end).join("\n");
}

const exitCodePatterns = [
  /Process completed with exit code (\d+)/,
  /exited with (?:code )?(\d+)/i,
  /exit code[:\s]+(\d+)/i,
];

/** Reads the first explicit non-zero exit code mentioned in the log. */
export function parseExitCode(lines: string[]): number | null {
  for (const line of lines) {
    for (const pattern of exitCodePatterns) {
      const match = pattern.exec(line);
      if (match) {
        const code = Number(match[1]);
        if (code > 0) return code;
      }
    }
  }
  return null;
}

export function detectReproCommand(log: string, pipelineName: string, provider: FailureReport["provider"]): string {
  if (provider === "vercel") return "vercel build";
  if (/\bnpm test\b|jest|vitest|mocha|pytest/i.test(log)) return "npm test";
  if (/\btsc\b|error TS\d+|type.?check/i.test(log)) return "npx tsc --noEmit";
  if (/\beslint\b|\blint\b/i.test(log)) return "npm run lint";
  if (/\bnpm run build\b|webpack|vite build|tsup/i.test(log)) return "npm run build";
  if (/docker/i.test(log)) return "docker build .";
  if (/deploy/i.test(pipelineName)) return "# deployment failure — check CI config";
  return "# could not detect — check workflow step";
}

export function findOverlap(errorText: string, changedFiles: string[]): string[] {
  return changedFiles.filter((file) => {
    const name = file.split("/").pop() ?? file;
    return errorText.includes(file) || errorText.includes(name);
  });
}

function fenced(value: string): string {
  return value.replaceAll("```", "``\\`");
}

function stepHeading(step: ReportStep): string {
  if (!step.job && !step.step) return "## Error";
  const label = [step.job, step.step].filter(Boolean).join(" › ");
  return `## Error · ${label}`;
}

export function renderReport(report: FailureReport): string {
  const lines: string[] = [
    "# CI Failure",
    "",
    `- Provider: ${report.provider}`,
    `- Pipeline: ${report.pipelineName}`,
    `- Commit: ${report.commit}`,
  ];
  if (report.exitCode !== null) lines.push(`- Exit code: ${report.exitCode}`);
  lines.push(`- Reproduce: \`${report.reproCommand}\``, "");

  for (const step of report.steps) {
    lines.push(stepHeading(step), "```", fenced(step.error), "```", "");
  }

  lines.push(
    "## Likely cause",
    report.overlapping.length > 0
      ? `Changed files referenced in the error:\n${report.overlapping.map((f) => `- ${f}`).join("\n")}`
      : "No direct overlap between changed files and error output.",
    "",
  );

  const diffTitle = report.overlapping.length > 0 ? "## Diff (relevant files only)" : "## Diff";
  lines.push(report.diffRange ? `${diffTitle} · \`${report.diffRange}\`` : diffTitle);
  lines.push("```diff", fenced(report.diff?.trim() || "No diff available."), "```");

  return lines.join("\n");
}
