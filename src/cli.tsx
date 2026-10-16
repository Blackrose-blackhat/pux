#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import { createInterface } from "node:readline";
import React from "react";
import { WatchApp } from "./tui/WatchApp.js";
import { runDoctor } from "./commands/doctor.js";
import { runFixCommand } from "./commands/fix.js";
import { autoUpdateLine } from "./utils/auto-update.js";
import { getCurrentVersion } from "./utils/version-check.js";
import { detectProviders } from "./providers/index.js";
import { encodeEvent, parseCommand, type ServeEvent } from "./serve/protocol.js";
import { createSupervisor, defaultSupervisorDeps } from "./serve/supervisor.js";
import { createWorker } from "./serve/worker.js";

const program = new Command();

program
  .name("pux")
  .description("Package CI failures into AI-ready local context.")
  .version(getCurrentVersion(), "-v, --version");

program
  .command("watch")
  .description("Watch the GitHub Actions run for the current commit.")
  .action(() => {
    // Enter alternate screen buffer + clear
    process.stdout.write("\x1B[?1049h\x1B[2J\x1B[H");
    const instance = render(<WatchApp />);
    instance.waitUntilExit().then(() => {
      // Leave alternate screen buffer — restores original terminal content
      process.stdout.write("\x1B[?1049l");
    });
  });

program
  .command("fix")
  .description("Ask your installed coding agent to fix the latest captured failure on a new branch.")
  .option("--agent <id>", "agent to use: claude, codex or cursor-agent (default: first found on PATH)")
  .option("--push", "push the fix branch to origin when the agent changed something")
  .option("--dry-run", "show the agent and prompt that would be used without running anything")
  .action(async (options: { agent?: string; push?: boolean; dryRun?: boolean }) => {
    const notice = autoUpdateLine();
    await runFixCommand(options);
    const line = await notice;
    if (line) console.log(`\x1b[2m${line}\x1b[0m`);
  });

program
  .command("doctor")
  .description("Check the local tools Pux will need.")
  .action(async () => {
    const notice = autoUpdateLine();
    await runDoctor();
    const line = await notice;
    if (line) console.log(`\x1b[2m${line}\x1b[0m`);
  });

program
  .command("serve")
  .description("Run the engine headless for the Pux menu bar app; speaks JSON lines on stdin/stdout.")
  .action(async () => {
    const supervisor = createSupervisor(defaultSupervisorDeps(getCurrentVersion()));
    const input = createInterface({ input: process.stdin });
    input.on("line", (line) => {
      void supervisor.handleLine(line).catch(() => undefined);
    });
    input.on("close", () => supervisor.stop());
    await supervisor.start();
    await supervisor.closed;
    process.exit(0);
  });

program
  .command("serve-worker <path>", { hidden: true })
  .description("Run the engine for one repository; spawned by `pux serve`.")
  .action(async (path: string) => {
    // The engine resolves the repo root from cwd, so this must come before detection.
    process.chdir(path);
    const emit = (event: ServeEvent) => {
      process.stdout.write(encodeEvent(event));
    };
    const { providers, repository } = await detectProviders();

    const worker = createWorker({ root: path, repository, providers, emit });
    // Started even when detection found nothing: each tick then re-detects and reports
    // providerUnavailableMessage once, so a later `gh auth login` is picked up without a restart.
    worker.start();

    const input = createInterface({ input: process.stdin });
    input.on("line", (line) => {
      const command = parseCommand(line);
      if (command) void worker.handle(command);
    });
    input.on("close", () => {
      worker.stop();
      process.exit(0);
    });
  });

program.parse();
