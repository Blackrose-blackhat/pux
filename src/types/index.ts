/** A normalized CI run; provider integrations will populate this later. */
export interface WorkflowRun {
  id: string;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "cancelled" | "skipped";
}
