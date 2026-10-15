# Architecture

## Principle

The engine is the product. The UI is just a surface.

The engine can run headless (CLI), in a TUI (Ink), or inside a native app (Tauri). The core logic never depends on how it's displayed.

---

## System Diagram

```
┌──────────────────────────────────────────────────────────┐
│                        UI Layer                          │
│                                                          │
│   ┌─────────┐   ┌──────────────┐   ┌───────────────┐   │
│   │   CLI   │   │   TUI (Ink)  │   │  Menu Bar     │   │
│   │  doctor │   │   WatchApp   │   │  (Tauri)      │   │
│   └────┬────┘   └──────┬───────┘   └───────┬───────┘   │
│        │               │                    │           │
└────────┼───────────────┼────────────────────┼───────────┘
         │               │                    │
         ▼               ▼                    ▼
┌──────────────────────────────────────────────────────────┐
│                      Engine Layer                         │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │                    Providers                      │   │
│   │   GitHub Actions (gh)      Vercel (vercel)        │   │
│   └──────────────────────────┬───────────────────────┘   │
│                              │ Pipeline                  │
│                              ▼                           │
│   ┌──────────────┐  ┌───────────────┐  ┌─────────────┐  │
│   │  context/    │  │  context/     │  │  context/   │  │
│   │  report.ts   │  │  diff.ts      │  │  generate.ts│  │
│   └──────────────┘  └───────────────┘  └─────────────┘  │
│                              │                           │
│                              ▼                           │
│   ┌──────────────────────────────────────────────────┐   │
│   │   agents/instructions.ts   (plan → consent → apply)│  │
│   └──────────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────────┐   │
│   │   config/store.ts   (~/.config/pux/config.json)   │   │
│   └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## Modules

### `src/providers/`

Each CI or deployment service is a `Provider` with four operations: `detect` (is this repo using it, is the CLI installed and authenticated), `poll` (pipelines for a commit), `getLogs` (raw failure log for one pipeline), and optional `rerun`. Providers return a normalised `Pipeline` that carries status, actor, URL, the full commit SHA, and the start time. Everything downstream works on `Pipeline`, never on provider-specific shapes.

- `github.ts` wraps the `gh` CLI. It caches a run's actor once and its job details once the run has completed, so a settled run costs one list call per poll. When `--log-failed` returns nothing (cancelled or timed-out jobs), it falls back to the full log.
- `vercel.ts` wraps the `vercel` CLI, matching deployments to the commit through `githubCommitSha` metadata and falling back to the latest deployments.
- `detect.ts` finds the repo root, repository name and commit, inspects monorepo layouts for `vercel.json`, and reports missing or unauthenticated CLIs so the TUI can offer to install them.

**Why CLIs and not REST APIs?** Zero auth setup. The user already has `gh auth login` and `vercel login` configured. We inherit their tokens, rate limits, and enterprise config for free.

### `src/context/report.ts`

Pure functions, no I/O. This is where the quality of the report is decided, so it is unit-tested against realistic logs.

- `parseFailedLog` splits the `job\tstep\tline` format `gh` emits into ordered steps and strips timestamps and ANSI codes.
- `scoreLine` ranks lines: explicit markers (`##[error]`, `npm ERR!`, `error TS1234`, `Traceback`, `FAIL`, exit codes) score 3, bare `error`/`failed` score 1, and known noise (`0 errors`, `Failed to restore cache`, warnings) scores 0.
- `extractErrorWindow` takes the window around the best-scoring line, or the log tail when nothing matches.
- `parseExitCode`, `detectReproCommand`, `findOverlap`, and `renderReport` do what their names say. The exit code is omitted when the log never states one.

### `src/context/diff.ts`

Resolves the diff that led to a commit. It pins to the pipeline's SHA (fetching it if missing locally), finds the merge-base with the default branch, and diffs from there so a multi-commit push is covered. When the commit is already on the default branch it diffs from the parent. The report states the range it used.

### `src/context/generate.ts`

Orchestration: logs from the provider, diff from `diff.ts`, report from `report.ts`, then writes `.ai-context/failure.md` and a bundle at `.ai-context/failures/<timestamp>-<pipeline id>/metadata.json`. It also keeps `.ai-context/` in the repo's `.gitignore`.

### `src/agents/instructions.ts`

Two phases. `planAgentInstructions` returns exactly which instruction files would be created, appended, or are already present, without writing anything. `applyAgentInstructions` carries that plan out, skipping files it cannot write. Files are appended to when they exist; new files are created only for `AGENTS.md`, for agents installed on the machine, or for agents with repo-level evidence (an existing `.cursor/rules/`). Agent detection is injectable so tests never depend on the developer's machine.

The TUI shows the plan and asks once per repository. The answer is stored by `config/store.ts`.

### `src/agents/fix.ts`

The `pux fix` engine. A small catalog lists the supported agent CLIs (`claude`, `codex`, `cursor-agent`) with the arguments that run each one non-interactively, prompt last. `detectAgents` checks PATH (injectable for tests), `selectAgent` applies `--agent` or the catalog order, `buildFixPrompt` writes the instructions that point the agent at `.ai-context/failure.md`, and `readLatestFailure` finds the newest bundle's commit and pipeline id.

`runFix` creates `pux/fix-<pipeline id>` from the run's commit as a temporary git worktree under `.ai-context/fix/`, spawns the agent there, commits whatever changed (excluding `.ai-context/`), and removes the worktree. The user's checkout is never touched, which also keeps the running TUI from reacting to a HEAD change. No changes means the branch is deleted too. `--push` is the only way anything leaves the machine; Pux never opens a pull request. The agent's explanation is read from `<pux-explanation>` markers in its stdout and becomes the commit body.

### `src/commands/fix.ts`

Stdout reporting for `pux fix` (`--agent`, `--push`, `--dry-run`) and the one-line result summary the TUI reuses.

### `src/config/store.ts`

A small JSON file at `$PUX_CONFIG_DIR`, `$XDG_CONFIG_HOME/pux`, or `~/.config/pux`. It holds per-repository consent and the update-check cache.

### `src/utils/version-check.ts`

Looks up the latest published version at most once a day, caches it in the config, and formats the manual upgrade line (`brew upgrade pux` under Homebrew). Pure version comparison lives here too.

### `src/utils/auto-update.ts`

Acts on that check. `installChannel` reads the script path to tell Homebrew, global npm and npx installs apart; `installCommand` maps a channel to `brew upgrade pux` or `npm install -g pux.sh@<version>` (nothing for npx). `planAutoUpdate` is pure: it decides between install, announce (the attempted version is now running), notice (auto-update off, npx, or an install started less than a day ago that has not landed) and none. `autoUpdateLine` runs the check, spawns the installer detached with its output ignored, records the attempt in the config, and returns the one dim line the CLI and TUI print. It never blocks, prompts, escalates to sudo, or throws. `PUX_NO_AUTO_UPDATE=1` or `autoUpdate: false` in the config turns installs off.

### `src/tui/WatchApp.tsx`

Ink terminal UI. Detects providers, polls them with `pollIntervalFor` (3s while anything is queued or building, 10s once settled), renders pipelines grouped by provider, and triggers `generateFailureContext` once per failed pipeline. Also hosts the install prompts for missing CLIs, the consent prompt, the `r` re-run key, and the `f` key that runs `runFix` once a failure context has been written.

### `src/tui/Pet.tsx`

Animated ASCII cat. Mood driven by CI state. Pure cosmetic.

### `src/commands/doctor.ts`

Checks for `git`, `gh`, and optionally `vercel` in PATH.

---

## Data Flow

```
1. User runs `pux watch`
2. detectProviders() finds the repo, commit, and usable providers
3. First time in this repo: planAgentInstructions() → consent prompt → applyAgentInstructions()
4. Each tick: provider.poll(repository, commit) → Pipeline[]
5. UI renders pipelines; interval adapts to whether anything is still running
6. On a pipeline with status "failed" (once per provider:id):
   a. provider.getLogs(pipeline)
   b. collectDiff() from the branch base at pipeline.commitSha
   c. renderReport() → .ai-context/failure.md + failures/<stamp>-<id>/metadata.json
7. On `f` (or `pux fix`): readLatestFailure() → detectAgents() → runFix()
   a. git worktree add -b pux/fix-<id> .ai-context/fix/… <commit>
   b. spawn the agent CLI in that worktree with buildFixPrompt()
   c. commit the agent's changes, remove the worktree, report branch + files + explanation
```

---

## File Layout

```
pux/
├── src/
│   ├── cli.tsx                  # CLI entry point (Commander)
│   ├── commands/doctor.ts       # Environment health checks
│   ├── commands/fix.ts          # `pux fix` output
│   ├── providers/               # GitHub Actions, Vercel, detection
│   ├── context/
│   │   ├── report.ts            # Pure log → report logic
│   │   ├── diff.ts              # Branch-base diff resolution
│   │   └── generate.ts          # Writes the failure bundle
│   ├── agents/instructions.ts   # Plan/apply agent instruction pointers
│   ├── agents/fix.ts            # Detect agents, run them on a fix branch
│   ├── config/store.ts          # ~/.config/pux/config.json
│   ├── utils/version-check.ts   # Daily version check + manual notice
│   ├── utils/auto-update.ts     # Background self-upgrade
│   ├── tui/                     # Ink UI, polling interval, cat
│   └── __tests__/               # Integration tests + helpers
├── dist/                        # Build output (ESM, Node 22)
├── Formula/pux.rb               # Homebrew formula, bumped by CI
└── scripts/release.mjs          # Interactive version bump + publish
```

---

## Build and Release

- **Bundler:** tsup (ESM output, Node 22 target)
- **Type checking:** TypeScript strict mode
- **Testing:** Vitest. Pure modules are unit-tested; anything that shells out runs against fake `gh`/`vercel` scripts in a temp git repo.
- **CI:** every push to `main` typechecks, tests, builds, and publishes to npm when the version changed. A follow-up workflow bumps the Homebrew formula.

---

## Future: Tauri Migration

The engine layer (`providers/`, `context/`, `agents/`, `config/`) is pure Node.js with no UI dependencies. When the Tauri menu bar app is built:

1. Engine runs as a Tauri sidecar or embedded Node process
2. Tauri frontend (React) subscribes to engine events
3. The same `Pipeline` type drives both TUI and native UI
4. CLI remains available as a lightweight alternative
