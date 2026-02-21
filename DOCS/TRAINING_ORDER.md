## Recommended training order (Phase A → D)

Goal: get a model that’s **safe + boring + correct** first, then layer framework skills, then ecosystem (TanStack/Prisma), then monorepo + advanced patterns.

---

# Phase A — Agent discipline + “don’t break stuff” foundations

Do these first because they improve every other task.

* [ ] `refactor-minimal-change`
* [ ] `agent-read-before-edit`
* [ ] `agent-search-before-multi-edit`
* [ ] `agent-run-lint-after-patch`
* [ ] `ts-fix-error`
* [ ] `lint-fix-error`
* [ ] `build-fix-error`

**Why:** teaches smallest diffs, correct tool sequencing, and basic build hygiene.

---

# Phase B — Next.js core (RSC + routing + server actions)

This makes it a real Next.js engineer.

* [ ] `rsc-convert-client-to-server`
* [ ] `rsc-split-server-client-leaf`
* [ ] `rsc-fix-server-hook-misuse`
* [ ] `rsc-fix-navigation-misuse`
* [ ] `route-handler-create`
* [ ] `route-handler-add-validation`
* [ ] `route-handler-add-auth`
* [ ] `server-action-create`
* [ ] `server-action-add-validation`
* [ ] `server-action-fix-serialization`
* [ ] `server-action-migrate-from-api`

**Why:** RSC boundaries + server-side patterns are where models usually fail.

---

# Phase C — UI + styling + dependency discipline

Adds practical “product work” ability.

* [ ] `tailwind-setup`
* [ ] `tailwind-migrate-css-module`
* [ ] `shadcn-refactor-component`
* [ ] `ui-add-dark-mode`
* [ ] `ui-fix-hydration-mismatch`
* [ ] `deps-add-root`
* [ ] `deps-remove`
* [ ] `agent-avoid-unnecessary-dep`

**Why:** introduces dependency installs but teaches restraint.

---

# Phase D — Ecosystem: TanStack Query + Prisma + monorepo mastery

This is where it becomes “your stack expert”.

## TanStack Query

* [ ] `tanstack-setup`
* [ ] `tanstack-create-typed-query`
* [ ] `tanstack-mutation-invalidate`
* [ ] `tanstack-fix-querykey-cache`
* [ ] `tanstack-prefetch-hydrate`
* [ ] `tanstack-error-retry-policy`

## Prisma

* [ ] `prisma-setup`
* [ ] `prisma-client-singleton`
* [ ] `prisma-add-model-migration`
* [ ] `prisma-crud-typed`
* [ ] `prisma-fix-schema-change-errors`
* [ ] `prisma-fix-query-performance`

## Monorepo discipline (do once you’re confident)

* [ ] `monorepo-use-filtered-pnpm`
* [ ] `deps-add-filtered`
* [ ] `monorepo-fix-import-boundaries`
* [ ] `monorepo-add-shared-package`
* [ ] `monorepo-move-file`

**Why:** these tasks combine tools + installs + multi-package context — do them last.

---

## Rule of thumb per task

For each slug:

1. Build **Normal** dataset until pass rate is solid
2. Then build **Monorepo** dataset for the same task (filtered commands, workspace paths, cross-package imports)
