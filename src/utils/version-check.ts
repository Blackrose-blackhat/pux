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

export async function autoUpdate(): Promise<boolean> {
  const latest = await checkForUpdate();
  if (!latest) return false;

  const current = pkg.version;
  console.log(`\x1b[33m⚠ pux ${current} → ${latest} available. Updating...\x1b[0m`);

  try {
    await execFileAsync("npm", ["install", "-g", "pux.sh@latest"], {
      encoding: "utf8",
      timeout: 60000,
    });
    console.log(`\x1b[32m✓ Updated to pux ${latest}\x1b[0m\n`);
    return true;
  } catch {
    // Fallback: try with sudo on unix
    if (process.platform !== "win32") {
      try {
        await execFileAsync("sudo", ["npm", "install", "-g", "pux.sh@latest"], {
          encoding: "utf8",
          timeout: 60000,
          stdio: "inherit" as never,
        });
        console.log(`\x1b[32m✓ Updated to pux ${latest}\x1b[0m\n`);
        return true;
      } catch {
        console.log(`\x1b[31m✗ Auto-update failed. Run manually: npm install -g pux.sh\x1b[0m\n`);
        return false;
      }
    }
    console.log(`\x1b[31m✗ Auto-update failed. Run manually: npm install -g pux.sh\x1b[0m\n`);
    return false;
  }
}

export function getCurrentVersion(): string {
  return pkg.version;
}
