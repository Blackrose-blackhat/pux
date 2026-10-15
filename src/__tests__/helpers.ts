import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TempRepo = {
  root: string;
  binDir: string;
  git: (args: string) => string;
  commit: (file: string, content: string, message: string) => Promise<string>;
  /** Writes an executable bash script named `name` onto the PATH used by the test. */
  fakeBin: (name: string, body: string) => Promise<void>;
  cleanup: () => Promise<void>;
};

/** Creates a throwaway git repository with one commit and prepends a fake bin dir to PATH. */
export async function makeRepo(prefix = "pux-test-"): Promise<TempRepo> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const binDir = join(root, "fake-bin");
  await mkdir(binDir);
  const originalPath = process.env.PATH ?? "";
  const originalCwd = process.cwd();
  process.env.PATH = `${binDir}:${originalPath}`;
  process.chdir(root);

  const git = (args: string): string =>
    execSync(`git ${args}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

  git("init -q -b main");
  git("config user.email test@test.io");
  git("config user.name Test");

  const commit = async (file: string, content: string, message: string): Promise<string> => {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), content);
    git("add -A");
    git(`commit -q -m "${message}"`);
    return git("rev-parse HEAD");
  };

  await commit("README.md", "# test\n", "initial");

  return {
    root,
    binDir,
    git,
    commit,
    fakeBin: async (name, body) => {
      await writeFile(join(binDir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    },
    cleanup: async () => {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
      await rm(root, { recursive: true, force: true });
    },
  };
}
