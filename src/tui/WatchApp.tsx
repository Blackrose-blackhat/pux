import { Box, Text, useApp } from "ink";
import React, { useEffect, useRef, useState } from "react";
import { ensureAgentInstructions, type AgentInstructionResult } from "../agents/instructions.js";
import { generateFailureContext } from "../context/generate.js";
import { getWatchSnapshot, type GitHubJob, type WatchSnapshot } from "../github/client.js";
import { Pet, type PetMood } from "./Pet.js";

type ContextStatus = "idle" | "generating" | "written" | "error";

export function WatchApp() {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<WatchSnapshot>({ kind: "checking" });
  const [contextStatus, setContextStatus] = useState<ContextStatus>("idle");
  const [agentInstructions, setAgentInstructions] = useState<AgentInstructionResult | null>(null);
  const generatedFor = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await getWatchSnapshot();
      if (active) setSnapshot(next);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    const onKeypress = (data: Buffer) => {
      if (data.toString() === "q" || data.toString() === "\u0003") exit();
    };
    process.stdin.on("data", onKeypress);
    return () => {
      active = false;
      clearInterval(timer);
      process.stdin.off("data", onKeypress);
    };
  }, [exit]);

  useEffect(() => {
    void ensureAgentInstructions().then(setAgentInstructions).catch(() => setAgentInstructions(null));
  }, []);

  useEffect(() => {
    if (snapshot.kind !== "run" || snapshot.run.status !== "completed" || snapshot.run.conclusion !== "failure") return;
    if (generatedFor.current === snapshot.run.databaseId) return;

    generatedFor.current = snapshot.run.databaseId;
    setContextStatus("generating");
    void generateFailureContext(snapshot)
      .then(() => setContextStatus("written"))
      .catch(() => setContextStatus("error"));
  }, [snapshot]);

  const mood: PetMood =
    snapshot.kind === "run" && snapshot.run.status === "completed" && snapshot.run.conclusion === "failure" ? "sad" :
    snapshot.kind === "run" && snapshot.run.status === "completed" ? "happy" :
    snapshot.kind === "run" ? "watching" :
    "idle";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Pet mood={mood} />
        <Box flexDirection="column" marginLeft={1} justifyContent="center">
          <Text color="cyan" bold>pux</Text>
          <Text dimColor>CI context, ready for your AI</Text>
        </Box>
      </Box>
      <Status snapshot={snapshot} contextStatus={contextStatus} agentInstructions={agentInstructions} />
      <Box marginTop={1}><Text dimColor>Refreshes every 3s · press q to quit</Text></Box>
    </Box>
  );
}

function Status({ snapshot, contextStatus, agentInstructions }: { snapshot: WatchSnapshot; contextStatus: ContextStatus; agentInstructions: AgentInstructionResult | null }) {
  if (snapshot.kind === "checking") return <Text color="yellow">◌ Checking this project…</Text>;
  if (snapshot.kind === "no-repository") return <Text color="red">✗ Not inside a Git repository.</Text>;
  if (snapshot.kind === "gh-unavailable") return <Text color="red">✗ GitHub CLI is not installed. Install it with: brew install gh</Text>;
  if (snapshot.kind === "not-authenticated") return <Text color="red">✗ GitHub CLI is not authenticated. Run: gh auth login</Text>;
  if (snapshot.kind === "no-workflows") {
    return <Box flexDirection="column"><Text color="yellow">No GitHub Actions workflows found.</Text><Text dimColor>Pux currently watches GitHub Actions only.</Text></Box>;
  }
  if (snapshot.kind === "waiting") {
    return <Box flexDirection="column"><Text>✓ Repository: {snapshot.repository}</Text><Text color="yellow">◌ Waiting for a GitHub Actions run for {snapshot.commit.slice(0, 7)}…</Text></Box>;
  }

  const { run } = snapshot;
  const label = run.workflowName ?? run.name;
  const failed = run.status === "completed" && run.conclusion === "failure";
  const completed = run.status === "completed";
  return (
    <Box flexDirection="column">
      <Text>✓ Repository: {snapshot.repository}</Text>
      <Text>✓ Workflow: {label} <Text dimColor>#{run.databaseId}</Text>{run.actor && <Text dimColor> · pushed by </Text>}{run.actor && <Text color="cyan">{run.actor.login}</Text>}</Text>
      <Text color={failed ? "red" : completed ? "green" : "yellow"}>{failed ? "✗ Failed" : completed ? "✓ Completed" : "◌ Running"}</Text>
      <JobProgress jobs={snapshot.jobs} />
      {failed && contextStatus === "generating" && <Text color="yellow">◌ Downloading failed logs and collecting context…</Text>}
      {failed && contextStatus === "written" && <Text color="green">✓ Wrote .ai-context/failure.md</Text>}
      {failed && contextStatus === "error" && <Text color="red">✗ Could not create .ai-context/failure.md</Text>}
      {agentInstructions && agentInstructions.added.length > 0 && <Text color="green">✓ Connected CI context to {agentInstructions.added.join(", ")}</Text>}
    </Box>
  );
}

function JobProgress({ jobs }: { jobs: GitHubJob[] }) {
  if (jobs.length === 0) return <Text dimColor>Loading job progress…</Text>;

  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const width = 12;
  const filled = Math.round((completedJobs / jobs.length) * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>Progress <Text color="cyan">{bar}</Text> {completedJobs}/{jobs.length} jobs</Text>
      {jobs.map((job) => {
        const failed = job.status === "completed" && job.conclusion === "failure";
        const finished = job.status === "completed";
        const activeStep = job.steps.find((step) => step.status === "in_progress");
        const completedSteps = job.steps.filter((step) => step.status === "completed").length;
        const symbol = failed ? "✗" : finished ? "✓" : job.status === "in_progress" ? "◌" : "·";
        const color = failed ? "red" : finished ? "green" : job.status === "in_progress" ? "yellow" : undefined;
        return (
          <Box key={job.databaseId} flexDirection="column">
            <Text color={color}>{symbol} {job.name}{job.status === "in_progress" && job.steps.length > 0 ? ` · ${completedSteps}/${job.steps.length} steps` : ""}</Text>
            {activeStep && <Text dimColor>  ↳ {activeStep.name}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
