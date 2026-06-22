#!/usr/bin/env tsx
/**
 * assert-migrations-applied.ts
 *
 * Connects to the database and verifies that every migration in the Drizzle
 * journal has been applied.  Exits 1 with a clear error if any are still
 * pending so that scripts/pre-start.sh can abort the deploy before the server
 * ever starts serving traffic.
 *
 * Usage:
 *   npx tsx scripts/assert-migrations-applied.ts
 */

import pg from "pg";
import { checkMigrationDrift } from "../server/lib/migrationCheck.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[assert-migrations] ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const result = await checkMigrationDrift(pool);

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
