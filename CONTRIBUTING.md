# Contributing

## Setup

```sh
git clone https://github.com/Blackrose-blackhat/pux.git
cd pux
npm install
```

## Development

```sh
# Run in development (no build needed)
npm run dev -- watch
npm run dev -- doctor

# Type check
npm run typecheck

# Run tests
npm test

# Build for production
npm run build

# Format code
npm run format
```

## Project Conventions

### Code Style

- TypeScript strict mode, no `any`
- ESM only (`"type": "module"`)
- Prefer small functions over classes
- No comments unless the "why" is non-obvious
- No abstractions until the third instance

### File Organization

- One module per concern (`github/`, `context/`, `agents/`)
- UI code lives in `tui/` (and later `ui/menubar/`)
- Shared types go in `types/index.ts`
- Tests go in `src/__tests__/`

### Git

- Commits should be atomic and describe intent
- Branch from `main`, PR back to `main`
- No force pushes to `main`

### Testing

- Integration tests use a fake `gh` CLI script in a temp git repo
- No mocking internal modules — test through the public API
- Tests must clean up temp directories

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design.

## What to Work On

See [ROADMAP.md](ROADMAP.md) for the current phase and unchecked items.

Priority order:
1. Engine reliability (context generation, log parsing)
2. Smarter context (parse errors for file references)
3. Push detection (file watcher on `.git/refs`)
4. Menu bar app (Tauri shell)

## What NOT to Build

- Authentication / accounts
- SaaS / cloud sync
- Team features / dashboards
- AI agents (we generate context, not run agents)
- Support for non-macOS (yet)
- Support for non-GitHub CI (yet)

## Questions?

Open an issue.
