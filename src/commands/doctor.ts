import { spawnSync } from "node:child_process";

type Check = { label: string; command: string };

const checks: Check[] = [
  { label: "Git", command: "git" },
  { label: "GitHub CLI", command: "gh" }
];

export async function runDoctor(): Promise<void> {
  let failed = false;
  for (const check of checks) {
    const result = spawnSync(check.command, ["--version"], { stdio: "ignore" });
    const available = result.status === 0;
    console.log(`${available ? "✓" : "✗"} ${check.label}`);
    failed ||= !available;
  }

  if (failed) process.exitCode = 1;
}
