import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../config/store.js";
import { autoUpdateLine } from "../utils/auto-update.js";
import { makeRepo, type TempRepo } from "./helpers.js";

const npmPath = "/usr/local/lib/node_modules/pux.sh/dist/cli.js";
const brewPath = "/opt/homebrew/Cellar/pux/0.1.5/libexec/bin/pux";
const now = new Date("2026-10-15T10:00:00Z");
const hour = 60 * 60 * 1000;

let repo: TempRepo;

async function waitForFile(path: string, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`${path} never appeared`);
}

beforeEach(async () => {
  repo = await makeRepo("pux-autoupdate-");
  process.env.PUX_CONFIG_DIR = join(repo.root, "config");
  delete process.env.PUX_NO_AUTO_UPDATE;
});

afterEach(async () => {
  delete process.env.PUX_CONFIG_DIR;
  delete process.env.PUX_NO_AUTO_UPDATE;
  await repo.cleanup();
});

describe("autoUpdateLine", () => {
  it("starts a global npm install in the background and records the attempt", async () => {
    await repo.fakeBin("npm", `echo "$@" > "${repo.root}/npm-args.txt"`);

    const line = await autoUpdateLine({ current: "0.1.5", fetchLatest: async () => "0.1.6", scriptPath: npmPath, now });

    expect(line).toBe("pux 0.1.6 available · updating in the background, takes effect next run");
    expect((await waitForFile(join(repo.root, "npm-args.txt"))).trim()).toBe("install -g pux.sh@0.1.6");
    expect((await loadConfig()).updateAttempt).toEqual({ version: "0.1.6", startedAt: now.toISOString() });
  });

  it("upgrades through brew for Homebrew installs", async () => {
    await repo.fakeBin("brew", `echo "$@" > "${repo.root}/brew-args.txt"`);

    await autoUpdateLine({ current: "0.1.5", fetchLatest: async () => "0.1.6", scriptPath: brewPath, now });

    expect((await waitForFile(join(repo.root, "brew-args.txt"))).trim()).toBe("upgrade pux");
  });

  it("falls back to the manual notice when the install did not land, without retrying for a day", async () => {
    await repo.fakeBin("npm", `echo run >> "${repo.root}/npm-runs.txt"; exit 1`);
    await autoUpdateLine({ current: "0.1.5", fetchLatest: async () => "0.1.6", scriptPath: npmPath, now });
    await waitForFile(join(repo.root, "npm-runs.txt"));

    const line = await autoUpdateLine({ current: "0.1.5", fetchLatest: async () => "0.1.6", scriptPath: npmPath, now: new Date(now.getTime() + 2 * hour) });

    expect(line).toBe("pux 0.1.6 available (you have 0.1.5) · npm install -g pux.sh@latest");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await readFile(join(repo.root, "npm-runs.txt"), "utf8")).trim()).toBe("run");
  });

  it("announces a landed update once, then goes quiet", async () => {
    await saveConfig({ repos: {}, updateAttempt: { version: "0.1.6", startedAt: now.toISOString() } });

    const first = await autoUpdateLine({ current: "0.1.6", fetchLatest: async () => "0.1.6", scriptPath: npmPath, now });
    const second = await autoUpdateLine({ current: "0.1.6", fetchLatest: async () => "0.1.6", scriptPath: npmPath, now });

    expect(first).toBe("pux updated to 0.1.6");
    expect(second).toBeNull();
    expect((await loadConfig()).updateAttempt).toBeUndefined();
  });

  it("only shows the notice when PUX_NO_AUTO_UPDATE is set", async () => {
    process.env.PUX_NO_AUTO_UPDATE = "1";
    await repo.fakeBin("npm", `echo run >> "${repo.root}/npm-runs.txt"`);

    const line = await autoUpdateLine({ current: "0.1.5", fetchLatest: async () => "0.1.6", scriptPath: npmPath, now });

    expect(line).toBe("pux 0.1.6 available (you have 0.1.5) · npm install -g pux.sh@latest");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(readFile(join(repo.root, "npm-runs.txt"), "utf8")).rejects.toThrow();
  });

  it("never throws, even when the registry is unreachable", async () => {
    const line = await autoUpdateLine({ current: "0.1.5", fetchLatest: async () => { throw new Error("offline"); }, scriptPath: npmPath, now });
    expect(line).toBeNull();
  });
});
