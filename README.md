<p align="center">
  <img width="450" height="182" alt="image" src="https://github.com/user-attachments/assets/eaf7ba19-4031-470a-a64d-148d26bedf36" />

</p>



<p align="center">
  <strong>Pux tells you why your build failed before you open GitHub.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pux.sh"><img src="https://img.shields.io/npm/v/pux.sh?color=cyan&label=npm" alt="npm version"></a>
  <a href="https://github.com/Blackrose-blackhat/pux/actions"><img src="https://img.shields.io/github/actions/workflow/status/Blackrose-blackhat/pux/publish.yml?label=CI" alt="CI"></a>
  <a href="https://github.com/Blackrose-blackhat/pux/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#what-is-pux">What</a> &bull;
  <a href="#how-it-works">How</a> &bull;
  <a href="#installation">Install</a> &bull;
  <a href="#usage">Usage</a> &bull;
  <a href="ROADMAP.md">Roadmap</a> &bull;
  <a href="ARCHITECTURE.md">Architecture</a> &bull;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## What is Pux?

Pux is an ambient developer companion that lives in your macOS menu bar.

It watches your CI pipeline. When your build fails, it collects the logs, extracts the relevant error, assembles context from your repo, and hands you everything you need to fix it — without ever opening GitHub.

```
git push → 🐱 wakes up → build fails → click → understand → fix
```

No dashboards. No accounts. No SaaS. Just a cat that watches your builds.

---

## The Problem

Every CI failure today looks like this:

```
Open GitHub → Open Actions → Find Workflow → Scroll 8000 Lines →
Copy Error → Paste into AI → "Need more context" → Copy Diff →
Paste Again → Repeat
```

Pux removes this entire workflow.

---

## How It Works

```
Git Push
  ↓
Git Monitor (detects push)
  ↓
GitHub Watcher (polls Actions API)
  ↓
Log Collector (downloads failed step logs)
  ↓
Error Parser (extracts relevant stacktrace)
  ↓
Context Generator (assembles AI-ready failure report)
  ↓
UI (menu bar notification + popover)
```

When a workflow fails, Pux writes a structured context file containing:

- Failed job, step, and exit code
- Relevant stacktrace (not 8000 lines — just the signal)
- Git diff of the commit that triggered the failure
- Changed file list
- Workflow YAML
- Package manifest and config files (only if relevant)

This context is designed to be dropped directly into any AI coding agent.

---

## Menu Bar States

| State | Icon | Meaning |
|-------|------|---------|
| Idle | `🐱` | No active runs |
| Watching | `🐱⟳` | Workflow running |
| Success | `🐱✓` | Build passed |
| Failure | `🐱✕` | Build failed — click to investigate |

---

## Installation

```sh
npm install -g pux.sh
```

Or use it directly without installing:

```sh
npx pux.sh watch
```

Or build from source:

```sh
git clone https://github.com/Blackrose-blackhat/pux.git
cd pux
npm install
npm run build
npm link
```

**Requirements:** Node.js 22+, [GitHub CLI](https://cli.github.com/) (`gh`) authenticated, macOS.

> The menu bar app is coming. For now, the engine runs as a CLI.

---

## Usage

### `pux watch`

Live terminal dashboard. Watches the GitHub Actions run for your current commit.

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
 ◌ deploy · 3/5 steps
   ↳ Run deployment script

 Refreshes every 3s · press q to quit
```

On failure, automatically generates `.ai-context/failure.md` and connects it to your AI agents (Claude Code, Codex, Cursor, Copilot, etc).

### `pux doctor`

Checks that required tools are installed.

```
✓ Git
✓ GitHub CLI
```

---

## Agent Integrations

When a failure is detected, Pux injects a context pointer into whichever agent instruction files exist in your repo:

| Agent | File |
|-------|------|
| OpenAI Codex | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Cursor | `.cursorrules` / `.cursor/rules/` |
| Windsurf | `.windsurfrules` |
| Cline | `.clinerules` |

The instruction tells the agent to read `.ai-context/failure.md` before diagnosing CI failures.

---

## Scope

**MVP:** GitHub Actions only. macOS only. Menu bar only.

**Not building:** Authentication, accounts, SaaS, cloud sync, team features, dashboards, pricing, landing pages, AI agents.

---

## License

MIT
