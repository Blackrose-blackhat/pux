# Roadmap

## Phase 1 — Detect Push

Pux knows when you push.

- [ ] Watch `.git/refs` for changes (chokidar)
- [ ] Detect current branch and remote
- [ ] Extract commit SHA for polling

---

## Phase 2 — Watch GitHub Actions

Pux follows the run.

- [x] Poll `gh run list` for current commit
- [x] Track workflow status (queued → running → completed)
- [x] Track individual job status
- [x] Live TUI with progress bar

---

## Phase 3 — Stream Workflow Progress

Pux shows what's happening right now.

- [x] Per-job status (queued, running, completed, failed)
- [x] Per-step progress within jobs
- [x] Active step indicator

---

## Phase 4 — Download Logs

Only on failure. Only what matters.

- [x] Download failed step logs via `gh run view --log-failed`
- [ ] Fallback to full log download if `--log-failed` is empty
- [ ] Cache logs locally to avoid re-downloading

---

## Phase 5 — Extract Failure

Turn 8000 log lines into 20.

- [x] Regex-based signal detection (error, exception, fatal, exit code)
- [x] Extract relevant window around first error
- [ ] Multi-error extraction (when multiple steps fail)
- [ ] Parse structured test output (JUnit XML, TAP)

---

## Phase 6 — Generate Context

The core product.

- [x] Write `.ai-context/failure.md` with structured sections
- [x] Include: workflow name, job, step, logs, diff, changed files
- [x] Include: package.json, Dockerfile, workflow YAML
- [ ] Only include config files if they changed or are relevant to the error
- [ ] Parse error log for file paths → include referenced source files
- [ ] Respect token budget (truncate intelligently for LLM context windows)

---

## Phase 7 — Agent Integration

Make every AI tool aware of the failure.

- [x] Auto-inject instruction pointer into agent files
- [x] Support: Codex, Claude Code, Gemini, Cursor, Windsurf, Cline, Copilot
- [x] Idempotent injection (no duplicates)
- [x] Graceful handling of read-only files
- [ ] Remove stale context when the failure is resolved (next successful run)

---

## Phase 8 — Menu Bar App

The real UI. The CLI was just the engine prototype.

- [ ] Tauri + React shell
- [ ] macOS menu bar tray icon
- [ ] State icons: idle, watching, success, failure
- [ ] Click → popover with failure summary
- [ ] Actions: Open GitHub, Copy Context, Explain, Open Cursor
- [ ] Notifications on failure (never on success by default)

---

## Phase 9 — Git Push Detection (Native)

Replace polling with real-time awareness.

- [ ] File watcher on `.git/refs/remotes/`
- [ ] Detect push without git hooks (zero config)
- [ ] Support multiple remotes

---

## Phase 10 — Smarter Context

Context that understands the failure.

- [ ] Parse error stacktraces → include referenced source files in full
- [ ] Detect test framework → include relevant test file
- [ ] Detect package manager lockfile conflicts
- [ ] Branch/PR metadata (base branch, PR title, linked issues)
- [ ] Runtime version from CI environment

---

## Future

Not building yet. Sequenced by value.

- [ ] GitLab CI support
- [ ] CircleCI support
- [ ] Buildkite support
- [ ] Jenkins support
- [ ] Vercel / Railway / Render deploy failures
- [ ] "Explain" button → local LLM summarization
- [ ] "Fix" button → auto-apply suggested fix
- [ ] Multiple repo support
- [ ] Linux menu bar (system tray)
