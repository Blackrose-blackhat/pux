import { access } from "node:fs/promises";
import { join } from "node:path";
import { command } from "../github/client.js";
import type { Pipeline, Provider, ProviderSnapshot } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type VercelDeployment = {
  url: string;
  name: string;
  state: string;
  target: string | null;
  creator?: { username: string };
  meta?: { githubCommitSha?: string };
};

type VercelListResponse = {
  deployments?: VercelDeployment[];
};

function mapStatus(state: string): Pipeline["status"] {
  switch (state.toUpperCase()) {
    case "QUEUED": case "INITIALIZING": return "queued";
    case "BUILDING": return "building";
    case "READY": return "completed";
    case "ERROR": return "failed";
    case "CANCELED": return "cancelled";
    default: return "building";
  }
}

export const vercelProvider: Provider = {
  name: "Vercel",

  async detect(root: string): Promise<boolean> {
    if ((await command("vercel", ["--version"])) === null) return false;
    const hasConfig = await exists(join(root, "vercel.json"));
    const hasLinked = await exists(join(root, ".vercel", "project.json"));
    return hasConfig || hasLinked;
  },

  async poll(_repository: string, commit: string): Promise<ProviderSnapshot> {
    const raw = await command("vercel", [
      "ls", "-F", "json", "--limit", "5", "--meta", `githubCommitSha=${commit}`,
    ]);

    if (!raw) return { kind: "unavailable" };

    let response: VercelListResponse;
    try {
      response = JSON.parse(raw) as VercelListResponse;
    } catch {
      return { kind: "unavailable" };
    }

    const deployments = response.deployments;
    if (!deployments || deployments.length === 0) {
      // No deployments for this commit — try latest
      const fallbackRaw = await command("vercel", ["ls", "-F", "json", "--limit", "3"]);
      if (!fallbackRaw) return { kind: "waiting" };

      let fallback: VercelListResponse;
      try {
        fallback = JSON.parse(fallbackRaw) as VercelListResponse;
      } catch {
        return { kind: "waiting" };
      }

      if (!fallback.deployments || fallback.deployments.length === 0) return { kind: "waiting" };

      return {
        kind: "active",
        pipelines: fallback.deployments.map((d) => ({
          provider: "vercel" as const,
          id: d.url,
          name: d.name,
          status: mapStatus(d.state),
          actor: d.creator?.username || null,
          url: `https://${d.url}`,
          commit: d.meta?.githubCommitSha?.slice(0, 7) || null,
        })),
      };
    }

    const pipelines: Pipeline[] = deployments.map((d) => ({
      provider: "vercel" as const,
      id: d.url,
      name: d.name,
      status: mapStatus(d.state),
      actor: d.creator?.username || null,
      url: `https://${d.url}`,
      commit: d.meta?.githubCommitSha?.slice(0, 7) || null,
    }));

    return { kind: "active", pipelines };
  },

  async getLogs(pipeline: Pipeline): Promise<string | null> {
    return command("vercel", ["inspect", pipeline.id, "--logs"]);
  },
};
