import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command, type WatchSnapshot } from "../github/client.js";
import { collectDiff } from "./diff.js";
import {
  detectReproCommand,
  extractErrorWindow,
  findOverlap,
  parseExitCode,
  parseFailedLog,
  renderReport,
  type ReportStep,
} from "./report.js";

const aiContextIgnoreRule = ".ai-context/";

async function optionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function folderName(iso: string, runId: number): string {
  const clean = iso.replace(/[-:]/g, "").replace("T", "-").replace("Z", "");
  return `${clean}-${runId}`;
}

async function ensureAiContextIgnored(root: string): Promise<void> {
  const gitignore = join(root, ".gitignore");
  const existing = await optionalFile(gitignore);
  if (existing?.split("\n").some((line) => line.trim() === aiContextIgnoreRule)) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(gitignore, `${prefix}${aiContextIgnoreRule}\n`, "utf8");
}

/** Generates a lean failure context that gives AI agents exactly what they need to diagnose and fix. */
export async function generateFailureContext(snapshot: Extract<WatchSnapshot, { kind: "run" }>): Promise<string> {
  const root = await command("git", ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("Not inside a Git repository.");

  const failedLog = await command("gh", ["run", "view", String(snapshot.run.databaseId), "--log-failed"]);
  if (!failedLog) throw new Error("Could not download failed-step logs from GitHub.");

  const defaultBranch = await command("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  const sha = snapshot.run.headSha || snapshot.commit;
  const fullDiff = await collectDiff({ root, sha, defaultBranch: defaultBranch || null });

  const label = snapshot.run.workflowName ?? snapshot.run.name;
  const logSteps = parseFailedLog(failedLog);
  const steps: ReportStep[] = logSteps.map((step) => ({
    job: step.job,
    step: step.step,
    error: extractErrorWindow(step.lines),
  }));
  const allLines = logSteps.flatMap((step) => step.lines);
  const errorText = steps.map((step) => step.error).join("\n");
  const overlapping = findOverlap(errorText, fullDiff.changedFiles);
  const reproCommand = detectReproCommand(allLines.join("\n"), label, "github-actions");

  const relevantDiff = overlapping.length > 0
    ? await collectDiff({ root, sha, defaultBranch: defaultBranch || null, paths: overlapping })
    : fullDiff;

  const md = renderReport({
    provider: "github-actions",
    pipelineName: label,
    commit: sha,
    exitCode: parseExitCode(allLines),
    reproCommand,
    steps,
    overlapping,
    diffRange: relevantDiff.range,
    diff: relevantDiff.diff,
  });

  const folder = folderName(snapshot.run.createdAt, snapshot.run.databaseId);
  const directory = join(root, ".ai-context");
  const failureDir = join(directory, "failures", folder);

  await ensureAiContextIgnored(root);
  await mkdir(failureDir, { recursive: true });

  await writeFile(
    join(failureDir, "metadata.json"),
    `${JSON.stringify({
      repository: snapshot.repository,
      workflow: label,
      runId: snapshot.run.databaseId,
      commit: sha,
      diffRange: relevantDiff.range,
      startedAt: snapshot.run.createdAt,
      reproduce: reproCommand,
      overlappingFiles: overlapping,
    }, null, 2)}\n`,
    "utf8",
  );

  await writeFile(join(directory, "failure.md"), `${md}\n`, "utf8");
  return failureDir;
}
