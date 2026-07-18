#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { WatchApp } from "./tui/WatchApp.js";
import { runDoctor } from "./commands/doctor.js";

const program = new Command();

program
  .name("pux")
  .description("Package CI failures into AI-ready local context.")
  .version("0.1.3", "-v, --version");

program
  .command("watch")
  .description("Watch the GitHub Actions run for the current commit.")
  .action(() => {
    render(<WatchApp />);
  });

program
  .command("doctor")
  .description("Check the local tools Pux will need.")
  .action(async () => {
    await runDoctor();
  });

program.parse();
