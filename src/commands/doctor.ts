import { spawnSync } from "node:child_process";

type Check = { label: string; command: string; optional?: boolean };

const checks: Check[] = [
  { label: "Git", command: "git" },
  { label: "GitHub CLI", command: "gh" },
  { label: "Vercel CLI", command: "vercel", optional: true },
];

export async function runDoctor(): Promise<void> {
  let failed = false;
  for (const check of checks) {
    const result = spawnSync(check.command, ["--version"], { stdio: "ignore" });
    const available = result.status === 0;
    const symbol = available ? "✓" : check.optional ? "○" : "✗";
    const suffix = !available && check.optional ? " (optional)" : "";
    console.log(`${symbol} ${check.label}${suffix}`);
    if (!available && !check.optional) failed = true;
  }

  if (failed) process.exitCode = 1;
}
