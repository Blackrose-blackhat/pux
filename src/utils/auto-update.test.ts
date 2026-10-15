import { describe, expect, it } from "vitest";
import {
  autoUpdateEnabled,
  describePlan,
  installChannel,
  installCommand,
  planAutoUpdate,
  type PlanInput,
} from "./auto-update.js";

describe("installChannel", () => {
  it("recognises Homebrew, npx and global npm installs from the script path", () => {
    expect(installChannel("/opt/homebrew/Cellar/pux/0.1.5/libexec/bin/pux")).toBe("homebrew");
    expect(installChannel("/Users/me/.npm/_npx/1a2b3c/node_modules/pux.sh/dist/cli.js")).toBe("npx");
    expect(installChannel("/usr/local/lib/node_modules/pux.sh/dist/cli.js")).toBe("npm");
    expect(installChannel("/Users/me/.nvm/versions/node/v22.0.0/bin/pux")).toBe("npm");
  });
});

describe("installCommand", () => {
  it("upgrades through the channel that installed Pux, pinned to the version found", () => {
    expect(installCommand("homebrew", "0.1.6")).toEqual({ binary: "brew", args: ["upgrade", "pux"] });
    expect(installCommand("npm", "0.1.6")).toEqual({ binary: "npm", args: ["install", "-g", "pux.sh@0.1.6"] });
  });

  it("has nothing to run for npx, which fetches the latest version itself", () => {
    expect(installCommand("npx", "0.1.6")).toBeNull();
  });
});

describe("autoUpdateEnabled", () => {
  it("is on by default", () => {
    expect(autoUpdateEnabled({ env: {}, config: {} })).toBe(true);
  });

  it("is off with PUX_NO_AUTO_UPDATE or autoUpdate: false in the config", () => {
    expect(autoUpdateEnabled({ env: { PUX_NO_AUTO_UPDATE: "1" }, config: {} })).toBe(false);
    expect(autoUpdateEnabled({ env: {}, config: { autoUpdate: false } })).toBe(false);
    expect(autoUpdateEnabled({ env: { PUX_NO_AUTO_UPDATE: "" }, config: { autoUpdate: true } })).toBe(true);
  });
});

describe("planAutoUpdate", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  const base: PlanInput = { current: "0.1.5", latest: "0.1.6", channel: "npm", enabled: true, attempt: null, now };

  it("does nothing when Pux is current", () => {
    expect(planAutoUpdate({ ...base, latest: null })).toEqual({ kind: "none" });
  });

  it("installs a newer version in the background", () => {
    expect(planAutoUpdate(base)).toEqual({ kind: "install", version: "0.1.6" });
  });

  it("only shows the notice when auto-update is off", () => {
    expect(planAutoUpdate({ ...base, enabled: false })).toEqual({ kind: "notice", version: "0.1.6" });
  });

  it("only shows the notice for npx, which has nothing to install", () => {
    expect(planAutoUpdate({ ...base, channel: "npx" })).toEqual({ kind: "notice", version: "0.1.6" });
  });

  it("announces once after an install has landed", () => {
    const attempt = { version: "0.1.6", startedAt: "2026-10-15T09:00:00Z" };
    expect(planAutoUpdate({ ...base, current: "0.1.6", latest: null, attempt })).toEqual({ kind: "announce", version: "0.1.6" });
  });

  it("does not retry an install started less than a day ago", () => {
    const attempt = { version: "0.1.6", startedAt: "2026-10-15T09:00:00Z" };
    expect(planAutoUpdate({ ...base, attempt })).toEqual({ kind: "notice", version: "0.1.6" });
  });

  it("retries an install that is more than a day old", () => {
    const attempt = { version: "0.1.6", startedAt: "2026-10-13T09:00:00Z" };
    expect(planAutoUpdate({ ...base, attempt })).toEqual({ kind: "install", version: "0.1.6" });
  });

  it("installs a newer version even if an older one was attempted recently", () => {
    const attempt = { version: "0.1.6", startedAt: "2026-10-15T09:00:00Z" };
    expect(planAutoUpdate({ ...base, latest: "0.1.7", attempt })).toEqual({ kind: "install", version: "0.1.7" });
  });
});

describe("describePlan", () => {
  it("renders one dim line per outcome", () => {
    expect(describePlan({ kind: "none" }, "0.1.5", "npm")).toBeNull();
    expect(describePlan({ kind: "install", version: "0.1.6" }, "0.1.5", "npm")).toBe("pux 0.1.6 available · updating in the background, takes effect next run");
    expect(describePlan({ kind: "announce", version: "0.1.6" }, "0.1.6", "npm")).toBe("pux updated to 0.1.6");
    expect(describePlan({ kind: "notice", version: "0.1.6" }, "0.1.5", "homebrew")).toBe("pux 0.1.6 available (you have 0.1.5) · brew upgrade pux");
  });
});
