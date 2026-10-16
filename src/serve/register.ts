/**
 * What `pux watch` does in the background: adds the repo to the notch bar's watch list and
 * launches the Pux menu bar app if it is installed.
 */

import { addWatchedRepo } from "../config/store.js";
import { command } from "../github/client.js";

export type RegisterDeps = {
  addWatchedRepo: typeof addWatchedRepo;
  /** Default: `open <args>` succeeded. */
  open: (args: string[]) => Promise<boolean>;
};

const appBundleId = "sh.pux.bar";

const defaultDeps: RegisterDeps = {
  addWatchedRepo,
  open: async (args) => (await command("open", args)) !== null,
};

/** Registers root and launches the app in the background. launched=false when the app is not installed; never throws. */
export async function registerAndLaunch(root: string, repository: string | null, deps: Partial<RegisterDeps> = {}): Promise<{ launched: boolean }> {
  const { addWatchedRepo: add, open } = { ...defaultDeps, ...deps };
  try {
    await add(root, repository);
    return { launched: await open(["-g", "-b", appBundleId]) };
  } catch {
    return { launched: false };
  }
}
