import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command, type WatchSnapshot } from "../github/client.js";

const maxLogLines = 30;
const aiContextIgnoreRule = ".ai-context/";

async function optionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function fenced(value: string): string {
  return value.replaceAll("```", "``\\`");
}

function extractError(log: string): string {
  const lines = log.split("\n");
  const signal = /\b(error|exception|failed|failure|exit code|fatal|panic|ELIFECYCLE)\b/i;
  const hit = lines.findIndex((line) => signal.test(line));
  const start = hit >= 0 ? Math.max(0, hit - 12) : Math.max(0, lines.length - maxLogLines);
  return lines.slice(start, start + maxLogLines).join("\n");
}

function detectReproCommand(log: string, workflow: string): string {
  if (/\bnpm test\b|jest|vitest|mocha/i.test(log)) return "npm test";
  if (/\btsc\b|type.?check/i.test(log)) return "npx tsc --noEmit";
  if (/\beslint\b|lint/i.test(log)) return "npm run lint";
  if (/\bnpm run build\b|webpack|vite build|tsup/i.test(log)) return "npm run build";
  if (/deploy/i.test(workflow)) return "# deployment failure — check CI config";
  return "# could not detect — check workflow step";
}

function findOverlap(errorText: string, changedFiles: string[]): string[] {
  return changedFiles.filter((file) => {
    const name = file.split("/").pop() ?? file;
    return errorText.includes(file) || errorText.includes(name);
  });
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

  const hasParent = await command("git", ["rev-parse", "HEAD^"]);
  const [changedFilesRaw, diff] = hasParent
    ? await Promise.all([
        command("git", ["diff", "--name-only", "HEAD^", "HEAD"]),
        command("git", ["diff", "--no-ext-diff", "HEAD^", "HEAD"]),
      ])
    : [null, null];

  const label = snapshot.run.workflowName ?? snapshot.run.name;
  const errorSignal = extractError(failedLog);
  const changedFiles = changedFilesRaw?.trim().split("\n").filter(Boolean) ?? [];
  const overlapping = findOverlap(errorSignal, changedFiles);
  const reproCommand = detectReproCommand(failedLog, label);

  const relevantDiff = overlapping.length > 0 && diff
    ? await command("git", ["diff", "--no-ext-diff", "HEAD^", "HEAD", "--", ...overlapping])
    : diff;

  const md = [
    "# CI Failure",
    "",
    `- Workflow: ${label}`,
    `- Commit: ${snapshot.commit}`,
    `- Exit code: 1`,
    `- Reproduce: \`${reproCommand}\``,
    "",
    "## Error",
    "```",
    fenced(errorSignal),
    "```",
    "",
    "## Likely cause",
    overlapping.length > 0
      ? `Changed files referenced in the error:\n${overlapping.map((f) => `- ${f}`).join("\n")}`
      : "No direct overlap between changed files and error output.",
    "",
    `## Diff${overlapping.length > 0 ? " (relevant files only)" : ""}`,
    "```diff",
    fenced(relevantDiff?.trim() || "No diff available."),
    "```",
  ].join("\n");

  const folder = folderName(snapshot.run.createdAt, snapshot.run.databaseId);
  const directory = join(root, ".ai-context");
  const failureDir = join(directory, "failures", folder);

  await ensureAiContextIgnored(root);
  await mkdir(directory, { recursive: true });
  await mkdir(failureDir, { recursive: true });

  await writeFile(
    join(failureDir, "metadata.json"),
    `${JSON.stringify({
      repository: snapshot.repository,
      workflow: label,
      runId: snapshot.run.databaseId,
      commit: snapshot.commit,
      startedAt: snapshot.run.createdAt,
      reproduce: reproCommand,
      overlappingFiles: overlapping,
    }, null, 2)}\n`,
    "utf8",
  );

  const latest = join(directory, "failure.md");
  await writeFile(latest, `${md}\n`, "utf8");
  return failureDir;
}
