#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { WatchApp } from "./tui/WatchApp.js";
import { runDoctor } from "./commands/doctor.js";
import { checkForUpdate, getCurrentVersion } from "./utils/version-check.js";

async function notifyIfOutdated() {
  const latest = await checkForUpdate();
  if (latest) {
    const current = getCurrentVersion();
    console.log(`\x1b[33m⚠ pux ${current} → ${latest} available. Run: npm install -g pux.sh\x1b[0m\n`);
  }
}

const program = new Command();

program
  .name("pux")
  .description("Package CI failures into AI-ready local context.")
  .version(getCurrentVersion(), "-v, --version");

program
  .command("watch")
  .description("Watch the GitHub Actions run for the current commit.")
  .action(async () => {
    await notifyIfOutdated();
    process.stdout.write("\x1B[2J\x1B[H");
    render(<WatchApp />, { patchConsole: false });
  });

program
  .command("doctor")
  .description("Check the local tools Pux will need.")
  .action(async () => {
    await notifyIfOutdated();
    await runDoctor();
  });

program.parse();
