#!/usr/bin/env tsx
/**
 * assert-migrations-applied.ts
 *
 * Connects to the database and verifies that every migration in the Drizzle
 * journal has been applied AND that there are no orphan tracking rows (rows
 * in __drizzle_migrations with no corresponding journal entry).  Exits 1 with
 * a clear error if either condition is detected so that scripts/pre-start.sh
 * can abort the deploy before the server ever starts serving traffic.
 *
 * Note: orphan rows should already have been removed by the recover-migration-
 * journal.ts step that runs earlier in pre-start.sh. This check is a safety
 * net in case something goes wrong.
 *
 * Also performs a fast, pure-filesystem snapshot check before the DB round
 * trip: if any journal entry is missing its migrations/meta/<idx>_snapshot.json
 * file, drizzle-kit will silently skip that migration, so we abort early.
 *
 * Usage:
 *   npx tsx scripts/assert-migrations-applied.ts
 */

import pg from "pg";
import { checkMigrationDrift } from "../server/lib/migrationCheck.js";
import { checkMigrationSnapshots } from "./check-migration-snapshots.js";

// --- 1. Fast snapshot check (pure filesystem, no DB needed) ------------------
// Drizzle-kit silently skips migrations whose snapshot files are absent.
// Catch this early before spending time on a DB connection.

const snapshotResult = checkMigrationSnapshots();
if (snapshotResult.missing.length > 0) {
  const list = snapshotResult.missing
    .map((m) => `  • migrations/meta/${m.expectedFile}  (idx ${m.idx} — ${m.tag})`)
    .join("\n");
  console.error(
    `\n[assert-migrations] FATAL: ${snapshotResult.missing.length} migration snapshot file(s) are missing.\n` +
      `Drizzle-kit silently skips migrations without snapshot files, so the\n` +
      `database schema may be incomplete even after db:migrate succeeds.\n\n` +
      `Missing snapshot files:\n${list}\n\n` +
      `Restore the files from git or re-run: npx drizzle-kit generate\n`,
  );
  process.exit(1);
}

console.log(
  `[assert-migrations] Snapshot check OK — all ${snapshotResult.checked} migration(s) have snapshot files.`,
);

// --- 2. DB check: verify every migration has been applied --------------------

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[assert-migrations] ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const result = await checkMigrationDrift(pool);

  if (result.extra > 0) {
    console.error(
      `\n[assert-migrations] FATAL: the database has ${result.extra} more tracking row(s) ` +
        `than the journal (${result.applied} in DB, ${result.expected.length} in journal).\n\n` +
        `This usually means a migration file was removed from the repo after being applied,\n` +
        `or the recovery script failed to clean up an orphan row.\n\n` +
        `Run scripts/recover-migration-journal.ts to clean up orphan rows, then retry.\n`,
    );
    process.exit(1);
  }

  if (result.pending.length === 0) {
    console.log(
      `[assert-migrations] OK — all ${result.expected.length} migration(s) applied.`,
    );
    process.exit(0);
  }

  const list = result.pending.map((t) => `  • ${t}`).join("\n");
  console.error(
    `\n[assert-migrations] FATAL: ${result.pending.length} unapplied migration(s) remain after db:migrate:\n${list}\n\n` +
      `This usually means db:migrate failed silently or the journal is out of sync.\n` +
      `Aborting deploy. Check the output above and re-run: npm run db:migrate\n`,
  );
  process.exit(1);
} finally {
  await pool.end();
}
