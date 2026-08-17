---
name: Drizzle journal `when` must be monotonically increasing
description: Why a hand-added migration journal entry can be silently skipped forever by drizzle-kit migrate.
---

Rule: when hand-adding an entry to `migrations/meta/_journal.json`, its `when` timestamp MUST be greater than every previously applied migration's timestamp.

**Why:** drizzle-kit migrate only applies migrations whose `when` (folderMillis) exceeds the max `created_at` in `drizzle.__drizzle_migrations`. An older timestamp is skipped silently while migrate still prints "migrations applied successfully" — the table may exist (via other apply paths) but no tracking row is written, so count-based drift checks (journal entries vs tracking rows) fail forever.

**How to apply:** before committing a manual journal entry, compare its `when` to the newest existing entry and pick a larger value. Keep the migration SQL idempotent (IF NOT EXISTS) so re-applying after a timestamp fix is safe on databases where the objects already exist.
