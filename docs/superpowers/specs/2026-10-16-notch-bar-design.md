# Pux notch bar — design

Date: 2026-10-16
Status: approved in brainstorm, pending implementation plan

## Goal

A native macOS overlay that lives in the notch, shows the Pux cat and the state of
the user's CI, and drops a liquid-looking panel with the failure summary and
actions. It replaces the roadmap's "Tauri + React menu bar app" (Phase 8). The
existing Node engine stays the only place that knows about CI providers, failure
context and coding agents; the app is a view on top of it.

Success for version one: the author runs `pux watch` once in each repo they care
about, closes the terminal, and from then on sees failures arrive in the notch,
reads the error there, and triggers `pux fix` or a re-run without opening GitHub.

## Decisions made in the brainstorm

| Question | Decision |
| --- | --- |
| Shell | Native Swift + SwiftUI, macOS 14+ |
| Which repos | Auto-registered by `pux watch`; removable from the panel |
| Open / close | Hover to peek, click to pin, Esc or outside click to unpin; auto-drop on failure |
| Visual direction | "Liquid blob": the panel drips out of the notch, metaball merge, soft rounded bottom |
| Several repos | Tab strip, one repo at a time, constant panel height |
| Actions | Fix with agent, Re-run, Copy context, Open in GitHub, Open in editor |
| Engine runtime | The app requires the installed `pux` CLI and spawns it; nothing bundled |
| Signing | Ad-hoc for now; no Developer ID yet |
| Alerts | Notch auto-drop and red glow, plus a Notification Center banner on failure |

## Architecture

```
┌──────────────────────────────┐        JSON lines over stdio        ┌──────────────────────────┐
│  Pux.app (Swift)             │ ◄──────────── stdout ──────────────  │  pux serve (Node)        │
│  notch window, panel, tabs,  │ ─────────────  stdin ──────────────► │  registry, poll loop,    │
│  notifications, settings     │                                      │  providers, context,     │
└──────────────────────────────┘                                      │  agents (all existing)   │
                                                                      └──────────────────────────┘
```

Two processes, one owner. The app launches `pux serve`, keeps it alive, and
renders what it says. The engine never knows about windows; the app never polls
CI.

### `pux serve` (new command, this repo)

- Reads the watched-repo registry (below), and for each repo:
  - resolves the current HEAD commit and the `owner/repo` slug with the existing
    `detectProviders` logic,
  - polls the detected providers with the existing adaptive interval
    (`pollIntervalFor`),
  - on a newly failed pipeline, calls the existing `generateFailureContext` once
    per pipeline id and runs the agent-instruction plan/apply flow, asking for
    consent through an event instead of a TUI prompt.
- Re-reads the registry when it changes (file watch with a 1s debounce), so
  `pux watch` in a new repo is picked up without a restart.
- Emits one JSON object per line on stdout. Every event carries `type` and
  `repo` (the registry path) where relevant. Event types:
  - `hello { version }` once at start.
  - `repos { repos: RepoSummary[] }` whenever the registry changes.
  - `state { repo, repository, branch, commit, providers: ProviderSnapshotSummary[] }`
    after every poll that changed anything. Pipelines are the existing
    `Pipeline` type with `steps` included.
  - `failure { repo, pipeline, contextPath, errorWindow, failedStep, exitCode }`
    once per newly failed pipeline, after `failure.md` is written.
  - `consent-needed { repo, repository, plan }` with the same `AgentPlan` the TUI
    shows.
  - `fix-progress { repo, stage, agent }` and `fix-done { repo, result }` using
    the existing `FixProgress` / `FixResult` shapes.
  - `rerun-done { repo, pipelineId, ok }`.
  - `error { repo?, message }` for anything the app should show but not crash on.
- Reads one JSON object per line on stdin. Commands:
  - `rerun { repo, pipelineId }`
  - `fix { repo, agent? , push? }`
  - `consent { repo, repository, allow }`
  - `remove-repo { repo }`
  - `shutdown {}`
- Exits with a non-zero code only on unrecoverable startup errors (no config dir
  writable). Provider errors are events, not exits.

### Watched-repo registry

Stored in the existing `~/.config/pux/config.json` under a new `watched` key,
keyed by absolute repo path:

```json
"watched": {
  "/Users/me/code/pux": { "repository": "Blackrose-blackhat/pux", "addedAt": "2026-10-16T10:00:00Z" }
}
```

- `pux watch` adds the current repo on start (idempotent) and, if `Pux.app` is
  installed (`open -b sh.pux.bar` succeeds), launches it. It then continues as
  today, polling on its own. When both the TUI and the app run, they poll twice;
  acceptable for version one and noted in the README.
- `remove-repo` deletes the key. A path that no longer exists on disk is removed
  on the next registry load and reported with an `error` event.

### Pux.app

Swift Package under `macos/`, macOS 14 or newer, no Xcode project. Targets:

- `PuxCore` (library, tested): the event and command models, the JSON codec,
  the state reducer, notch geometry.
- `PuxBar` (executable): AppKit window plumbing, SwiftUI views, the engine
  process supervisor, notifications, settings.
- `PuxCoreTests` (XCTest).

#### Engine supervisor

- Finds `pux` on PATH, then in the Homebrew prefixes (`/opt/homebrew/bin`,
  `/usr/local/bin`), then in the npm global bin. Spawns `pux serve` with stdout
  and stdin pipes.
- Decodes lines into events and forwards them to the reducer on the main actor.
- Restarts on exit with backoff 1s, 2s, 4s; after three consecutive exits within
  a minute it stops and the state becomes `engineOffline(reason)`.
- `pux` not found at all: state `engineMissing`, panel shows the Homebrew install
  command with a Copy button.

#### State reducer (`PuxCore`)

Pure function `reduce(state, event) -> state`. Holds:

- `repos: [RepoState]` ordered: failed first, then building, then passed/idle,
  then by name. `selectedRepo` follows a new failure automatically unless the
  panel is pinned.
- `mood: idle | watching | passed | failed` for the collapsed notch, derived from
  the worst repo state. `passed` lasts five seconds, then becomes `idle`.
- `panel: collapsed | peeking | pinned | autoDropped(until)`.
- Per repo: last `state`, last `failure`, pending consent, fix progress, rerun
  status.

The reducer is where hover/pin/Esc rules, glow timing and tab selection live, so
they are unit-tested without a window.

#### Notch window

- `NSPanel`, borderless, `.nonactivatingPanel`, `hidesOnDeactivate = false`,
  level `.statusBar + 1`, collection behaviour `canJoinAllSpaces`,
  `fullScreenAuxiliary`, `stationary`, `ignoresCycle`. Not shown in the Dock or
  the app switcher (`LSUIElement`).
- Frame: on a notched display, computed from `NSScreen.safeAreaInsets.top` and
  the gap between `auxiliaryTopLeftArea` and `auxiliaryTopRightArea`, so the
  black shape is flush with the hardware notch and extends 10pt wider on each
  side for the hover target. On a display without a notch, a 160×30pt pill at
  top center of the menu bar on the main screen. Only the main screen hosts the
  window in version one.
- The window is always `panel height` tall; the collapsed state is simply the
  liquid shape drawn at height 0 with the cat and dot inside the notch region.
  Mouse tracking uses the visible shape, not the whole window, so clicks on the
  wallpaper beside a collapsed notch pass through (`ignoresMouseEvents` toggled
  by hit-test on the shape).
- Interaction: hover anywhere on the shape → `peeking`, pointer leaves the shape
  for 300ms → `collapsed`. Click on the notch → `pinned`. Esc, click outside, or
  clicking the notch again → `collapsed`. A `failure` event → `autoDropped`
  for five seconds unless already `pinned`.

#### Liquid rendering

One SwiftUI `Canvas`. Inside `drawLayer`, it fills: the notch rectangle, the
panel rounded rectangle at the animated height, a wide shallow ellipse where the
two meet, and two or three droplet circles that trail the bottom edge during
the drop. The layer gets `.blur(radius: 8)` and then `.alphaThreshold(min: 0.5)`
so the fills fuse into one silhouette. The animated parameters (panel height
0…1, droplet lag, bottom sag) are driven by `withAnimation(.spring(response:
0.45, dampingFraction: 0.68))`. The content view (tabs, text, actions) is
overlaid with opacity tied to height progress, becoming interactive above 0.9.
Reduce Motion replaces the spring with a 0.2s ease and no droplets.

#### Panel content (SwiftUI)

Fixed width 360pt, height 240pt (settings view reuses the same frame).

- Header: tab strip of repos as pills with a status dot; selected pill is
  brighter. Over six repos the strip scrolls horizontally.
- Body for the selected repo:
  - line 1: repository slug, branch, short commit, relative time;
  - line 2: pipeline name › failed job › failed step, exit code;
  - error window from `failure.errorWindow` in a monospaced box, up to six
    lines, scrollable;
  - when building: step list with the active step highlighted, same data as
    the TUI;
  - when there is a pending consent: the file list and Allow / Not now
    buttons, replacing the error box.
- Action row (only enabled when it applies): **Fix** (primary), Re-run, Copy
  context, GitHub, Editor. Fix shows the agent name and stage inline, then the
  result message from `describeFixResult`. Copy reads `contextPath` and puts
  the file on the pasteboard. Editor runs `open -b <bundle id>` for the chosen
  editor with the repo path.
- Footer: "N repos watched" and a gear. The gear swaps the body for settings:
  editor (Cursor, VS Code, Zed, detected by bundle id), system notifications
  on/off, remove selected repo, quit Pux.

#### Notifications

`UNUserNotificationCenter`, requested on first failure. Banner title is the
repository slug, body is "failed job › step". Clicking it pins the panel on that
repo. Never on success. Toggle in settings, default on.

## Error handling

| Condition | Behaviour |
| --- | --- |
| `pux` not installed | `engineMissing`: panel shows `brew install Blackrose-blackhat/pux/pux` with Copy |
| Engine exits | restart with backoff; after three fast exits, `engineOffline` with the last stderr line |
| Provider unavailable (gh not logged in, no remote) | engine sends `state` with the existing `unavailable` snapshot; tab shows "GitHub CLI not authenticated" style text |
| Registry path missing | removed on load, `error` event, tab disappears |
| Fix fails or agent missing | `fix-done` with the existing failure result, shown inline in the CLI's wording |
| Display has no notch | pill at top center of the menu bar, everything else identical |
| Reduce Motion on | eased transition, no droplets |

## Build and distribution

- `macos/Package.swift` with the three targets above.
- `macos/scripts/build-app.sh`: `swift build -c release`, assembles
  `Pux.app` (binary, `Info.plist` with `LSUIElement`, bundle id `sh.pux.bar`,
  icon), signs ad-hoc with `codesign -s -`, zips to `Pux-<version>.zip`.
- The existing release script gains a step that builds and uploads the zip to
  the GitHub release for the same version tag; app version equals the npm
  version.
- A `pux` cask in the Homebrew tap installs `Pux.app` and depends on the `pux`
  formula. Until a Developer ID exists, README documents right-click → Open or
  `xattr -d com.apple.quarantine` on first launch.

## Testing

Node, with vitest, following the existing test layout:

- registry: add is idempotent, remove deletes, missing paths are dropped.
- serve stream: with fake providers, a building → failed transition emits one
  `state`, one `failure`, and writes `failure.md` exactly once; a second poll
  with the same failed pipeline emits nothing new.
- stdin commands: malformed lines produce an `error` event, not a crash; `rerun`
  and `fix` call the existing functions with the right pipeline.

Swift, with XCTest in `PuxCoreTests`:

- every event type round-trips through the codec from fixture JSON copied from
  the Node tests;
- reducer: failed repo sorts first and is auto-selected; a failure while pinned
  does not change the selection; `passed` returns to `idle` after five seconds;
  hover → peek → leave collapses; Esc unpins;
- notch geometry: given safe-area insets and auxiliary areas returns a frame
  flush with the notch; without a notch returns the centered pill.

By hand on the author's Mac: the drop animation, hover hit-testing, placement on
the built-in notched display and on an external display, fullscreen apps, and a
real failure end to end.

## Out of scope for version one

- Multiple displays showing the notch at once.
- Watching repos the TUI has not registered (no folder picker).
- Sharing one poll loop between the TUI and the app.
- Notarization and Developer ID signing.
- Linux or Windows tray equivalents.
