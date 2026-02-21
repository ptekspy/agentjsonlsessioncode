## Development plan: VS Code “Session Recorder” for tool-trace JSONL (cloud-first)

### Goal

A VS Code extension that lets you:

* pick (or create) a **Task** (skill bucket)
* start a **clean-slate session** in any repo
* edit normally
* on stop, the extension derives changes from **git diff** and generates:

  * `repo.readFile` tool traces for touched *modified/deleted* files (using `git show baseRef:path`)
  * a single `apply_patch` call with operations derived from the diff / file contents
* optionally record `run_cmd` traces via extension buttons (`pnpm ...`)
* upload the final record to a **cloud API → Postgres**
* export JSONL by task (server-side)

---

## Phase 0 — Contracts and invariants (lock these first)

**Deliverables**

* Tool list and strict schemas (do not change after training begins).
* Message format: OpenAI-style `tool_calls` + `role:"tool"` results.
* `apply_patch` op semantics:

  * `create_file.diff` = full file contents (exact)
  * `update_file.diff` = unified diff hunk body only (exact; no trimming)
  * `delete_file` no diff
* `run_cmd` allowlist patterns (v3) including filtered add/remove/install.

**Invariants**

* **Repo must be clean to start**: `git status --porcelain` empty.
* **Baseline is HEAD SHA at start**.
* **Renames** become `delete + create`.
* **Create file does not require `repo.readFile` prior**.
* **No `.trim()` anywhere** for diffs/file contents.

---

## Phase 1 — Cloud backend (API + Postgres)

Cloud-first means the backend lands early.

### 1.1 Database schema (Postgres)

**Tables**

* `tasks`

  * `id` (text, pk) — slug (`rsc-convert`, `tailwind-setup`, etc.)
  * `name` (text)
  * `description` (text, nullable)
  * `created_at` (timestamptz default now())
* `sessions`

  * `id` (uuid pk)
  * `task_id` (text fk → tasks.id)
  * `repo_name` (text)
  * `repo_remote` (text nullable)
  * `branch` (text nullable)
  * `base_ref` (text) (the commit sha)
  * `created_at` (timestamptz default now())
  * `record` (jsonb) — the `{ messages: [...] , meta: ... }`
  * indexes:

    * `(task_id, created_at desc)`
    * `gin(record)` optional later

### 1.2 API service (small and boring)

Pick any Node stack you like (Next.js API routes, Hono, Fastify, Nest). Keep it minimal.

**Endpoints**

* `GET /tasks`
* `POST /tasks`
* `POST /sessions`
* `GET /export.jsonl?taskId=...` (optional, but very useful)
* `GET /health`

**Auth**

* single header: `Authorization: Bearer <token>`
* token stored server-side (env var allowlist) or in DB for multiple users later
* extension stores token in VS Code SecretStorage

**Validation**

* server validates `record` schema (Zod) so bad data never enters DB
* size limits (avoid uploading 50MB logs)
* basic secret redaction (server-side second line of defense)

**Deliverable**

* Deployable service + working Postgres + cURL-able endpoints.

---

## Phase 2 — VS Code extension skeleton + auth

### 2.1 Extension scaffolding

* Use the standard VS Code extension generator
* Add a Sidebar view with a Webview UI (React optional; plain TS/HTML fine)
* Add commands:

  * `Dataset: Select Task`
  * `Dataset: Create Task`
  * `Dataset: Start Session`
  * `Dataset: Stop Session (Upload)`
  * `Dataset: Discard Session`

### 2.2 Cloud configuration

* Settings:

  * `dataset.apiBaseUrl`
* Secret:

  * `dataset.apiToken` in SecretStorage
* Command:

  * “Dataset: Set API token” (writes to SecretStorage)
* On activate:

  * ping `/health`
  * fetch `/tasks` (cache)

**Deliverable**

* Extension can authenticate and list/create tasks from the cloud.

---

## Phase 3 — Session lifecycle (clean slate + baseline capture)

### 3.1 Clean-slate enforcement

On Start Session:

* confirm workspace folder exists
* confirm it’s a git repo
* run `git status --porcelain`
* if non-empty: refuse (clear error message)

### 3.2 Capture baseline

* `baseRef = git rev-parse HEAD`
* capture:

  * repo name (folder name)
  * branch (`git rev-parse --abbrev-ref HEAD`)
  * remote url (optional: `git remote get-url origin`)
* store session state in memory:

  * `taskId`
  * `systemPrompt` (selected template)
  * `userPrompt` (entered in UI)
  * `baseRef`
  * list of pnpm commands run (initially empty)

**Deliverable**

* You can start a session only on clean repos, with baseline saved.

---

## Phase 4 — Git-diff driven record generation (the core)

### 4.1 Compute changed files

On Stop Session:

* `git diff --name-status <baseRef>`
  Parse:
* `M path` → update
* `A path` → create
* `D path` → delete
* `Rxxx old new` → delete+create (v1)

Ignore:

* `.agent-dataset/`
* `node_modules/`, `.next/`, build outputs
* any configurable ignore globs

### 4.2 Generate `repo.readFile` traces for modified/deleted

For each touched file with `M` or `D`:

* add assistant tool call: `repo.readFile { path }`
* tool result content:

  * `git show <baseRef>:<path>` (exact bytes)
    If `git show` fails (binary or missing):
* either skip with a marker, or mark session invalid (I’d skip binaries + warn)

### 4.3 Generate `apply_patch` operations

Build a single `apply_patch` call with ordered ops.

**Updates**

* run `git diff <baseRef> -- <path>`
* strip headers; keep only hunks starting at first `@@`
* store as `update_file.diff` exactly (no trimming)

**Creates**

* read working tree file contents from disk
* store as `create_file.diff` exactly

**Deletes**

* `{ type: "delete_file", path }`

**Ordering**

* deterministic sort by path
* (optional) deletes first, then updates, then creates

### 4.4 Record `apply_patch` tool result

* Either:

  * store a stable stub: `{"ok":true}`
  * or actually run your patch applier locally (not needed; the diff is already ground truth)

**Deliverable**

* Stop Session produces a valid `{ messages: [...] }` record with tool calls and results, derived purely from git.

---

## Phase 5 — `run_cmd` buttons (pnpm) + strict validator

### 5.1 Webview buttons

Add buttons for:

* `pnpm i`
* `pnpm add`
* `pnpm add -D`
* `pnpm remove`
* `pnpm lint`
* `pnpm test`
* `pnpm build`

Add UI inputs:

* filter (optional): `--filter <selector>`
* packages input for add/remove
* timeout

### 5.2 Strict allowlist validator (shared)

Implement a single validator used for:

* enabling/disabling the UI buttons
* checking any `run_cmd` record before upload

Allow patterns:

* unfiltered: lint/test/build/i/install/add/remove
* filtered: `--filter <selector> ...` for lint/test/build/add/remove/i/install
* optionally `-r lint/test/build`

Reject everything else.

### 5.3 Recording run_cmd traces

When a button is clicked:

* add assistant tool call: `run_cmd { cmd:"pnpm", args:[...], cwd }`
* execute `pnpm` via Node child_process
* add tool result with stdout+stderr (truncate to size limit)
* store a summary in session metrics

**Deliverable**

* You can run pnpm commands via the extension and they are recorded as tool traces.

---

## Phase 6 — Upload to cloud + server-side validation

### 6.1 Upload flow

On Stop Session:

* build record
* POST `/sessions` with:

  * metadata fields
  * `record` json

### 6.2 Server validation gates

Server validates:

* schema shape (messages, tool_call_id linkage)
* `apply_patch` ops: update hunks contain `@@`, create has diff, delete no diff
* `run_cmd` args satisfy allowlist
* record size within limits
* secret scrubbing (basic)

Return:

* `{ sessionId }`

**Deliverable**

* Every saved session lands in Postgres safely and consistently.

---

## Phase 7 — Task-centric workflow + exports

### 7.1 Task selection UX

* dropdown to pick existing task
* create task modal (id, name, description)
* persist last selected task

### 7.2 Export JSONL (cloud)

Backend:

* `GET /export.jsonl?taskId=...`
* streams one JSON line per session:

  * `{ "messages": [...] }`
    Optional:
* `?since=...` or `?limit=...`

Extension:

* “Export task JSONL” button downloads the file (or opens in browser)

**Deliverable**

* You can train task-by-task from clean exports.

---

## Phase 8 — Quality features that will save you later

### 8.1 Noise control

* Truncate `run_cmd` outputs (e.g. 50k chars) with “(truncated)” marker
* Skip binary files
* Ignore generated folders
* Warn if too many files changed (e.g. >50)

### 8.2 Secret protection

* Ignore patterns config (user setting)
* Regex redaction on outputs (tokens, keys)
* Optional “never upload file contents” mode (metadata only) for sensitive repos

### 8.3 “Ready for training” status

Add `status: draft|ready` to sessions in DB.
Extension can mark ready when:

* apply_patch exists
* at least one validation command run (configurable)
* no redaction warnings

---

## Phase 9 — Training loop integration (later, but planned)

* Filter sessions by task + ready
* Export train/eval splits (by repo, by time)
* Track benchmarks per adapter version
* Store benchmark results alongside sessions
