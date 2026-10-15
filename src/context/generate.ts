import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command } from "../github/client.js";
import type { Pipeline, Provider } from "../providers/types.js";
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

export type GenerateOptions = {
  provider: Provider;
  pipeline: Pipeline;
  repository: string | null;
};

async function optionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function folderName(startedAt: string | null, id: string): string {
  const iso = startedAt ?? new Date().toISOString();
  const stamp = iso.replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-").replace("Z", "");
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${stamp}-${safeId}`;
}

async function ensureAiContextIgnored(root: string): Promise<void> {
  const gitignore = join(root, ".gitignore");
  const existing = await optionalFile(gitignore);
  if (existing?.split("\n").some((line) => line.trim() === aiContextIgnoreRule)) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(gitignore, `${prefix}${aiContextIgnoreRule}\n`, "utf8");
}

/** Writes `.ai-context/failure.md` plus a timestamped bundle for a failed pipeline. Returns the bundle directory. */
export async function generateFailureContext({ provider, pipeline, repository }: GenerateOptions): Promise<string> {
  const root = await command("git", ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("Not inside a Git repository.");

  const log = await provider.getLogs(pipeline);
  if (!log) throw new Error(`Could not download logs for ${pipeline.name} from ${provider.name}.`);

  const sha = pipeline.commitSha ?? (await command("git", ["rev-parse", "HEAD"], { cwd: root }));
  if (!sha) throw new Error("Could not determine the commit for this pipeline.");

  const defaultBranch =
    (await command("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])) || null;
  const fullDiff = await collectDiff({ root, sha, defaultBranch });

  const logSteps = parseFailedLog(log);
  const steps: ReportStep[] = logSteps.map((step) => ({
    job: step.job,
    step: step.step,
    error: extractErrorWindow(step.lines),
  }));
  const allLines = logSteps.flatMap((step) => step.lines);
  const errorText = steps.map((step) => step.error).join("\n");
  const overlapping = findOverlap(errorText, fullDiff.changedFiles);
  const reproCommand = detectReproCommand(allLines.join("\n"), pipeline.name, pipeline.provider);

  const relevantDiff = overlapping.length > 0
    ? await collectDiff({ root, sha, defaultBranch, paths: overlapping })
    : fullDiff;

  const md = renderReport({
    provider: pipeline.provider,
    pipelineName: pipeline.name,
    commit: sha,
    exitCode: parseExitCode(allLines),
    reproCommand,
    steps,
    overlapping,
    diffRange: relevantDiff.range,
    diff: relevantDiff.diff,
  });

  const directory = join(root, ".ai-context");
  const failureDir = join(directory, "failures", folderName(pipeline.startedAt, pipeline.id));

  await ensureAiContextIgnored(root);
  await mkdir(failureDir, { recursive: true });

  await writeFile(
    join(failureDir, "metadata.json"),
    `${JSON.stringify({
      provider: pipeline.provider,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      url: pipeline.url,
      repository,
      commit: sha,
      diffRange: relevantDiff.range,
      startedAt: pipeline.startedAt,
      reproduce: reproCommand,
      overlappingFiles: overlapping,
    }, null, 2)}\n`,
    "utf8",
  );

  await writeFile(join(directory, "failure.md"), `${md}\n`, "utf8");
  return failureDir;
}
