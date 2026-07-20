import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useRef, useState } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureAgentInstructions, type AgentInstructionResult } from "../agents/instructions.js";
import { generateFailureContext } from "../context/generate.js";
import { getWatchSnapshot, type WatchSnapshot } from "../github/client.js";
import { detectProviders, type MissingDependency, type Pipeline, type Provider, type ProviderSnapshot } from "../providers/index.js";
import { Pet, type PetMood } from "./Pet.js";

const execFileAsync = promisify(execFile);

type Phase = "setup" | "watching";
type InstallStatus = "prompting" | "installing" | "done" | "failed";

type ProviderState = {
  provider: Provider;
  snapshot: ProviderSnapshot;
};

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
  const [legacySnapshot, setLegacySnapshot] = useState<WatchSnapshot>({ kind: "checking" });
  const generatedFor = useRef<string | null>(null);
  const providersRef = useRef<Provider[]>([]);

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

    if (input === "q") exit();
  });

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

  // Polling (only in watching phase)
  useEffect(() => {
    if (phase !== "watching" || !repository || !commit) return;
    let active = true;

    const refresh = async () => {
      const states = await Promise.all(
        providersRef.current.map(async (provider) => {
          const snapshot = await provider.poll(repository, commit);
          return { provider, snapshot };
        })
      );
      if (active) setProviderStates(states);

      const legacy = await getWatchSnapshot();
      if (active) setLegacySnapshot(legacy);
    };

    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [phase, repository, commit]);

  useEffect(() => {
    if (phase !== "watching") return;
    void ensureAgentInstructions().then(setAgentInstructions).catch(() => setAgentInstructions(null));
  }, [phase]);

  useEffect(() => {
    if (legacySnapshot.kind !== "run" || legacySnapshot.run.status !== "completed" || legacySnapshot.run.conclusion !== "failure") return;
    if (generatedFor.current === String(legacySnapshot.run.databaseId)) return;

    generatedFor.current = String(legacySnapshot.run.databaseId);
    setContextStatus("generating");
    void generateFailureContext(legacySnapshot)
      .then(() => setContextStatus("written"))
      .catch(() => setContextStatus("error"));
  }, [legacySnapshot]);

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
          <Text dimColor>watching {pipelineCount} pipeline{pipelineCount !== 1 ? "s" : ""}</Text>
        </Box>
      </Box>

      {repository && <Text>✓ Repository: {repository}</Text>}

      {providerStates.map((state) => (
        <Box key={state.provider.name} flexDirection="column" marginTop={1}>
          <ProviderSection state={state} />
        </Box>
      ))}

      {hasFailure && contextStatus === "generating" && <Box marginTop={1}><Text color="yellow">◌ Downloading logs…</Text></Box>}
      {hasFailure && contextStatus === "written" && <Box marginTop={1}><Text color="green">✓ Wrote .ai-context/failure.md</Text></Box>}
      {hasFailure && contextStatus === "error" && <Box marginTop={1}><Text color="red">✗ Could not create .ai-context/failure.md</Text></Box>}

      {agentInstructions && agentInstructions.added.length > 0 && (
        <Box marginTop={1}><Text color="green">✓ Connected CI context to {agentInstructions.added.join(", ")}</Text></Box>
      )}

      <Box marginTop={1}><Text dimColor>press q to quit</Text></Box>
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
    return <Text dimColor>{provider.name} · unavailable</Text>;
  }
  if (snapshot.kind === "waiting") {
    return <Text color="yellow">◌ {provider.name} · waiting…</Text>;
  }

  return (
    <Box flexDirection="column">
      {snapshot.pipelines.map((pipeline) => (
        <PipelineRow key={pipeline.id} pipeline={pipeline} providerName={provider.name} />
      ))}
    </Box>
  );
}

function PipelineRow({ pipeline, providerName }: { pipeline: Pipeline; providerName: string }) {
  const symbol = pipeline.status === "failed" ? "✗"
    : pipeline.status === "completed" ? "✓"
    : pipeline.status === "building" ? "◌"
    : "·";
  const color = pipeline.status === "failed" ? "red"
    : pipeline.status === "completed" ? "green"
    : pipeline.status === "building" ? "yellow"
    : undefined;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{symbol} </Text>
        <Text bold>{providerName}</Text>
        <Text> · {pipeline.name}</Text>
        {pipeline.actor && <Text dimColor> · {pipeline.actor}</Text>}
      </Text>
      {pipeline.steps && pipeline.steps.length > 0 && (
        <Box flexDirection="column" marginLeft={4}>
          {pipeline.steps.map((step, i) => {
            const stepSymbol = step.status === "failed" ? "✗" : step.status === "completed" ? "✓" : step.status === "building" ? "◌" : "·";
            const stepColor = step.status === "failed" ? "red" : step.status === "completed" ? "green" : step.status === "building" ? "yellow" : undefined;
            return <Text key={i} color={stepColor}>{stepSymbol} {step.name}</Text>;
          })}
        </Box>
      )}
    </Box>
  );
}
