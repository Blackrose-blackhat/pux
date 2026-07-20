export type PipelineStatus = "queued" | "building" | "completed" | "failed" | "cancelled";

export type Pipeline = {
  provider: "github-actions" | "vercel";
  id: string;
  name: string;
  status: PipelineStatus;
  actor: string | null;
  url: string | null;
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
}
