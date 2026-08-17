#!/usr/bin/env tsx
/**
 * recover-migration-journal.ts
 *
 * Brings the drizzle.__drizzle_migrations tracking table into a consistent
 * state relative to the migrations/ journal in two directions:
 *
 * 1. FORWARD RECOVERY — for any journal entry whose hash is absent from the
 *    tracking table, runs the SQL (all migrations in this project use
 *    IF NOT EXISTS / IF EXISTS guards, making them idempotent) and inserts
 *    the corresponding hash record.
 *
 * 2. ORPHAN CLEANUP — deletes any tracking rows whose hash does NOT match
 *    any current journal entry.  Orphan rows accumulate when a migration file
 *    is removed from the repo after being applied (e.g. a no-op placeholder
 *    that was cleaned up), causing the server's extra-row check to abort
 *    startup with a false-positive FATAL.
 *
 * Run this BEFORE drizzle-kit migrate so drizzle-kit sees a complete,
 * consistent applied-hash set and can correctly determine which migrations
 * (if any) still need to be applied.
 */

import pg from "pg";
import path from "path";
import { recoverMigrationJournal } from "../server/lib/recoverMigrationJournal.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[recover-journal] ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const migrationsDir = path.resolve(process.cwd(), "migrations");

const client = await pool.connect();
try {
  await recoverMigrationJournal(client, migrationsDir);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[recover-journal] FATAL:", message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
