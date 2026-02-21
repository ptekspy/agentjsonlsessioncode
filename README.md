# Session Recorder Extension

VS Code extension for recording clean coding sessions into tool-trace training records and uploading them to a cloud API backed by Postgres.

## What it does

- Enforces clean git start (`git status --porcelain` must be empty)
- Captures baseline commit/branch/remote
- Builds records from git diff at stop time (`repo.readFile`, `apply_patch`)
- Records strict allowlisted `run_cmd` traces for pnpm actions from sidebar controls
- Uploads sessions to cloud API and supports task JSONL export (with filters)
- Shows sidebar cloud status (connected / missing config / unreachable)
- Tracks recent local artifacts (sessions + exports) for one-click reopen

## Quick start

1. Start backend in server/README.md
2. In VS Code settings, set `dataset.apiBaseUrl`
3. Run command: `Dataset: Set API Token`
4. Open Dataset activity bar view and run:
	- Select/Create Task
	- (Optional) Check Cloud Connection
	- Start Session
	- Optionally run pnpm commands via `run_cmd` controls
	- Stop Session (saves local artifact and uploads)
	- Export task JSONL (optional `since` and `limit`)

Local session artifacts are written to `.agent-dataset/sessions`.
Local export artifacts are written to `.agent-dataset/exports`.

## Sidebar features

- **Cloud health** badge with last check timestamp and manual check button
- **Task controls** for select/create/token setup
- **run_cmd controls** for `pnpm i`, `add`, `add -D`, `remove`, `lint`, `test`, `build`
- **Export controls** with optional `since` (ISO datetime) and `limit`
- **Session quality** summary (`draft|ready`), changed files, recorded commands
- **Recent history** list for the latest local session/export files

## Key settings

- `dataset.apiBaseUrl`
- `dataset.ignoreGlobs`
- `dataset.redactionPatterns`
- `dataset.maxCommandOutputChars`
- `dataset.maxChangedFilesWarning`
- `dataset.uploadMode` (`full` or `metadataOnly`)

`metadataOnly` keeps full local records but uploads redacted metadata without tool/file contents.

## Quality and safety notes

- `run_cmd` outputs are redacted and truncated before record persistence/upload.
- Server validates tool-call/result linkage and strict `run_cmd` allowlist.
- Server derives session status from record content and rejects mismatched client status.

## Dataset backend

This repo now includes a backend service in [server/README.md](server/README.md) for cloud session storage:

- Prisma + Postgres
- Bearer-token auth via `.env`
- Endpoints: `/health`, `/tasks`, `/sessions`, `/export.jsonl`
