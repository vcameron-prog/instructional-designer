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
import fs from "fs";
import path from "path";
import crypto from "crypto";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[recover-journal] ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const migrationsDir = path.resolve(process.cwd(), "migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

if (!fs.existsSync(journalPath)) {
  console.log("[recover-journal] No journal found — skipping.");
  await pool.end();
  process.exit(0);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

/** Compute SHA-256 of each SQL file that exists on disk. */
function buildKnownHashes(): Map<string, string> {
  const map = new Map<string, string>(); // hash → tag
  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const content = fs.readFileSync(sqlPath, "utf-8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    map.set(hash, entry.tag);
  }
  return map;
}

const knownHashes = buildKnownHashes();

const client = await pool.connect();
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  const { rows: dbRows } = await client.query<{ id: number; hash: string }>(
    `SELECT id, hash FROM drizzle.__drizzle_migrations`,
  );

  // ── 1. ORPHAN CLEANUP ────────────────────────────────────────────────────
  const orphanIds: number[] = [];
  for (const row of dbRows) {
    if (!knownHashes.has(row.hash)) {
      orphanIds.push(row.id);
    }
  }
  if (orphanIds.length > 0) {
    await client.query(
      `DELETE FROM drizzle.__drizzle_migrations WHERE id = ANY($1::int[])`,
      [orphanIds],
    );
    console.log(
      `[recover-journal] Removed ${orphanIds.length} orphan tracking row(s) ` +
        `(hash not found in any current migration file).`,
    );
  }

  // Rebuild the set of applied hashes after cleanup.
  const appliedHashes = new Set(
    dbRows.filter((r) => !orphanIds.includes(r.id)).map((r) => r.hash),
  );

  // ── 2. FORWARD RECOVERY ──────────────────────────────────────────────────
  let recovered = 0;

  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;

    const sqlContent = fs.readFileSync(sqlPath, "utf-8");
    const hash = crypto
      .createHash("sha256")
      .update(sqlContent)
      .digest("hex");

    if (appliedHashes.has(hash)) continue;

    console.log(
      `[recover-journal] Running missing migration: ${entry.tag} (hash ${hash.slice(0, 12)}…)`,
    );

    const statements = sqlContent
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (err: any) {
        console.error(
          `[recover-journal] ERROR running statement in ${entry.tag}:\n${stmt}\n`,
          err.message,
        );
        throw err;
      }
    }

    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [hash, entry.when],
    );
    appliedHashes.add(hash);
    recovered++;
    console.log(`[recover-journal] ✓ Recorded: ${entry.tag}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  if (orphanIds.length === 0 && recovered === 0) {
    console.log(
      `[recover-journal] All migrations already tracked — no recovery needed.`,
    );
  } else {
    const parts: string[] = [];
    if (orphanIds.length > 0) parts.push(`removed ${orphanIds.length} orphan(s)`);
    if (recovered > 0) parts.push(`recovered ${recovered} missing migration(s)`);
    console.log(
      `[recover-journal] Done: ${parts.join(", ")}. Journal is now consistent.`,
    );
  }
} finally {
  client.release();
  await pool.end();
}
