import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command, type WatchSnapshot } from "../github/client.js";

const maxFileLength = 20_000;
const maxLogLines = 120;

async function optionalFile(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, "utf8");
    return content.length > maxFileLength ? `${content.slice(0, maxFileLength)}\n… [truncated]` : content;
  } catch {
    return null;
  }
}

async function workflows(root: string): Promise<Array<{ name: string; content: string }>> {
  try {
    const directory = join(root, ".github", "workflows");
    const entries = await readdir(directory, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
        .map(async (entry) => ({ name: `.github/workflows/${entry.name}`, content: (await optionalFile(join(directory, entry.name))) ?? "" }))
    );
  } catch {
    return [];
  }
}

function fenced(value: string): string {
  return value.replaceAll("```", "``\\`");
}

function relevantLog(log: string): string {
  const lines = log.split("\n").filter((line) => line.trim());
  const signal = /\b(error|exception|failed|failure|exit code|fatal|panic|ELIFECYCLE)\b/i;
  const hit = lines.findIndex((line) => signal.test(line));
  const start = hit >= 0 ? Math.max(0, hit - 12) : Math.max(0, lines.length - maxLogLines);
  return lines.slice(start, start + maxLogLines).join("\n");
}

/** Creates .ai-context/failure.md for a failed GitHub Actions run. */
export async function generateFailureContext(snapshot: Extract<WatchSnapshot, { kind: "run" }>): Promise<string> {
  const root = await command("git", ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("Not inside a Git repository.");

  const failedLog = await command("gh", ["run", "view", String(snapshot.run.databaseId), "--log-failed"]);
  if (failedLog === null) throw new Error("Could not download failed-step logs from GitHub.");

  const [changedFiles, diff, packageJson, dockerfile, workflowFiles] = await Promise.all([
    command("git", ["diff", "--name-only", "HEAD^", "HEAD"]),
    command("git", ["diff", "--no-ext-diff", "HEAD^", "HEAD"]),
    optionalFile(join(root, "package.json")),
    optionalFile(join(root, "Dockerfile")),
    workflows(root)
  ]);

  const label = snapshot.run.workflowName ?? snapshot.run.name;
  const sections = [
    "# CI Failure",
    "",
    "## Run",
    `- Repository: ${snapshot.repository}`,
    `- Workflow: ${label}`,
    `- Run ID: ${snapshot.run.databaseId}`,
    `- Commit: ${snapshot.commit}`,
    `- Started: ${snapshot.run.createdAt}`,
    "",
    "## Relevant failed-step log",
    "```text",
    fenced(relevantLog(failedLog)),
    "```",
    "",
    "## Changed files",
    changedFiles?.trim() ? fenced(changedFiles) : "No parent commit was available for a diff.",
    "",
    "## Git diff",
    "```diff",
    fenced(diff?.trim() || "No diff available."),
    "```"
  ];

  if (packageJson) sections.push("", "## package.json", "```json", fenced(packageJson), "```");
  if (dockerfile) sections.push("", "## Dockerfile", "```dockerfile", fenced(dockerfile), "```");
  for (const workflow of workflowFiles) sections.push("", `## ${workflow.name}`, "```yaml", fenced(workflow.content), "```");

  const directory = join(root, ".ai-context");
  await mkdir(directory, { recursive: true });
  const output = join(directory, "failure.md");
  await writeFile(output, `${sections.join("\n")}\n`, "utf8");
  return output;
}
