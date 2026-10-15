import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function command(binary: string, args: string[], options: { cwd?: string } = {}): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, args, { encoding: "utf8", cwd: options.cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}
