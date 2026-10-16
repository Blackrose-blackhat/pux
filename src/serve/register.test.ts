import { describe, expect, it } from "vitest";
import { registerAndLaunch } from "./register.js";

describe("registerAndLaunch", () => {
  it("registers the repo and reports whether the app launched", async () => {
    const added: string[] = [];
    const r1 = await registerAndLaunch("/tmp/x", "u/x", { addWatchedRepo: async (p) => { added.push(p); }, open: async () => false });
    expect(added).toEqual(["/tmp/x"]); expect(r1).toEqual({ launched: false });
    const r2 = await registerAndLaunch("/tmp/x", "u/x", { addWatchedRepo: async () => {}, open: async (args) => { expect(args).toEqual(["-g", "-b", "sh.pux.bar"]); return true; } });
    expect(r2).toEqual({ launched: true });
  });
});
