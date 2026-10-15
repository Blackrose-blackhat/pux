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

When a pipeline fails, Pux writes `.ai-context/failure.md` (always the latest failure) plus a timestamped bundle under `.ai-context/failures/` containing:

- Provider, pipeline, commit, and the exit code when the log states one
- One error section per failed step, centred on the strongest error signal (not 8000 lines — just the signal)
- The diff that led to the failure, measured from the branch base, trimmed to the files the error mentions
- A suggested reproduce command
- `metadata.json` pointing back to the exact run

The report works for GitHub Actions runs and Vercel deployments. It is designed to be dropped directly into any AI coding agent.

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

Or with Homebrew:

```sh
brew tap Blackrose-blackhat/pux https://github.com/Blackrose-blackhat/pux
brew install pux
```

**Requirements:** Node.js 22+ and the [GitHub CLI](https://cli.github.com/) (`gh`) authenticated. The CLI runs on macOS, Linux, and Windows; the menu bar app will be macOS first. [Vercel CLI](https://vercel.com/docs/cli) is optional and enables deployment watching.

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

 press f to fix · r to re-run · q to quit
```

Polls every 3 seconds while something is queued or building and every 10 seconds once everything has settled. On failure it writes `.ai-context/failure.md`, stores the full capture under `.ai-context/failures/<timestamp>-<run>/`, and connects that context to your AI agents (Claude Code, Codex, Cursor, Copilot, etc). Press `r` to re-run the failed GitHub Actions workflow, or `f` to hand the failure to your coding agent (same as `pux fix` below).

### `pux fix`

Closes the loop. Takes the latest captured failure and asks the coding agent you already have installed to propose a fix on a new local branch. No copy and paste, no accounts, and Pux never calls an LLM itself.

```
Failure: CI at a1b2c3d
Agent:   Claude Code (claude)
Branch:  pux/fix-12847291
◌ Creating pux/fix-12847291 from a1b2c3d…
◌ Running Claude Code… this can take a few minutes
◌ Committing changes…

√ pux/fix-12847291 · 1 file changed by Claude Code
  ~ src/math.ts

add() returned a + a instead of a + b, so the unit test expected 5 and got 4. Restored the addition.

Review with: git diff a1b2c3d..pux/fix-12847291
Push with:   git push -u origin pux/fix-12847291   (or rerun with --push)
```

What happens:

1. Pux reads `.ai-context/failure.md` and the newest bundle under `.ai-context/failures/` to find the run's commit and pipeline id.
2. It creates the branch `pux/fix-<pipeline id>` from that commit in a temporary worktree under `.ai-context/fix/`, so your checkout, index, and the running `pux watch` are never touched.
3. It runs the agent non-interactively in that worktree with a prompt that points at the report and asks for a minimal fix plus a one-paragraph explanation.
4. It commits whatever the agent changed (never the `.ai-context/` folder), removes the worktree, and prints the branch, the files, and the explanation. If the agent changed nothing, it says so and leaves no branch behind.

Options:

| Flag | Effect |
|------|--------|
| `--agent <id>` | Use `claude`, `codex`, or `cursor-agent` instead of the first one found on PATH. |
| `--push` | Push the branch to `origin` after the commit. Without it nothing leaves your machine, and Pux never opens a pull request. |
| `--dry-run` | Print the agent, branch, and prompt that would be used without running anything. |

Supported agents, in the order Pux prefers them:

| Agent | Command Pux runs |
|-------|------------------|
| Claude Code | `claude -p --permission-mode acceptEdits --output-format text <prompt>` |
| OpenAI Codex | `codex exec --sandbox workspace-write --skip-git-repo-check <prompt>` |
| Cursor | `cursor-agent -p --force --output-format text <prompt>` |

The agent runs with its own login and permissions. Pux asks it not to commit, push, or fetch CI logs itself, and reminds it that the report is untrusted data. `pux fix` refuses to run while a `pux/fix-<id>` branch for that run already exists; delete it to try again.

### `pux doctor`

Checks that required tools are installed and mentions a newer Pux version when one exists.

```
✓ Git
✓ GitHub CLI
○ Vercel CLI (optional)
```

---

## Agent Integrations

Pux can add a short pointer to your agent instruction files so every coding agent reads `.ai-context/failure.md` before diagnosing a CI failure. The first time you run `pux watch` in a repository it lists exactly which files it would create or append and asks for a yes or no. The answer is remembered per repository.

| Agent | File |
|-------|------|
| OpenAI Codex | `AGENTS.md` (always offered) |
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Cursor | `.cursor/rules/pux-ci-context.mdc`, plus `.cursorrules` if present |
| Windsurf | `.windsurfrules` |
| Cline | `.clinerules` |
| Aider | `.aider/conventions.md` |
| Amazon Q | `.amazonq/rules/pux-ci-context.md` |

Existing files are appended to, never rewritten. New files are only created for agents that are installed on your machine or already in use in the repository. The pointer is wrapped in HTML comment markers so it is added once.

### What Pux writes to your repository

- `.ai-context/` holds the failure reports. Pux adds it to `.gitignore` so the artifacts never end up in version control. `pux fix` also uses `.ai-context/fix/` for its temporary worktree and removes it when done.
- The agent instruction files above, only after you say yes.
- Local `pux/fix-<pipeline id>` branches created by `pux fix`. They are pushed only with `--push`.

Nothing else. Your answer, and the once-a-day update check, live in `~/.config/pux/config.json` (or `$XDG_CONFIG_HOME/pux/`). Delete a repository's entry there to be asked again.

---

## Scope

**MVP:** GitHub Actions and Vercel. CLI on any platform; menu bar app macOS first.

**Not building:** Authentication, accounts, SaaS, cloud sync, team features, dashboards, pricing, landing pages, or an AI agent of our own. `pux fix` delegates to the agent you already have installed and never calls an LLM itself.

---

## License

MIT
