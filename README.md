# PROZESSOR

PROZESSOR is a terminal-first process manager for running and maintaining multiple Node services from one place.

It handles:
- cloning and preparing project repos,
- starting and monitoring processes,
- log streaming in a live dashboard,
- periodic git update checks with automatic restart,
- crash retry and cooldown behavior.

The project is intentionally lightweight: plain Node.js, no build step, and a focused codebase.

## Requirements

- Node.js 18+
- `git`
- `npm`

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create your local runtime config from the example:

```bash
cp projects.example.json projects.json
```

3. Update `projects.json` with your project details.

4. (Optional) Add project-specific env files under `envs/`.

5. Start PROZESSOR:

```bash
npm start
```

## How configuration works

### `projects.json` (local, ignored)

`projects.json` is your machine-local runtime file. It is intentionally ignored in git.

Each project entry supports:

- `name`: display key and local folder name
- `repoUrl`: git remote URL
- `branch`: branch to track
- `envSrc`: env filename inside `envs/` (optional)
- `subdir`: project subdirectory where the service lives (default: `backend`)
- `entrypoint`: Node entry file (default: `server.js`)
- `enabled`: whether PROZESSOR should initialize and manage it

Settings include:

- `pollInterval`
- `logBufferSize`
- `maxCrashRetries`
- `crashCooldownMins`

### `projects.example.json` (tracked)

This is the safe template committed to git. Keep it generic and non-sensitive.

### `envs/.env.example` (tracked)

Reference template for env values. Real env files should stay local.

## Dashboard controls

- `m`: open menu
- `f`: cycle project log filter
- `0`: clear filter
- `1-9`: quick-filter by indexed project
- `↑/↓`, `PageUp/PageDown`: scroll logs
- `q` or `Ctrl+C`: quit

## Menu behavior

- `Esc`: return to dashboard
- `Ctrl+C`: stop PROZESSOR and shut down managed processes

## Project structure

```text
prozessor/
  lib/
    config.js
    git-ops.js
    process-manager.js
    log-store.js
    theme.js
    ui.js
    flair.js
  envs/
    .env.example
  projects/                 # runtime clones (ignored)
  projects.example.json
  projects.json             # local runtime config (ignored)
  main.js
  package.json
  .gitignore
```

## Security and release notes

For a clean public release:

- Never commit real `.env` files.
- Never commit populated `projects.json`.
- Never commit local clone data under `projects/`.
- Keep `projects.example.json` and `envs/.env.example` free of real credentials.

This repository is set up to enforce those defaults through `.gitignore`.

## Development notes

- The app is ESM (`"type": "module"`).
- There is no transpilation step.
- Use `node --check main.js` for quick syntax validation.

## License

Add your preferred license before publishing.
