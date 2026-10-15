import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useRef, useState } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  applyAgentInstructions,
  planAgentInstructions,
  type AgentInstructionResult,
  type AgentPlan,
} from "../agents/instructions.js";
import { detectAgents, readLatestFailure, runFix, selectAgent, type FixProgress, type FixResult } from "../agents/fix.js";
import { describeFixResult } from "../commands/fix.js";
import { loadConfig, setRepoDecision } from "../config/store.js";
import { generateFailureContext } from "../context/generate.js";
import { command } from "../github/client.js";
import { detectProviders, type MissingDependency, type Pipeline, type Provider, type ProviderSnapshot } from "../providers/index.js";
import { Pet, type PetMood } from "./Pet.js";
import { pollIntervalFor } from "./polling.js";
import { autoUpdateLine } from "../utils/auto-update.js";

const execFileAsync = promisify(execFile);

type Phase = "setup" | "watching";
type InstallStatus = "prompting" | "installing" | "done" | "failed";

type ProviderState = {
  provider: Provider;
  snapshot: ProviderSnapshot;
};

type PendingConsent = {
  root: string;
  plan: AgentPlan;
};

type FixState =
  | { kind: "idle" }
  | { kind: "running"; agent: string | null; stage: FixProgress["stage"] | "starting" }
  | { kind: "done"; result: FixResult }
  | { kind: "error"; message: string };

const agentIcons: Record<string, string> = {
  "Claude Code": "✦",
  "Codex": "◈",
  "Cursor": "⌁",
  "Gemini CLI": "◇",
  "Windsurf": "≋",
  "Cline": "⟡",
  "GitHub Copilot": "⬡",
  "Aider": "⊕",
  "Amazon Q": "◆",
};

function formatAgent(name: string): string {
  const icon = agentIcons[name] ?? "·";
  return `${icon} ${name}`;
}

export function WatchApp() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("setup");

  // Setup state
  const [missingDeps, setMissingDeps] = useState<MissingDependency[]>([]);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [installIndex, setInstallIndex] = useState(0);

  // Watching state
  const [providerStates, setProviderStates] = useState<ProviderState[]>([]);
  const [repository, setRepository] = useState<string | null>(null);
  const [commit, setCommit] = useState<string | null>(null);
  const [contextStatus, setContextStatus] = useState<"idle" | "generating" | "written" | "error">("idle");
  const [agentInstructions, setAgentInstructions] = useState<AgentInstructionResult | null>(null);
  const [consent, setConsent] = useState<PendingConsent | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [rerunStatus, setRerunStatus] = useState<"idle" | "rerunning" | "done" | "error">("idle");
  const [fixState, setFixState] = useState<FixState>({ kind: "idle" });
  const generatedFor = useRef<string | null>(null);
  const providersRef = useRef<Provider[]>([]);

  // Background update: checks once a day, installs the next version quietly, never blocks or prompts.
  useEffect(() => {
    let active = true;
    void autoUpdateLine().then((line) => { if (active) setUpdateNotice(line); });
    return () => { active = false; };
  }, []);

  // Initial detection
  useEffect(() => {
    void detectProviders().then(({ providers, repository: repo, commit: sha, missing }) => {
      providersRef.current = providers;
      setRepository(repo);
      setCommit(sha);

      if (missing.length > 0) {
        setMissingDeps(missing);
        setInstallStatus("prompting");
      } else {
        process.stdout.write("\x1B[2J\x1B[H");
        setPhase("watching");
        setProviderStates(providers.map((p) => ({ provider: p, snapshot: { kind: "waiting" } })));
      }
    });
  }, []);

  // Handle input based on phase
  useInput((input, key) => {
    if (key.ctrl && input === "c") { exit(); return; }

    if (phase === "setup" && installStatus === "prompting") {
      if (input === "y" || input === "Y") {
        setInstallStatus("installing");
        void runInstall(missingDeps[installIndex].install);
      } else if (input === "n" || input === "N") {
        moveToNext();
      }
      return;
    }

    if (consent && repository) {
      if (input === "y" || input === "Y") {
        const { root, plan } = consent;
        setConsent(null);
        void setRepoDecision(repository, true)
          .then(() => applyAgentInstructions(root, plan))
          .then(setAgentInstructions)
          .catch(() => setAgentInstructions(null));
      } else if (input === "n" || input === "N") {
        setConsent(null);
        void setRepoDecision(repository, false).catch(() => undefined);
      } else if (input === "q") {
        exit();
      }
      return;
    }

    if (input === "f" && contextStatus === "written" && fixState.kind !== "running") {
      void startFix();
      return;
    }

    if (input === "r" && rerunStatus !== "rerunning") {
      const failedState = providerStates.find((s) =>
        s.snapshot.kind === "active" && s.snapshot.pipelines.some((p) => p.status === "failed")
      );
      if (failedState && failedState.snapshot.kind === "active" && failedState.provider.rerun) {
        const failedPipeline = failedState.snapshot.pipelines.find((p) => p.status === "failed");
        if (failedPipeline) {
          setRerunStatus("rerunning");
          void failedState.provider.rerun(failedPipeline)
            .then((ok) => setRerunStatus(ok ? "done" : "error"))
            .catch(() => setRerunStatus("error"));
        }
      }
      return;
    }

    if (input === "q") exit();
  });

  // `f`: hand the captured failure to the user's own coding agent on a new branch.
  async function startFix() {
    setFixState({ kind: "running", agent: null, stage: "starting" });
    try {
      const root = await command("git", ["rev-parse", "--show-toplevel"]);
      if (!root) throw new Error("Not inside a Git repository.");
      const failure = await readLatestFailure(root);
      if (!failure) throw new Error("No captured failure in .ai-context/ yet.");
      const agent = selectAgent(await detectAgents());
      const result = await runFix({
        root,
        failure,
        agent,
        onProgress: (progress) => setFixState({ kind: "running", agent: agent.label, stage: progress.stage }),
      });
      setFixState({ kind: "done", result });
    } catch (error) {
      setFixState({ kind: "error", message: (error as Error).message.split("\n")[0] });
    }
  }

  function moveToNext() {
    const next = installIndex + 1;
    if (next < missingDeps.length) {
      process.stdout.write("\x1B[2J\x1B[H");
      setInstallIndex(next);
      setInstallStatus("prompting");
    } else {
      finishSetup();
    }
  }

  function finishSetup() {
    setInstallStatus(null);
    // Clear screen before transitioning to avoid trailing setup artifacts
    process.stdout.write("\x1B[2J\x1B[H");
    setPhase("watching");
    // Re-detect after installs
    void detectProviders().then(({ providers, repository: repo, commit: sha }) => {
      providersRef.current = providers;
      setRepository(repo);
      setCommit(sha);
      setProviderStates(providers.map((p) => ({ provider: p, snapshot: { kind: "waiting" } })));
    });
  }

  async function runInstall(cmd: string) {
    try {
      const [bin, ...args] = cmd.split(" ");
      const isAuth = cmd.includes("login") || cmd.includes("auth");
      if (isAuth) {
        // Auth commands need to spawn with stdio so user can see the URL/device code
        const { spawn } = await import("node:child_process");
        await new Promise<void>((resolve, reject) => {
          const child = spawn(bin, args, { stdio: "inherit" });
          child.on("close", (code) => code === 0 ? resolve() : reject());
          child.on("error", reject);
        });
      } else {
        await execFileAsync(bin, args, { encoding: "utf8", timeout: 120000 });
      }
      setInstallStatus("done");
      setTimeout(() => moveToNext(), 1500);
    } catch {
      setInstallStatus("failed");
      setTimeout(() => moveToNext(), 2500);
    }
  }

  // Adaptive polling: checks HEAD each tick to detect pushes.
  // Fast while anything is queued or building, slow once everything has settled.
  const isPolling = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (phase !== "watching" || !repository) return;
    let active = true;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!active) return;
      if (isPolling.current) return;
      isPolling.current = true;
      let interval = pollIntervalFor([]);
      try {
        // Check if HEAD changed (user pushed)
        const currentHead = await command("git", ["rev-parse", "HEAD"]);
        if (currentHead && currentHead !== commitRef.current) {
          setCommit(currentHead);
          commitRef.current = currentHead;
        }

        const sha = commitRef.current;
        if (!sha) return;

        const states = await Promise.all(
          providersRef.current.map(async (provider) => {
            const snapshot = await provider.poll(repository, sha);
            return { provider, snapshot };
          })
        );
        if (active) setProviderStates(states);
        interval = pollIntervalFor(states.map((s) => s.snapshot));
      } finally {
        isPolling.current = false;
        if (active) timer = setTimeout(() => void tick(), interval);
      }
    };

    void tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, repository]);

  // Connect agent instruction files: silently when the user already agreed for this
  // repository, otherwise show exactly what would be written and ask once.
  useEffect(() => {
    if (phase !== "watching" || !repository) return;
    let active = true;

    void (async () => {
      const root = await command("git", ["rev-parse", "--show-toplevel"]);
      if (!root) return;
      const decision = (await loadConfig()).repos[repository]?.agentFiles;
      if (decision === false) return;

      const plan = await planAgentInstructions(root);
      const pending = plan.entries.some((entry) => entry.action !== "present");
      if (!active) return;

      if (decision === true || !pending) {
        setAgentInstructions(await applyAgentInstructions(root, plan));
      } else {
        setConsent({ root, plan });
      }
    })().catch(() => {
      if (active) setAgentInstructions(null);
    });

    return () => { active = false; };
  }, [phase, repository]);

  // Generate failure context once per failed pipeline, whichever provider it came from.
  useEffect(() => {
    for (const state of providerStates) {
      if (state.snapshot.kind !== "active") continue;
      const failed = state.snapshot.pipelines.find((p) => p.status === "failed");
      if (!failed) continue;
      const key = `${failed.provider}:${failed.id}`;
      if (generatedFor.current === key) return;

      generatedFor.current = key;
      setContextStatus("generating");
      void generateFailureContext({ provider: state.provider, pipeline: failed, repository })
        .then(() => setContextStatus("written"))
        .catch(() => setContextStatus("error"));
      return;
    }
  }, [providerStates, repository]);

  // --- RENDER ---

  if (phase === "setup") {
    return <SetupView
      missingDeps={missingDeps}
      installIndex={installIndex}
      installStatus={installStatus}
    />;
  }

  const allPipelines = providerStates.flatMap((s) =>
    s.snapshot.kind === "active" ? s.snapshot.pipelines : []
  );
  const hasFailure = allPipelines.some((p) => p.status === "failed");
  const allCompleted = allPipelines.length > 0 && allPipelines.every((p) => p.status === "completed");
  const pipelineCount = allPipelines.length;

  const mood: PetMood = hasFailure ? "sad" : allCompleted ? "happy" : pipelineCount > 0 ? "watching" : "idle";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Pet mood={mood} />
        <Box flexDirection="column" marginLeft={1} justifyContent="center">
          <Text color="cyan" bold>pux</Text>
          {repository && <Text dimColor>{repository}</Text>}
          {commit && <Text dimColor>{commit.slice(0, 7)}</Text>}
        </Box>
      </Box>

      {consent && <ConsentView plan={consent.plan} />}

      {providerStates.map((state) => (
        <Box key={state.provider.name} flexDirection="column" marginTop={1}>
          <ProviderSection state={state} />
        </Box>
      ))}

      {hasFailure && contextStatus === "generating" && <Box marginTop={1}><Text color="yellow">  ◌ Downloading logs…</Text></Box>}
      {hasFailure && contextStatus === "written" && <Box marginTop={1}><Text color="green">  √ Wrote failure context</Text></Box>}
      {hasFailure && contextStatus === "error" && <Box marginTop={1}><Text color="red">  ✗ Could not create failure context</Text></Box>}

      {rerunStatus === "rerunning" && <Box marginTop={1}><Text color="yellow">  ◌ Re-running…</Text></Box>}
      {rerunStatus === "done" && <Box marginTop={1}><Text color="green">  √ Re-run triggered</Text></Box>}
      {rerunStatus === "error" && <Box marginTop={1}><Text color="red">  ✗ Re-run failed</Text></Box>}

      <FixStatus state={fixState} />

      {agentInstructions && agentInstructions.added.length > 0 && (
        <Box marginTop={1}><Text dimColor>  → Connected to {agentInstructions.added.map(formatAgent).join("  ")}</Text></Box>
      )}

      {!consent && (
        <Box marginTop={1}><Text dimColor>  {hasFailure ? `press ${contextStatus === "written" && fixState.kind !== "running" ? "f to fix · " : ""}r to re-run · q to quit` : "press q to quit"}</Text></Box>
      )}
      {updateNotice && <Text dimColor>  {updateNotice}</Text>}
    </Box>
  );
}

function FixStatus({ state }: { state: FixState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "running") {
    const label = state.agent ?? "agent";
    const line = state.stage === "branch" ? "Creating fix branch…"
      : state.stage === "agent" ? `Running ${label}… this can take a few minutes`
      : state.stage === "commit" ? "Committing changes…"
      : state.stage === "push" ? "Pushing branch…"
      : "Looking for a coding agent…";
    return <Box marginTop={1}><Text color="yellow">  ◌ {line}</Text></Box>;
  }

  if (state.kind === "error") {
    return <Box marginTop={1}><Text color="red">  ✗ Fix failed · {state.message}</Text></Box>;
  }

  const { result } = state;
  if (result.kind === "no-changes") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow">  ○ {describeFixResult(result)}</Text>
        {result.explanation && <Text dimColor>    {result.explanation}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="green">  √ {describeFixResult(result)}</Text>
      {result.files.map((file) => <Text key={file} dimColor>    ~ {file}</Text>)}
      {result.explanation && <Box marginTop={1} marginLeft={4}><Text>{result.explanation}</Text></Box>}
      <Text dimColor>    git diff {result.commit.slice(0, 7)}^..{result.branch}</Text>
    </Box>
  );
}

function ConsentView({ plan }: { plan: AgentPlan }) {
  const pending = plan.entries.filter((entry) => entry.action !== "present");
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">  Connect your AI agents to Pux failure context?</Text>
      <Text dimColor>  This writes the following into this repository:</Text>
      {pending.map((entry) => (
        <Text key={entry.path}>
          {"    "}
          <Text color={entry.action === "create" ? "green" : "cyan"}>{entry.action === "create" ? "+" : "~"}</Text>
          {" "}{entry.path}
          <Text dimColor> · {entry.action === "create" ? "create" : "append"} for {entry.agent}</Text>
        </Text>
      ))}
      <Text>
        {"    "}<Text color="green">+</Text> .gitignore<Text dimColor> · add .ai-context/</Text>
      </Text>
      <Text> </Text>
      <Text>  Press <Text color="green" bold>y</Text> to connect · <Text color="red" bold>n</Text> to skip <Text dimColor>(remembered for this repository)</Text></Text>
    </Box>
  );
}

function SetupView({ missingDeps, installIndex, installStatus }: {
  missingDeps: MissingDependency[];
  installIndex: number;
  installStatus: InstallStatus | null;
}) {
  const current = missingDeps[installIndex];
  if (!current) return <Text color="yellow">◌ Setting up…</Text>;

  const petMood: PetMood = installStatus === "installing" ? "installing"
    : installStatus === "done" ? "happy"
    : installStatus === "failed" ? "sad"
    : "idle";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Pet mood={petMood} />
        <Box flexDirection="column" marginLeft={1} justifyContent="center">
          <Text color="cyan" bold>pux setup</Text>
          <Text dimColor>configuring providers</Text>
        </Box>
      </Box>

      <Text color="yellow">⚠ {current.reason}</Text>
      <Text> </Text>

      {installStatus === "prompting" && (
        <Box flexDirection="column">
          <Text>  Install <Text color="cyan" bold>{current.provider}</Text> now?</Text>
          <Text>  <Text dimColor>({current.install})</Text></Text>
          <Text> </Text>
          <Text>  Press <Text color="green" bold>y</Text> to install · <Text color="red" bold>n</Text> to skip</Text>
        </Box>
      )}

      {installStatus === "installing" && (
        <Text color="yellow">◌ Installing {current.provider}…</Text>
      )}

      {installStatus === "done" && (
        <Text color="green">✓ {current.provider} installed</Text>
      )}

      {installStatus === "failed" && (
        <Box flexDirection="column">
          <Text color="red">✗ Installation failed</Text>
          <Text dimColor>  Run manually: {current.install}</Text>
        </Box>
      )}
    </Box>
  );
}

function ProviderSection({ state }: { state: ProviderState }) {
  const { provider, snapshot } = state;

  if (snapshot.kind === "unavailable") {
    return <Text dimColor>  {provider.name} · unavailable</Text>;
  }
  if (snapshot.kind === "waiting") {
    return <Text color="yellow">  ◌ {provider.name} · waiting…</Text>;
  }

  const pipelines = snapshot.pipelines;
  const allDone = pipelines.every((p) => p.status === "completed");
  const hasFailed = pipelines.some((p) => p.status === "failed");
  const headerColor = hasFailed ? "red" : allDone ? "green" : "yellow";

  return (
    <Box flexDirection="column">
      <Text bold color={headerColor}>{provider.name}</Text>
      {pipelines.map((pipeline) => (
        <PipelineRow key={pipeline.id} pipeline={pipeline} />
      ))}
    </Box>
  );
}

function PipelineRow({ pipeline }: { pipeline: Pipeline }) {
  const symbol = pipeline.status === "failed" ? "✗"
    : pipeline.status === "completed" ? "√"
    : pipeline.status === "building" ? "◌"
    : pipeline.status === "queued" ? "⧖"
    : "·";
  const color = pipeline.status === "failed" ? "red"
    : pipeline.status === "building" ? "yellow"
    : undefined;

  const steps = pipeline.steps ?? [];
  const completedJobs = steps.filter((s) => s.status === "completed").length;
  const totalJobs = steps.length;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        <Text color={color}>{symbol}</Text>
        <Text> {pipeline.name}</Text>
        {pipeline.id && <Text dimColor> #{pipeline.id.slice(-6)}</Text>}
      </Text>
      <Text dimColor>
        {"    "}
        {pipeline.status === "completed" ? "Completed" : pipeline.status === "failed" ? "Failed" : pipeline.status === "building" ? "In progress" : pipeline.status === "queued" ? "Queued" : "Cancelled"}
        {totalJobs > 0 && ` · ${completedJobs}/${totalJobs} jobs`}
        {pipeline.commit && ` · ${pipeline.commit}`}
        {pipeline.actor && ` · ${pipeline.actor}`}
      </Text>
      {steps.length > 0 && (
        <Box flexDirection="column" marginLeft={3}>
          {steps.map((step, i) => {
            const stepSymbol = step.status === "failed" ? "✗" : step.status === "completed" ? "√" : step.status === "building" ? "◌" : "·";
            const stepColor = step.status === "failed" ? "red" : step.status === "building" ? "yellow" : undefined;
            return <Text key={i} dimColor><Text color={stepColor}>{stepSymbol}</Text> {step.name}</Text>;
          })}
        </Box>
      )}
    </Box>
  );
}
