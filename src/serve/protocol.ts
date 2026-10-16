/**
 * The JSON-lines protocol `pux serve` speaks with the notch bar: one event per stdout line,
 * one command per stdin line. Field names are the contract; the Swift side mirrors them by hand.
 */

import { z } from "zod";
import type { AgentPlan } from "../agents/instructions.js";
import type { FixProgress, FixResult } from "../agents/fix.js";
import type { Pipeline, ProviderSnapshot } from "../providers/index.js";

export type RepoSummary = { repo: string; repository: string | null; addedAt: string };

export type ProviderSummary = { provider: string; snapshot: ProviderSnapshot };

export type ServeEvent =
  | { type: "hello"; version: string }
  | { type: "repos"; repos: RepoSummary[] }
  | { type: "state"; repo: string; repository: string | null; branch: string | null; commit: string | null; providers: ProviderSummary[] }
  | { type: "failure"; repo: string; pipeline: Pipeline; contextPath: string; errorWindow: string; failedStep: string | null; exitCode: number | null }
  | { type: "consent-needed"; repo: string; repository: string; plan: AgentPlan }
  | { type: "fix-progress"; repo: string; stage: FixProgress["stage"] | "starting"; agent: string | null }
  | { type: "fix-done"; repo: string; result: FixResult | { kind: "error"; message: string } }
  | { type: "rerun-done"; repo: string; pipelineId: string; ok: boolean }
  | { type: "error"; repo?: string; message: string };

export type ServeCommand =
  | { type: "rerun"; repo: string; pipelineId: string }
  | { type: "fix"; repo: string; agent?: string; push?: boolean }
  | { type: "consent"; repo: string; repository: string; allow: boolean }
  | { type: "remove-repo"; repo: string }
  | { type: "shutdown" };

const commandSchema: z.ZodType<ServeCommand> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rerun"), repo: z.string(), pipelineId: z.string() }),
  z.object({ type: z.literal("fix"), repo: z.string(), agent: z.string().optional(), push: z.boolean().optional() }),
  z.object({ type: z.literal("consent"), repo: z.string(), repository: z.string(), allow: z.boolean() }),
  z.object({ type: z.literal("remove-repo"), repo: z.string() }),
  z.object({ type: z.literal("shutdown") }),
]);

/** One event as a single JSON line, newline included. */
export function encodeEvent(event: ServeEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Parses one stdin line into a command. Null when the line is not JSON, the type is unknown, or a field is missing or mistyped. */
export function parseCommand(line: string): ServeCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const result = commandSchema.safeParse(value);
  return result.success ? result.data : null;
}
