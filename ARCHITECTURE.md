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
│   ┌───────────┐  ┌──────────────┐  ┌────────────────┐  │
│   │    Git    │  │    GitHub    │  │     Parser     │  │
│   │  Monitor  │  │   Watcher    │  │                │  │
│   └─────┬─────┘  └──────┬───────┘  └───────┬────────┘  │
│         │               │                   │           │
│         ▼               ▼                   ▼           │
│   ┌─────────────────────────────────────────────────┐   │
│   │              Context Generator                   │   │
│   └──────────────────────┬──────────────────────────┘   │
│                          │                              │
│                          ▼                              │
│   ┌─────────────────────────────────────────────────┐   │
│   │            Agent Instruction Injector            │   │
│   └─────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Modules

### `src/github/client.ts`

Wraps GitHub CLI (`gh`) calls. Responsible for:

- Polling run status for a given commit
- Fetching job/step details
- Downloading failed step logs

Returns typed snapshots (`WatchSnapshot`) that describe the current state of the pipeline. The rest of the system reacts to these snapshots.

**Why `gh` CLI and not the REST API?** Zero auth setup. The user already has `gh auth login` configured. We inherit their token, rate limits, and enterprise config for free. REST API is a future optimization.

### `src/context/generate.ts`

The core product logic. Takes a failed run snapshot and produces `.ai-context/failure.md`.

Steps:
1. Download failed step logs
2. Extract the relevant signal (regex window around first error)
3. Collect git diff and changed file list
4. Read relevant config files (package.json, Dockerfile, workflow YAMLs)
5. Assemble into structured markdown

**Design decisions:**
- Log extraction uses a signal window (12 lines before first error match, 120 lines max) rather than dumping everything
- Config files are capped at 20KB to prevent blowup
- Fenced code blocks are escaped to prevent markdown injection

### `src/agents/instructions.ts`

Injects a context pointer into AI agent instruction files. Supports 7 agents.

**Design decisions:**
- AGENTS.md is always created (Codex default)
- All other files are only modified if they already exist (opt-in by convention)
- Uses HTML comment markers for idempotent injection
- Gracefully skips read-only files
- Never overwrites existing content — always appends

### `src/tui/WatchApp.tsx`

Ink-based terminal UI. Polls `getWatchSnapshot()` every 3 seconds and renders the current state. Triggers context generation on failure detection.

### `src/tui/Pet.tsx`

Animated ASCII cat. Mood driven by CI state. Pure cosmetic — no logic dependency.

### `src/commands/doctor.ts`

Checks for `git` and `gh` in PATH. Reports availability. Used for onboarding troubleshooting.

---

## Data Flow

```
1. User runs `pux watch` (or menu bar activates)
2. getWatchSnapshot() polls GitHub via `gh` CLI
3. Returns WatchSnapshot discriminated union:
   - checking | no-repository | gh-unavailable | not-authenticated
   - no-workflows | waiting | run
4. UI renders based on snapshot.kind
5. On snapshot.kind === "run" && conclusion === "failure":
   a. generateFailureContext(snapshot) is called once per run
   b. Writes .ai-context/failure.md
   c. ensureAgentInstructions() connects context to agents
```

---

## File Layout

```
pux/
├── src/
│   ├── cli.tsx                  # CLI entry point (Commander)
│   ├── commands/
│   │   └── doctor.ts            # Environment health checks
│   ├── context/
│   │   └── generate.ts          # Failure context file generator
│   ├── github/
│   │   └── client.ts            # GitHub CLI wrapper + snapshot polling
│   ├── agents/
│   │   └── instructions.ts      # Agent instruction file injector
│   ├── tui/
│   │   ├── WatchApp.tsx         # Terminal UI (Ink)
│   │   └── Pet.tsx              # Animated ASCII cat
│   └── types/
│       └── index.ts             # Shared types
├── dist/                        # Build output (ESM, Node 22)
├── package.json
├── tsconfig.json
├── ROADMAP.md
├── ARCHITECTURE.md
└── CONTRIBUTING.md
```

---

## Build

- **Bundler:** tsup (ESM output, Node 22 target)
- **Type checking:** TypeScript 7 with strict mode
- **Runtime:** Node.js 22+ (required for stable ESM + native fetch)
- **Testing:** Vitest with fake `gh` CLI scripts for integration tests

---

## Future: Tauri Migration

The engine layer (`github/`, `context/`, `agents/`) is pure Node.js with no UI dependencies. When the Tauri menu bar app is built:

1. Engine runs as a Tauri sidecar or embedded Node process
2. Tauri frontend (React) subscribes to engine events
3. Same `WatchSnapshot` type drives both TUI and native UI
4. CLI remains available as a lightweight alternative
