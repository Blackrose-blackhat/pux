import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

export async function checkForUpdate(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("npm", ["view", "pux.sh", "version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const latest = stdout.trim();
    if (latest && latest !== pkg.version) return latest;
    return null;
  } catch {
    return null;
  }
}

export function getCurrentVersion(): string {
  return pkg.version;
}
