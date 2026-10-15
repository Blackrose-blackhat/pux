/**
 * Self-update. When the daily check finds a newer version, Pux starts the
 * upgrade in the background through whichever channel installed it. The new
 * version takes effect on the next launch; a running command is never
 * interrupted. No sudo, ever: a failed install just leaves the manual notice.
 */

import { spawn } from "node:child_process";
import { loadConfig, saveConfig, type PuxConfig, type UpdateAttempt } from "../config/store.js";
import { checkForUpdate, formatUpdateNotice, getCurrentVersion } from "./version-check.js";

export type InstallChannel = "homebrew" | "npm" | "npx";

export function installChannel(scriptPath: string = process.argv[1] ?? ""): InstallChannel {
  if (/\/(?:Cellar|homebrew|Homebrew)\//.test(scriptPath)) return "homebrew";
  if (/\/_npx\//.test(scriptPath)) return "npx";
  return "npm";
}

export type InstallCommand = { binary: string; args: string[] };

export function installCommand(channel: InstallChannel, version: string): InstallCommand | null {
  if (channel === "homebrew") return { binary: "brew", args: ["upgrade", "pux"] };
  if (channel === "npm") return { binary: "npm", args: ["install", "-g", `pux.sh@${version}`] };
  return null;
}

export function autoUpdateEnabled({ env, config }: { env: NodeJS.ProcessEnv; config: Pick<PuxConfig, "autoUpdate"> }): boolean {
  if (env.PUX_NO_AUTO_UPDATE) return false;
  return config.autoUpdate !== false;
}

export type PlanInput = {
  current: string;
  /** Newest published version when it is newer than `current`, else null. */
  latest: string | null;
  channel: InstallChannel;
  enabled: boolean;
  attempt: UpdateAttempt | null;
  now: Date;
};

export type UpdatePlan =
  | { kind: "none" }
  | { kind: "install"; version: string }
  | { kind: "announce"; version: string }
  | { kind: "notice"; version: string };

const retryAfterMs = 24 * 60 * 60 * 1000;

export function planAutoUpdate({ current, latest, channel, enabled, attempt, now }: PlanInput): UpdatePlan {
  if (attempt && attempt.version === current) return { kind: "announce", version: current };
  if (!latest) return { kind: "none" };
  if (!enabled || channel === "npx") return { kind: "notice", version: latest };
  if (attempt && attempt.version === latest && now.getTime() - Date.parse(attempt.startedAt) < retryAfterMs) {
    return { kind: "notice", version: latest };
  }
  return { kind: "install", version: latest };
}

export function describePlan(plan: UpdatePlan, current: string, channel: InstallChannel): string | null {
  if (plan.kind === "none") return null;
  if (plan.kind === "install") return `pux ${plan.version} available · updating in the background, takes effect next run`;
  if (plan.kind === "announce") return `pux updated to ${plan.version}`;
  return formatUpdateNotice(current, plan.version, channel === "homebrew");
}

export type AutoUpdateOptions = {
  current?: string;
  fetchLatest?: () => Promise<string>;
  scriptPath?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

function startInstall(command: InstallCommand): void {
  const child = spawn(command.binary, command.args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

/**
 * Runs the daily check and acts on it: starts a background install when a newer
 * version exists, announces one that has landed, or shows the manual notice.
 * Returns the one dim line to display, or null. Never throws and never blocks.
 */
export async function autoUpdateLine({
  current = getCurrentVersion(),
  fetchLatest,
  scriptPath,
  now = new Date(),
  env = process.env,
}: AutoUpdateOptions = {}): Promise<string | null> {
  try {
    const channel = installChannel(scriptPath);
    const latest = await checkForUpdate({ current, fetchLatest, now });
    const config = await loadConfig();
    const plan = planAutoUpdate({
      current,
      latest,
      channel,
      enabled: autoUpdateEnabled({ env, config }),
      attempt: config.updateAttempt ?? null,
      now,
    });

    if (plan.kind === "install") {
      const command = installCommand(channel, plan.version);
      if (command) {
        await saveConfig({ ...config, updateAttempt: { version: plan.version, startedAt: now.toISOString() } });
        startInstall(command);
      }
    } else if (plan.kind === "announce") {
      const { updateAttempt: _done, ...rest } = config;
      await saveConfig(rest);
    }

    return describePlan(plan, current, channel);
  } catch {
    return null;
  }
}
