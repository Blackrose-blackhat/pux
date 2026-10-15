#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { WatchApp } from "./tui/WatchApp.js";
import { runDoctor } from "./commands/doctor.js";
import { getCurrentVersion, getUpdateNotice } from "./utils/version-check.js";

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
  .command("doctor")
  .description("Check the local tools Pux will need.")
  .action(async () => {
    const notice = getUpdateNotice();
    await runDoctor();
    const line = await notice;
    if (line) console.log(`\x1b[2m${line}\x1b[0m`);
  });

program.parse();
