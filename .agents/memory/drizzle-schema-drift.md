---
name: Drizzle schema drift in dev DB
description: Dev DB is missing columns added to Drizzle schema but not yet migrated; raw SQL needed for test endpoints.
---

# Drizzle schema drift in dev DB

## The rule
The dev DB is behind the Drizzle schema. Several columns exist in `shared/schema.ts` but not in the live DB tables:
- `conversions.processing_started_at` (TIMESTAMPTZ)
- `conversions.selected_sheet` (TEXT)
- `users.preferences` (JSONB)

Drizzle ORM inserts/selects include all schema columns, so `db.insert(users).values(...)` and `db.select({processingStartedAt: conversions.processingStartedAt})` fail with column-not-found errors at runtime.

**Why:** Schema migrations have not been applied (no `drizzle-kit push` or migration runner at startup).

## How to apply
- In dev-only test endpoints (`POST /api/test/login`, `POST /api/test/seed-conversion`), use raw SQL (`db.execute(sql\`...\``) with only the columns that actually exist in the DB.
- The columns were patched with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` directly on the dev DB as a workaround during test setup. A proper fix is tracked as a follow-up task: apply the migration so normal Drizzle ORM calls work everywhere.
