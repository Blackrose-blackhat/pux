import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../providers/types.js";
import { pollIntervalFor } from "./polling.js";

const pipeline = (status: "queued" | "building" | "completed" | "failed" | "cancelled") => ({
  provider: "github-actions" as const, id: "1", name: "CI", status, actor: null, url: null,
  commitSha: null, startedAt: null,
});

describe("pollIntervalFor", () => {
  it("polls fast while a pipeline is queued or building", () => {
    const snapshots: ProviderSnapshot[] = [{ kind: "active", pipelines: [pipeline("completed"), pipeline("building")] }];
    expect(pollIntervalFor(snapshots)).toBe(3000);
  });

  it("polls fast while waiting for a run to appear", () => {
    expect(pollIntervalFor([{ kind: "waiting" }])).toBe(3000);
  });

  it("slows down once every pipeline has finished", () => {
    const snapshots: ProviderSnapshot[] = [{ kind: "active", pipelines: [pipeline("completed"), pipeline("failed")] }];
    expect(pollIntervalFor(snapshots)).toBe(10000);
  });

  it("slows down when no provider is available", () => {
    expect(pollIntervalFor([{ kind: "unavailable" }])).toBe(10000);
  });
});
