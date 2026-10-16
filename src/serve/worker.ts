/**
 * One watched repository, headless: the same poll loop, consent flow, failure capture,
 * fix and rerun as the `pux watch` TUI, reported as protocol events instead of rendered.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectAgents, readLatestFailure, runFix, selectAgent } from "../agents/fix.js";
import { applyAgentInstructions, planAgentInstructions, type AgentPlan } from "../agents/instructions.js";
import { loadConfig, setRepoDecision } from "../config/store.js";
import { generateFailureContext } from "../context/generate.js";
import { command } from "../github/client.js";
import type { Pipeline, Provider, ProviderSnapshot } from "../providers/index.js";
import { pollIntervalFor } from "../tui/polling.js";
import type { ProviderSummary, ServeCommand, ServeEvent } from "./protocol.js";

export type WorkerDeps = {
  /** Absolute repo path; process.cwd() already equals root when run as a child. */
  root: string;
  repository: string | null;
  providers: Provider[];
  emit: (event: ServeEvent) => void;
  /** Default: git rev-parse HEAD in root. */
  head?: () => Promise<string | null>;
  /** Default: git rev-parse --abbrev-ref HEAD in root. */
  branch?: () => Promise<string | null>;
  generate?: typeof generateFailureContext;
  fix?: { readLatestFailure: typeof readLatestFailure; detectAgents: typeof detectAgents; runFix: typeof runFix };
  intervalFor?: (snapshots: ProviderSnapshot[]) => number;
  setTimeout?: typeof globalThis.setTimeout;
};

export type Worker = { start(): void; stop(): void; handle(command: ServeCommand): Promise<void>; tick(): Promise<void> };

const errorWindowMaxLines = 40;

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}

/** Reads the error window, failed step and exit code back out of a rendered `failure.md`. */
function parseFailureReport(md: string): { errorWindow: string; failedStep: string | null; exitCode: number | null } {
  const lines = md.split("\n");
  const exitMatch = /^- Exit code: (\d+)$/m.exec(md);
  const exitCode = exitMatch ? Number(exitMatch[1]) : null;

  const headingIndex = lines.findIndex((line) => line === "## Error" || line.startsWith("## Error · "));
  if (headingIndex === -1) return { errorWindow: "", failedStep: null, exitCode };

  const heading = lines[headingIndex];
  const failedStep = heading.startsWith("## Error · ") ? heading.slice("## Error · ".length) : null;

  // The body is a fenced block whose inner backtick runs are escaped, so a bare ``` line can only
  // be its closing fence. Log lines such as `##[error]...` must not end the window.
  let body: string[];
  if (lines[headingIndex + 1] === "```") {
    const close = lines.indexOf("```", headingIndex + 2);
    body = lines.slice(headingIndex + 2, close === -1 ? undefined : close);
  } else {
    const next = lines.findIndex((line, index) => index > headingIndex && line.startsWith("## "));
    body = lines.slice(headingIndex + 1, next === -1 ? undefined : next);
  }

  const errorWindow = body.join("\n").trim().split("\n").slice(0, errorWindowMaxLines).join("\n");
  return { errorWindow, failedStep, exitCode };
}

export function createWorker(deps: WorkerDeps): Worker {
  const { root, repository, providers, emit } = deps;
  const head = deps.head ?? (() => command("git", ["rev-parse", "HEAD"], { cwd: root }));
  const branch = deps.branch ?? (async () => {
    const name = await command("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
    return name && name !== "HEAD" ? name : null;
  });
  const generate = deps.generate ?? generateFailureContext;
  const fix = deps.fix ?? { readLatestFailure, detectAgents, runFix };
  const intervalFor = deps.intervalFor ?? pollIntervalFor;
  const schedule = deps.setTimeout ?? globalThis.setTimeout;
  const contextPath = join(root, ".ai-context", "failure.md");

  let active = false;
  let polling = false;
  let fixing = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let commit: string | null = null;
  let lastEmitted: string | null = null;
  let latest: { provider: Provider; snapshot: ProviderSnapshot }[] = [];
  let pendingPlan: AgentPlan | null = null;
  /** `provider:id` of failed pipelines already captured; released when that pipeline is seen not failing (re-run). */
  const captured = new Set<string>();

  const reportError = (error: unknown) => emit({ type: "error", repo: root, message: firstLine(error) });

  async function capture(provider: Provider, pipeline: Pipeline): Promise<void> {
    await generate({ provider, pipeline, repository });
    const report = parseFailureReport(await readFile(contextPath, "utf8"));
    emit({ type: "failure", repo: root, pipeline, contextPath, ...report });
  }

  async function poll(): Promise<number> {
    const currentHead = await head();
    if (currentHead) commit = currentHead;
    if (!commit) return intervalFor([]);
    const sha = commit;

    const states = await Promise.all(providers.map(async (provider) => ({ provider, snapshot: await provider.poll(repository ?? "", sha) })));
    latest = states;

    const summaries: ProviderSummary[] = states.map(({ provider, snapshot }) => ({ provider: provider.name, snapshot }));
    const currentBranch = await branch();
    const fingerprint = JSON.stringify({ commit, branch: currentBranch, summaries });
    if (fingerprint !== lastEmitted) {
      lastEmitted = fingerprint;
      emit({ type: "state", repo: root, repository, branch: currentBranch, commit, providers: summaries });
    }

    const seen = states.flatMap(({ provider, snapshot }) =>
      snapshot.kind === "active" ? snapshot.pipelines.map((pipeline) => ({ provider, pipeline, key: `${pipeline.provider}:${pipeline.id}` })) : [],
    );
    // Only a pipeline seen running again (a re-run) is released; an unavailable or waiting poll releases nothing.
    for (const { pipeline, key } of seen) if (pipeline.status !== "failed") captured.delete(key);

    const next = seen.find(({ pipeline, key }) => pipeline.status === "failed" && !captured.has(key));
    if (next) {
      captured.add(next.key);
      try {
        await capture(next.provider, next.pipeline);
      } catch (error) {
        reportError(error);
      }
    }

    return intervalFor(states.map((s) => s.snapshot));
  }

  async function tick(): Promise<void> {
    if (polling) return;
    polling = true;
    let interval = intervalFor([]);
    try {
      interval = await poll();
    } catch (error) {
      reportError(error);
    } finally {
      polling = false;
      if (active) {
        if (timer) clearTimeout(timer);
        timer = schedule(() => void tick(), interval);
      }
    }
  }

  // Same rules as the TUI: a stored "no" is final, a stored "yes" or nothing to write applies silently.
  async function connectAgents(): Promise<void> {
    if (!repository) return;
    const decision = (await loadConfig()).repos[repository]?.agentFiles;
    if (decision === false) return;
    const plan = await planAgentInstructions(root);
    const pending = plan.entries.some((entry) => entry.action !== "present");
    if (decision === true || !pending) {
      await applyAgentInstructions(root, plan);
    } else {
      pendingPlan = plan;
      emit({ type: "consent-needed", repo: root, repository, plan });
    }
  }

  async function consent(target: string, allow: boolean): Promise<void> {
    const plan = pendingPlan;
    pendingPlan = null;
    await setRepoDecision(target, allow);
    if (allow) await applyAgentInstructions(root, plan ?? (await planAgentInstructions(root)));
  }

  async function rerun(pipelineId: string): Promise<void> {
    for (const { provider, snapshot } of latest) {
      if (snapshot.kind !== "active") continue;
      const pipeline = snapshot.pipelines.find((p) => p.id === pipelineId);
      if (!pipeline) continue;
      let ok = false;
      if (provider.rerun) {
        ok = await provider.rerun(pipeline).catch(() => false);
      } else {
        reportError(`${provider.name} does not support re-running.`);
      }
      emit({ type: "rerun-done", repo: root, pipelineId, ok });
      return;
    }
    reportError(`Pipeline ${pipelineId} is not in the latest poll.`);
    emit({ type: "rerun-done", repo: root, pipelineId, ok: false });
  }

  async function startFix(requested: string | undefined, push: boolean | undefined): Promise<void> {
    if (fixing) {
      reportError("A fix is already running for this repository.");
      return;
    }
    fixing = true;
    emit({ type: "fix-progress", repo: root, stage: "starting", agent: null });
    try {
      const failure = await fix.readLatestFailure(root);
      if (!failure) throw new Error("No captured failure in .ai-context/ yet.");
      const agent = selectAgent(await fix.detectAgents(), requested);
      const result = await fix.runFix({
        root,
        failure,
        agent,
        push,
        onProgress: (progress) => emit({ type: "fix-progress", repo: root, stage: progress.stage, agent: agent.label }),
      });
      emit({ type: "fix-done", repo: root, result });
    } catch (error) {
      emit({ type: "fix-done", repo: root, result: { kind: "error", message: firstLine(error) } });
    } finally {
      fixing = false;
    }
  }

  function stop(): void {
    active = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    start() {
      active = true;
      void connectAgents()
        .catch(reportError)
        .then(() => (active ? tick() : undefined));
    },
    stop,
    tick,
    async handle(cmd) {
      try {
        switch (cmd.type) {
          case "rerun": return await rerun(cmd.pipelineId);
          case "fix": return await startFix(cmd.agent, cmd.push);
          case "consent": return await consent(cmd.repository, cmd.allow);
          case "remove-repo":
          case "shutdown": return stop();
        }
      } catch (error) {
        reportError(error);
      }
    },
  };
}
