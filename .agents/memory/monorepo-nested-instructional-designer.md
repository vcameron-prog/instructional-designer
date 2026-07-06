---
name: Monorepo has two parallel apps
description: The root workspace and instructional-designer/ subdirectory are two separate, independently-tested apps — don't assume changes in one apply to the other.
---

This repo contains two independent full-stack apps:
- Root workspace (`server/`, `client/`, etc.) — the primary "BSU Accessibility Tool" app described in replit.md.
- `instructional-designer/` — a separate nested app with its own `server/`, `client/`, `package.json`, `node_modules`, and test suite.

The `unit-tests` workflow runs both in sequence (`npx vitest run && cd instructional-designer && npx vitest run`), so a single `unit-tests` failure can come from either app.

**Why this matters:** the two `routes.ts` files are NOT the same module and can have completely different imports/behavior (e.g. root's `routes.ts` imports several named exports from `./lib/accessibility-engine`, while `instructional-designer/server/routes.ts` does not import that module directly at all). Fixes, mocks, or refactors made in one do not apply to the other.

**How to apply:** when investigating a `unit-tests` failure, check which `RUN` block (workspace path) the failure came from before assuming it's related to your current change. If your change only touched root `server/` files, failures under `instructional-designer/` are almost certainly pre-existing and out of scope.
