# Dataset Server (Prisma + Postgres)

## Setup

1. Copy `.env.example` to `.env` and set values.
2. Install dependencies:

```bash
pnpm install
```

3. Generate Prisma client:

```bash
pnpm prisma:generate
```

4. Create/apply migrations:

```bash
pnpm prisma:migrate --name init
```

5. Start server:

```bash
pnpm dev
```

6. Run server tests:

```bash
pnpm test
```

## API

- `GET /health`
- `GET /tasks` (auth)
- `POST /tasks` (auth)
- `POST /sessions` (auth)
- `GET /export.jsonl?taskId=...&since=...&limit=...` (auth)

Auth uses `Authorization: Bearer <token>` and token values from `API_TOKENS` in `.env`.

## Validation behavior

- Enforces training record schema and tool-call/result linkage.
- Validates `run_cmd` against strict pnpm allowlist.
- Validates `apply_patch` operation invariants.
- Derives `status` (`draft|ready`) from record content server-side and rejects mismatched client-provided status.