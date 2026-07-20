import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

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
