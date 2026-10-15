import { command } from "../github/client.js";
import {
  agentCatalog,
  buildFixPrompt,
  detectAgents,
  fixBranchName,
  readLatestFailure,
  runFix,
  selectAgent,
  type FixResult,
} from "../agents/fix.js";

export type FixCommandOptions = {
  agent?: string;
  push?: boolean;
  dryRun?: boolean;
};

const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`;
const green = (text: string): string => `\x1b[32m${text}\x1b[0m`;
const red = (text: string): string => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string): string => `\x1b[33m${text}\x1b[0m`;

/** One-line summary used by both the CLI and the TUI. */
export function describeFixResult(result: FixResult): string {
  if (result.kind === "no-changes") return `${result.agent.label} made no changes; no branch was created.`;
  const count = result.files.length === 1 ? "1 file" : `${result.files.length} files`;
  return `${result.branch} · ${count} changed by ${result.agent.label}${result.pushed ? " · pushed" : ""}`;
}

/** `pux fix`: propose a fix for the latest captured failure on a new local branch. */
export async function runFixCommand(options: FixCommandOptions): Promise<void> {
  const root = await command("git", ["rev-parse", "--show-toplevel"]);
  if (!root) {
    console.error(red("✗ Not inside a Git repository."));
    process.exitCode = 1;
    return;
  }

  const failure = await readLatestFailure(root);
  if (!failure) {
    console.error(red("✗ No captured failure in .ai-context/. Run `pux watch` and wait for a failed pipeline first."));
    process.exitCode = 1;
    return;
  }

  let agent;
  try {
    agent = selectAgent(await detectAgents(), options.agent);
  } catch (error) {
    console.error(red(`✗ ${(error as Error).message}`));
    console.error(dim(`  Supported agents: ${agentCatalog.map((a) => `${a.id} (${a.label})`).join(", ")}`));
    process.exitCode = 1;
    return;
  }

  console.log(`${dim("Failure:")} ${failure.pipelineName} at ${failure.commit.slice(0, 7)}`);
  console.log(`${dim("Agent:")}   ${agent.label} (${agent.binary})`);
  console.log(`${dim("Branch:")}  ${fixBranchName(failure.pipelineId)}`);

  if (options.dryRun) {
    console.log("");
    console.log(dim("Prompt that would be sent:"));
    console.log(buildFixPrompt({ contextPath: failure.contextPath, pipelineName: failure.pipelineName, reproCommand: failure.reproCommand }));
    return;
  }

  let result: FixResult;
  try {
    result = await runFix({
      root,
      failure,
      agent,
      push: options.push,
      onProgress: (progress) => {
        if (progress.stage === "branch") console.log(yellow(`◌ Creating ${progress.branch} from ${progress.commit.slice(0, 7)}…`));
        if (progress.stage === "agent") console.log(yellow(`◌ Running ${progress.agent.label}… this can take a few minutes`));
        if (progress.stage === "commit") console.log(yellow("◌ Committing changes…"));
        if (progress.stage === "push") console.log(yellow(`◌ Pushing ${progress.branch}…`));
      },
    });
  } catch (error) {
    console.error(red(`✗ ${(error as Error).message}`));
    process.exitCode = 1;
    return;
  }

  console.log("");
  if (result.kind === "no-changes") {
    console.log(yellow(`○ ${describeFixResult(result)}`));
    if (result.explanation) console.log(`  ${result.explanation}`);
    return;
  }

  console.log(green(`√ ${describeFixResult(result)}`));
  for (const file of result.files) console.log(`  ${dim("~")} ${file}`);
  if (result.explanation) {
    console.log("");
    console.log(result.explanation);
  }
  console.log("");
  console.log(dim(`Review with: git diff ${failure.commit.slice(0, 7)}..${result.branch}`));
  if (!result.pushed) console.log(dim(`Push with:   git push -u origin ${result.branch}   (or rerun with --push)`));
}
