# Next.js + TypeScript Agent Training Tasks

> Each task has **two datasets** to build:
>
> * **Normal repo** (single app)
> * **Monorepo** (pnpm workspaces + `--filter` where relevant)

---

## Server / Client Component Discipline

* [ ] (Normal) [ ] (Monorepo) **Convert Client Component → Server Component** — `rsc-convert-client-to-server`
* [ ] (Normal) [ ] (Monorepo) **Convert Server Component → Client Component** — `rsc-convert-server-to-client`
* [ ] (Normal) [ ] (Monorepo) **Split Interactive UI into Server + Client Leaf** — `rsc-split-server-client-leaf`
* [ ] (Normal) [ ] (Monorepo) **Fix invalid hook usage in Server Components** — `rsc-fix-server-hook-misuse`
* [ ] (Normal) [ ] (Monorepo) **Fix next/navigation misuse in RSC** — `rsc-fix-navigation-misuse`
* [ ] (Normal) [ ] (Monorepo) **Fix hydration mismatch** — `ui-fix-hydration-mismatch`

---

## Data Fetching & Caching

* [ ] (Normal) [ ] (Monorepo) **Add server data fetching with cache options** — `data-fetch-add-cache-options`
* [ ] (Normal) [ ] (Monorepo) **Convert client fetch → server fetch** — `data-fetch-client-to-server`
* [ ] (Normal) [ ] (Monorepo) **Add revalidation (revalidate/tags)** — `data-fetch-add-revalidation`
* [ ] (Normal) [ ] (Monorepo) **Fix waterfall fetching** — `data-fetch-fix-waterfall`
* [ ] (Normal) [ ] (Monorepo) **Introduce caching abstraction (e.g. unstable_cache pattern)** — `data-fetch-add-unstable-cache`

---

## Route Handlers & API

* [ ] (Normal) [ ] (Monorepo) **Create route handler (GET/POST)** — `route-handler-create`
* [ ] (Normal) [ ] (Monorepo) **Add validation to route handler (Zod etc.)** — `route-handler-add-validation`
* [ ] (Normal) [ ] (Monorepo) **Fix incorrect HTTP method handling** — `route-handler-fix-methods`
* [ ] (Normal) [ ] (Monorepo) **Add auth guard to route handler** — `route-handler-add-auth`
* [ ] (Normal) [ ] (Monorepo) **Migrate pages API route → app route handler** — `route-handler-migrate-pages-to-app`

---

## Server Actions

* [ ] (Normal) [ ] (Monorepo) **Create server action** — `server-action-create`
* [ ] (Normal) [ ] (Monorepo) **Migrate mutation from API route → server action** — `server-action-migrate-from-api`
* [ ] (Normal) [ ] (Monorepo) **Add validation to server action** — `server-action-add-validation`
* [ ] (Normal) [ ] (Monorepo) **Fix server action serialization issue** — `server-action-fix-serialization`

---

## TanStack Query

* [ ] (Normal) [ ] (Monorepo) **Add TanStack Query to repo (provider + client setup)** — `tanstack-setup`
* [ ] (Normal) [ ] (Monorepo) **Create a typed query + hook (queryKey discipline)** — `tanstack-create-typed-query`
* [ ] (Normal) [ ] (Monorepo) **Add mutation + invalidation pattern** — `tanstack-mutation-invalidate`
* [ ] (Normal) [ ] (Monorepo) **Fix stale cache / incorrect queryKey usage** — `tanstack-fix-querykey-cache`
* [ ] (Normal) [ ] (Monorepo) **Prefetch + hydrate (SSR/RSC-friendly pattern)** — `tanstack-prefetch-hydrate`
* [ ] (Normal) [ ] (Monorepo) **Error handling + retries policy** — `tanstack-error-retry-policy`

---

## Prisma

* [ ] (Normal) [ ] (Monorepo) **Add Prisma to repo (schema + generate + env)** — `prisma-setup`
* [ ] (Normal) [ ] (Monorepo) **Add model + migration** — `prisma-add-model-migration`
* [ ] (Normal) [ ] (Monorepo) **Create typed db client + singleton pattern** — `prisma-client-singleton`
* [ ] (Normal) [ ] (Monorepo) **Write CRUD query + typesafe selection** — `prisma-crud-typed`
* [ ] (Normal) [ ] (Monorepo) **Fix N+1 / inefficient queries (include/select)** — `prisma-fix-query-performance`
* [ ] (Normal) [ ] (Monorepo) **Handle schema change fallout (types/build errors)** — `prisma-fix-schema-change-errors`

---

## Styling & UI

* [ ] (Normal) [ ] (Monorepo) **Add Tailwind to existing repo** — `tailwind-setup`
* [ ] (Normal) [ ] (Monorepo) **Migrate CSS Modules → Tailwind** — `tailwind-migrate-css-module`
* [ ] (Normal) [ ] (Monorepo) **Refactor component to shadcn patterns** — `shadcn-refactor-component`
* [ ] (Normal) [ ] (Monorepo) **Add dark mode support** — `ui-add-dark-mode`

---

## Dependencies & Tooling

* [ ] (Normal) [ ] (Monorepo) **Add dependency (root)** — `deps-add-root`
* [ ] (Normal) [ ] (Monorepo) **Add dependency (filtered workspace)** — `deps-add-filtered`
* [ ] (Normal) [ ] (Monorepo) **Remove dependency (root/filtered)** — `deps-remove`
* [ ] (Normal) [ ] (Monorepo) **Upgrade dependency safely** — `deps-upgrade`

---

## Testing & Linting

* [ ] (Normal) [ ] (Monorepo) **Fix ESLint error** — `lint-fix-error`
* [ ] (Normal) [ ] (Monorepo) **Fix TypeScript error** — `ts-fix-error`
* [ ] (Normal) [ ] (Monorepo) **Fix failing unit test** — `test-fix-failure`
* [ ] (Normal) [ ] (Monorepo) **Add unit test for feature** — `test-add-unit`
* [ ] (Normal) [ ] (Monorepo) **Fix build failure** — `build-fix-error`

---

## Monorepo / Workspace Discipline

* [ ] (Normal) [ ] (Monorepo) **Fix cross-package import boundaries** — `monorepo-fix-import-boundaries`
* [ ] (Normal) [ ] (Monorepo) **Move file between packages safely** — `monorepo-move-file`
* [ ] (Normal) [ ] (Monorepo) **Add shared package + consume it** — `monorepo-add-shared-package`
* [ ] (Normal) [ ] (Monorepo) **Use `pnpm --filter` correctly (lint/test/build/add/remove)** — `monorepo-use-filtered-pnpm`

---

## Refactoring Discipline

* [ ] (Normal) [ ] (Monorepo) **Smallest-change refactor (no behavior change)** — `refactor-minimal-change`
* [ ] (Normal) [ ] (Monorepo) **Extract component** — `refactor-extract-component`
* [ ] (Normal) [ ] (Monorepo) **Rename/move component safely** — `refactor-rename-move-component`
* [ ] (Normal) [ ] (Monorepo) **Remove dead code** — `refactor-remove-dead-code`

---

## Agent Discipline Tasks

* [ ] (Normal) [ ] (Monorepo) **Read before edit (enforced pattern)** — `agent-read-before-edit`
* [ ] (Normal) [ ] (Monorepo) **Search before multi-file edit** — `agent-search-before-multi-edit`
* [ ] (Normal) [ ] (Monorepo) **Run lint after patch** — `agent-run-lint-after-patch`
* [ ] (Normal) [ ] (Monorepo) **Run build after structural change** — `agent-run-build-after-structural`
* [ ] (Normal) [ ] (Monorepo) **Avoid unnecessary dependencies** — `agent-avoid-unnecessary-dep`