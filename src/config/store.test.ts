import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, loadConfig, saveConfig, setRepoDecision } from "./store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pux-config-"));
  process.env.PUX_CONFIG_DIR = dir;
});

afterEach(async () => {
  delete process.env.PUX_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("config store", () => {
  it("returns defaults when no config exists", async () => {
    expect(await loadConfig()).toEqual({ repos: {} });
  });

  it("round-trips a saved config", async () => {
    await saveConfig({ repos: { "u/r": { agentFiles: true } } });
    expect(await loadConfig()).toEqual({ repos: { "u/r": { agentFiles: true } } });
    expect(configPath()).toBe(join(dir, "config.json"));
  });

  it("records a per-repository decision without clobbering others", async () => {
    await saveConfig({ repos: { "u/a": { agentFiles: false } } });
    await setRepoDecision("u/b", true);
    const config = await loadConfig();
    expect(config.repos).toEqual({ "u/a": { agentFiles: false }, "u/b": { agentFiles: true } });
    expect(JSON.parse(await readFile(join(dir, "config.json"), "utf8")).repos["u/b"].agentFiles).toBe(true);
  });

  it("treats a corrupt file as empty", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), "{not json");
    expect(await loadConfig()).toEqual({ repos: {} });
  });
});
