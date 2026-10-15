import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/store.js";
import { checkForUpdate, formatUpdateNotice, isHomebrewInstall, isNewerVersion, upgradeCommand } from "./version-check.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pux-update-"));
  process.env.PUX_CONFIG_DIR = dir;
});

afterEach(async () => {
  delete process.env.PUX_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("isNewerVersion", () => {
  it("compares numerically, not lexically", () => {
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.1.4", "0.1.4")).toBe(false);
    expect(isNewerVersion("0.1.3", "0.1.4")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });
});

describe("upgradeCommand", () => {
  it("points Homebrew installs at brew", () => {
    expect(isHomebrewInstall("/opt/homebrew/Cellar/pux/0.1.4/libexec/bin/pux")).toBe(true);
    expect(isHomebrewInstall("/usr/local/lib/node_modules/pux.sh/dist/cli.js")).toBe(false);
    expect(upgradeCommand(true)).toBe("brew upgrade pux");
    expect(upgradeCommand(false)).toBe("npm install -g pux.sh@latest");
  });
});

describe("checkForUpdate", () => {
  const hour = 60 * 60 * 1000;

  it("fetches, caches, and reports a newer version", async () => {
    let fetches = 0;
    const fetchLatest = async () => { fetches += 1; return "0.2.0"; };

    const latest = await checkForUpdate({ current: "0.1.4", fetchLatest, now: new Date("2026-10-15T10:00:00Z") });

    expect(latest).toBe("0.2.0");
    expect(fetches).toBe(1);
    expect((await loadConfig()).updateCheck).toEqual({ checkedAt: "2026-10-15T10:00:00.000Z", latest: "0.2.0" });
  });

  it("does not fetch again within 24 hours", async () => {
    let fetches = 0;
    const fetchLatest = async () => { fetches += 1; return "0.2.0"; };
    const first = new Date("2026-10-15T10:00:00Z");

    await checkForUpdate({ current: "0.1.4", fetchLatest, now: first });
    const latest = await checkForUpdate({ current: "0.1.4", fetchLatest, now: new Date(first.getTime() + 23 * hour) });

    expect(latest).toBe("0.2.0");
    expect(fetches).toBe(1);
  });

  it("fetches again once the cache is stale", async () => {
    let fetches = 0;
    const fetchLatest = async () => { fetches += 1; return "0.2.0"; };
    const first = new Date("2026-10-15T10:00:00Z");

    await checkForUpdate({ current: "0.1.4", fetchLatest, now: first });
    await checkForUpdate({ current: "0.1.4", fetchLatest, now: new Date(first.getTime() + 25 * hour) });

    expect(fetches).toBe(2);
  });

  it("returns null when already current", async () => {
    expect(await checkForUpdate({ current: "0.2.0", fetchLatest: async () => "0.2.0", now: new Date() })).toBeNull();
  });

  it("returns null when the lookup fails", async () => {
    const fetchLatest = async (): Promise<string> => { throw new Error("offline"); };
    expect(await checkForUpdate({ current: "0.1.0", fetchLatest, now: new Date() })).toBeNull();
  });
});

describe("formatUpdateNotice", () => {
  it("names both versions and the right command", () => {
    expect(formatUpdateNotice("0.1.4", "0.2.0", false)).toBe("pux 0.2.0 available (you have 0.1.4) · npm install -g pux.sh@latest");
  });
});
