import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { command } from "../github/client.js";
import type { Pipeline, Provider, ProviderSnapshot } from "./types.js";

type GitHubRunRaw = {
  databaseId: number;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  name: string;
  workflowName: string | null;
  headSha: string;
  createdAt: string;
};

type GitHubStep = {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
};

type GitHubJob = {
  databaseId: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  steps: GitHubStep[];
};

function parseJSON<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mapStatus(run: GitHubRunRaw): Pipeline["status"] {
  if (run.status === "queued") return "queued";
  if (run.status === "in_progress") return "building";
  if (run.conclusion === "failure") return "failed";
  if (run.conclusion === "cancelled") return "cancelled";
  return "completed";
}

function flattenSteps(jobs: GitHubJob[]): Pipeline["steps"] {
  return jobs.map((job) => {
    const activeStep = job.steps.find((s) => s.status === "in_progress");
    const stepLabel = activeStep ? ` · ${activeStep.name}` : "";
    const status = job.conclusion === "failure" ? "failed"
      : job.status === "completed" ? "completed"
      : job.status === "in_progress" ? "building"
      : "queued";
    return { name: `${job.name}${stepLabel}`, status };
  });
}

export const githubProvider: Provider = {
  name: "GitHub Actions",

  async detect(root: string): Promise<boolean> {
    if ((await command("gh", ["--version"])) === null) return false;
    if ((await command("gh", ["auth", "status"])) === null) return false;
    // Check locally for workflow files — avoids an API call
    const workflowsDir = join(root, ".github", "workflows");
    try {
      await access(workflowsDir);
      const files = await readdir(workflowsDir);
      return files.some((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    } catch {
      return false;
    }
  },

  async poll(repository: string, commit: string): Promise<ProviderSnapshot> {
    const raw = await command("gh", [
      "run", "list",
      "--commit", commit,
      "--limit", "5",
      "--json", "databaseId,status,conclusion,name,workflowName,headSha,createdAt",
    ]);
    const runs = parseJSON<GitHubRunRaw[]>(raw);
    if (!runs || runs.length === 0) return { kind: "waiting" };

    const pipelines: Pipeline[] = await Promise.all(
      runs.map(async (run) => {
        const detail = parseJSON<{ jobs?: GitHubJob[] }>(
          await command("gh", ["run", "view", String(run.databaseId), "--json", "jobs"])
        );
        const actorLogin = await command("gh", [
          "api", `repos/${repository}/actions/runs/${run.databaseId}`, "--jq", ".actor.login",
        ]);

        return {
          provider: "github-actions" as const,
          id: String(run.databaseId),
          name: run.workflowName ?? run.name,
          status: mapStatus(run),
          actor: actorLogin || null,
          url: `https://github.com/${repository}/actions/runs/${run.databaseId}`,
          commit: run.headSha?.slice(0, 7) || null,
          steps: flattenSteps(detail?.jobs ?? []),
        };
      })
    );

    return { kind: "active", pipelines };
  },

  async getLogs(pipeline: Pipeline): Promise<string | null> {
    return command("gh", ["run", "view", pipeline.id, "--log-failed"]);
  },
};
