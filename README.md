<p align="center">
  <img width="450" height="182" alt="image" src="https://github.com/user-attachments/assets/eaf7ba19-4031-470a-a64d-148d26bedf36" />

</p>



<p align="center">
  <strong>Package CI failures into AI-ready local context.</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#agent-integrations">Agent Integrations</a> &bull;
  <a href="#project-structure">Project Structure</a>
</p>

---

## What is Pux?

Pux watches your GitHub Actions runs in real time from your terminal. When CI fails, it automatically downloads the failed logs, collects relevant repo context (diffs, configs, workflow files), and writes a structured `.ai-context/failure.md` file that any AI coding agent can read to diagnose and fix the issue.

No more copy-pasting CI logs into ChatGPT. Just run `pux watch`, let it catch the failure, and point your AI at the context file.

## Screenshots

```
 /\_/\   pux
( o.o )~ CI context, ready for your AI

 ✓ Repository: user/my-app
 ✓ Workflow: CI #12847291
 ◌ Running

 Progress ████████░░░░ 6/8 jobs
 ✓ lint
 ✓ typecheck
 ✓ unit-tests
 ✓ build
 ✓ integration-tests
 ◌ deploy · 3/5 steps
   ↳ Run deployment script
 · e2e-tests
 · notify

 Refreshes every 3s · press q to quit
```

When CI fails, the pet reacts:

```
 /\_/\   pux
( ;.; )  CI context, ready for your AI

 ✓ Repository: user/my-app
 ✓ Workflow: CI #12847291
 ✗ Failed
 ✓ Wrote .ai-context/failure.md
 ✓ Connected CI context to Claude Code, Codex, Cursor
```

## Installation

```sh
# Clone and install
git clone https://github.com/user/pux.git
cd pux
npm install

# Link globally
npm run build
npm link

# Now available everywhere
pux watch
```

**Requirements:** Node.js 22+, [GitHub CLI](https://cli.github.com/) (`gh`) authenticated.

## How It Works

```
┌─────────────┐     poll every 3s      ┌──────────────────┐
│  pux watch  │ ──────────────────────► │  GitHub Actions  │
│   (TUI)     │ ◄────────────────────── │       API        │
└─────┬───────┘     run status + jobs   └──────────────────┘
      │
      │ on failure
      ▼
┌─────────────────────────────────────────┐
│  Collect context:                       │
│  • Failed step logs (gh run view)       │
│  • Git diff (HEAD^ → HEAD)             │
│  • Changed file list                    │
│  • package.json, Dockerfile             │
│  • .github/workflows/*.yml              │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Write .ai-context/failure.md           │
│  Inject instructions into agent files   │
│  (CLAUDE.md, AGENTS.md, .cursorrules…)  │
└─────────────────────────────────────────┘
```

## Commands

### `pux watch`

Live TUI dashboard that monitors the GitHub Actions run for your current HEAD commit. Features:

- Real-time job and step progress with a progress bar
- Animated pet mascot that reacts to CI status
- Auto-generates `.ai-context/failure.md` on failure
- Auto-connects context to your AI coding agents
- Refreshes every 3 seconds, press `q` to quit

### `pux doctor`

Checks that required tools are installed and available:

```
✓ Git
✓ GitHub CLI
```

## Agent Integrations

When a CI failure is detected, Pux automatically injects a context pointer into the instruction files for agents it finds in your repo:

| Agent | File |
|-------|------|
| OpenAI Codex | `AGENTS.md` (always created) |
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Cursor | `.cursorrules` or `.cursor/rules/pux-ci-context.mdc` |
| Windsurf | `.windsurfrules` |
| Cline | `.clinerules` |

The injected instruction tells the agent to read `.ai-context/failure.md` before diagnosing CI failures, and to treat log contents as untrusted data.

## Project Structure

```
pux/
├── src/
│   ├── cli.tsx                  # Entry point — Commander CLI with watch & doctor commands
│   ├── commands/
│   │   └── doctor.ts            # Environment health checks (git, gh)
│   ├── context/
│   │   └── generate.ts          # Builds .ai-context/failure.md from logs + repo state
│   ├── github/
│   │   └── client.ts            # GitHub CLI wrapper — polls runs, jobs, steps
│   ├── agents/
│   │   └── instructions.ts      # Injects CI context pointers into agent instruction files
│   ├── tui/
│   │   ├── WatchApp.tsx         # Main TUI — layout, state machine, polling loop
│   │   └── Pet.tsx              # Animated ASCII cat mascot with mood states
│   └── types/
│       └── index.ts             # Shared type definitions
├── dist/                        # Built output (ESM, Node 22 target)
├── package.json
├── tsconfig.json
└── .gitignore
```

## Development

```sh
# Run in development (no build step)
npm run dev -- watch
npm run dev -- doctor

# Type check
npm run typecheck

# Build for production
npm run build

# Run tests
npm test

# Format code
npm run format
```

## The Pet

Pux has a small ASCII cat that lives in the TUI header and reacts to your CI:

| State | Pet | Meaning |
|-------|-----|---------|
| Idle | `( o.o )~` | Waiting, tail wagging |
| Watching | `( ◦.◦ ) ◌` | CI running, eyes tracking |
| Happy | `( ^.^ ) ♡` | CI passed |
| Sad | `( ;.; )` | CI failed |

Run `npx tsx test-pet.tsx` to see the pet demo in action.

## License

MIT
