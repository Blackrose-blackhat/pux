import type { ProviderSnapshot } from "../providers/types.js";

export const activeInterval = 3000;
export const idleInterval = 10000;

/** Polls quickly while something can still change, slowly once every pipeline has settled. */
export function pollIntervalFor(snapshots: ProviderSnapshot[]): number {
  const busy = snapshots.some((snapshot) => {
    if (snapshot.kind === "waiting") return true;
    if (snapshot.kind !== "active") return false;
    return snapshot.pipelines.some((p) => p.status === "queued" || p.status === "building");
  });
  return busy ? activeInterval : idleInterval;
}
