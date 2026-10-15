export type PipelineStatus = "queued" | "building" | "completed" | "failed" | "cancelled";

export type Pipeline = {
  provider: "github-actions" | "vercel";
  id: string;
  name: string;
  status: PipelineStatus;
  actor: string | null;
  url: string | null;
  /** Short commit hash for display. */
  commit?: string | null;
  /** Full commit SHA the pipeline ran for, when the provider exposes it. */
  commitSha: string | null;
  /** ISO timestamp the pipeline started, used to name the failure bundle. */
  startedAt: string | null;
  steps?: { name: string; status: string }[];
};

export type ProviderSnapshot =
  | { kind: "unavailable" }
  | { kind: "waiting" }
  | { kind: "active"; pipelines: Pipeline[] };

export interface Provider {
  name: string;
  detect(root: string): Promise<boolean>;
  poll(repository: string, commit: string): Promise<ProviderSnapshot>;
  getLogs(pipeline: Pipeline): Promise<string | null>;
  rerun?(pipeline: Pipeline): Promise<boolean>;
}
