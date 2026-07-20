import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { command } from "../github/client.js";
import { githubProvider } from "./github.js";
import { vercelProvider } from "./vercel.js";
import type { Provider } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export type MonorepoInfo = {
  type: "pnpm" | "npm" | "yarn" | "turbo" | "nx" | null;
  packages: string[];
};

export async function detectMonorepo(root: string): Promise<MonorepoInfo> {
  if (await exists(join(root, "pnpm-workspace.yaml"))) {
    const content = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
    const packages = [...content.matchAll(/- +["']?(.+?)["']?\s*$/gm)]
      .map((m) => m[1].replace(/^["']|["']$/g, "").trim())
      .filter(Boolean);
    return { type: "pnpm", packages };
  }

  const pkgPath = join(root, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      if (Array.isArray(pkg.workspaces)) {
        return { type: "npm", packages: pkg.workspaces };
      }
      if (pkg.workspaces?.packages) {
        return { type: "yarn", packages: pkg.workspaces.packages };
      }
    } catch { /* not valid json */ }
  }

  if (await exists(join(root, "turbo.json"))) return { type: "turbo", packages: [] };
  if (await exists(join(root, "nx.json"))) return { type: "nx", packages: [] };

  return { type: null, packages: [] };
}

export type MissingDependency = {
  provider: string;
  reason: string;
  install: string;
};

export async function detectProviders(): Promise<{ providers: Provider[]; repository: string | null; commit: string | null; monorepo: MonorepoInfo; missing: MissingDependency[] }> {
  const root = await command("git", ["rev-parse", "--show-toplevel"]);
  if (!root) return { providers: [], repository: null, commit: null, monorepo: { type: null, packages: [] }, missing: [] };

  const repository = await command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const commit = await command("git", ["rev-parse", "HEAD"]);

  const monorepo = await detectMonorepo(root);

  const detected: Provider[] = [];
  const missing: MissingDependency[] = [];

  if (await githubProvider.detect(root)) {
    detected.push(githubProvider);
  }

  // Check for vercel.json at root and in all workspace packages
  let hasVercelConfig = await exists(join(root, "vercel.json")) || await exists(join(root, ".vercel", "project.json"));

  if (!hasVercelConfig && monorepo.packages.length > 0) {
    for (const pkg of monorepo.packages) {
      const pkgPath = pkg.replace(/\/?\*?\*?$/, ""); // strip glob patterns like "packages/*"
      if (!pkgPath || pkgPath === ".") continue;
      if (await exists(join(root, pkgPath, "vercel.json")) || await exists(join(root, pkgPath, ".vercel", "project.json"))) {
        hasVercelConfig = true;
        break;
      }
    }
  }

  if (hasVercelConfig) {
    const cliAvailable = (await command("vercel", ["--version"])) !== null;
    if (!cliAvailable) {
      missing.push({
        provider: "Vercel",
        reason: "vercel.json found but Vercel CLI is not installed",
        install: "npm install -g vercel",
      });
    } else {
      const authenticated = (await command("vercel", ["whoami"])) !== null;
      if (!authenticated) {
        missing.push({
          provider: "Vercel",
          reason: "Vercel CLI installed but not authenticated",
          install: "vercel login",
        });
      } else {
        detected.push(vercelProvider);
      }
    }
  }

  return { providers: detected, repository, commit, monorepo, missing };
}
