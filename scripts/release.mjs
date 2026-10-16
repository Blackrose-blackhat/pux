#!/usr/bin/env node

import { execSync } from "node:child_process";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function run(cmd) {
  console.log(`\x1b[2m$ ${cmd}\x1b[0m`);
  execSync(cmd, { stdio: "inherit" });
}

async function main() {
  const bump = await ask("Version bump (patch / minor / major): ");
  const valid = ["patch", "minor", "major"];
  if (!valid.includes(bump.trim())) {
    console.error(`\x1b[31mInvalid bump type. Must be one of: ${valid.join(", ")}\x1b[0m`);
    process.exit(1);
  }

  const confirm = await ask(`\nThis will bump ${bump.trim()}, build, publish to npm, push the commit and tag, and create the GitHub release with the Pux.app bundle. Continue? [Y/n] `);
  if (confirm.trim().toLowerCase() !== "y" && confirm.trim() !== "") {
    console.log("Aborted.");
    process.exit(0);
  }

  rl.close();

  run(`npm version ${bump.trim()} --no-git-tag-version`);
  run("pnpm run build");
  run("npm publish --access public");

  const pkg = JSON.parse((await import("node:fs")).readFileSync("package.json", "utf8"));
  console.log(`\n\x1b[32m✓ Published pux.sh@${pkg.version}\x1b[0m`);

  run(`git add package.json`);
  run(`git commit -m "${pkg.version}"`);
  run(`git tag v${pkg.version}`);

  run("git push && git push --tags");
  run("bash macos/scripts/build-app.sh");
  run(`gh release create v${pkg.version} macos/Pux-${pkg.version}.zip --title v${pkg.version} --generate-notes`);
  console.log(`\n\x1b[32m✓ Released v${pkg.version}: https://github.com/Blackrose-blackhat/pux/releases/tag/v${pkg.version}\x1b[0m`);
}

main();
