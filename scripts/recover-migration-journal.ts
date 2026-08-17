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

  const { rows: dbRows } = await client.query<{
    id: number;
    hash: string;
    created_at: string | null;
  }>(
    `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
     ORDER BY created_at ASC NULLS FIRST, id ASC`,
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

  // ── 1b. DUPLICATE CLEANUP ───────────────────────────────────────────────
  // A migration can end up tracked twice (same hash, two rows) when a journal
  // entry's `when` timestamp is corrected after the migration was already
  // applied — drizzle-kit re-applies it under the new timestamp and inserts a
  // second row. Drizzle's migration cursor is the greatest created_at, so we
  // must keep the NEWEST row per hash (deleting it would make the migration
  // look unapplied and db:migrate would recreate the duplicate). We then align
  // the survivor's created_at with the journal's `when` so the cursor matches
  // the journal exactly. Rows are ordered by created_at ASC, so the last row
  // seen per hash is the newest.
  const journalWhenByHash = new Map<string, number>(); // hash → journal `when`
  const journalHashCounts = new Map<string, number>();
  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const h = crypto
      .createHash("sha256")
      .update(fs.readFileSync(sqlPath, "utf-8"))
      .digest("hex");
    journalWhenByHash.set(h, entry.when);
    journalHashCounts.set(h, (journalHashCounts.get(h) ?? 0) + 1);
  }

  const newestRowByHash = new Map<string, { id: number; created_at: string | null }>();
  const rowsByHash = new Map<string, number[]>();
  for (const row of dbRows) {
    if (orphanIds.includes(row.id)) continue;
    newestRowByHash.set(row.hash, row); // rows are created_at ASC → last wins
    const ids = rowsByHash.get(row.hash) ?? [];
    ids.push(row.id);
    rowsByHash.set(row.hash, ids);
  }

  const duplicateIds: number[] = [];
  for (const [hash, ids] of rowsByHash) {
    if (ids.length <= 1) continue;
    if ((journalHashCounts.get(hash) ?? 1) > 1) {
      // Ambiguous: two distinct journal entries share identical SQL content.
      // Deduping here could delete a legitimately-tracked row — refuse.
      console.warn(
        `[recover-journal] WARNING: hash ${hash.slice(0, 12)}… maps to multiple ` +
          `journal entries; skipping duplicate cleanup for it.`,
      );
      continue;
    }
    const keepId = newestRowByHash.get(hash)!.id;
    for (const id of ids) if (id !== keepId) duplicateIds.push(id);
  }
  if (duplicateIds.length > 0) {
    await client.query(
      `DELETE FROM drizzle.__drizzle_migrations WHERE id = ANY($1::int[])`,
      [duplicateIds],
    );
    console.log(
      `[recover-journal] Removed ${duplicateIds.length} duplicate tracking row(s) ` +
        `(same hash tracked more than once; kept newest per hash).`,
    );
  }

  // Align each surviving row's created_at with the journal's `when` so
  // drizzle's cursor (max created_at) reflects the journal and db:migrate
  // won't re-apply an already-tracked migration.
  let realigned = 0;
  for (const [hash, row] of newestRowByHash) {
    const when = journalWhenByHash.get(hash);
    if (when === undefined || (journalHashCounts.get(hash) ?? 1) > 1) continue;
    if (row.created_at !== null && Number(row.created_at) === when) continue;
    await client.query(
      `UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2`,
      [when, row.id],
    );
    realigned++;
  }
  if (realigned > 0) {
    console.log(
      `[recover-journal] Realigned created_at on ${realigned} tracking row(s) to match the journal.`,
    );
  }

  // Rebuild the set of applied hashes after cleanup.
  const removedIds = new Set([...orphanIds, ...duplicateIds]);
  const appliedHashes = new Set(
    dbRows.filter((r) => !removedIds.has(r.id)).map((r) => r.hash),
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
  if (orphanIds.length === 0 && duplicateIds.length === 0 && recovered === 0) {
    console.log(
      `[recover-journal] All migrations already tracked — no recovery needed.`,
    );
  } else {
    const parts: string[] = [];
    if (orphanIds.length > 0) parts.push(`removed ${orphanIds.length} orphan(s)`);
    if (duplicateIds.length > 0) parts.push(`removed ${duplicateIds.length} duplicate(s)`);
    if (recovered > 0) parts.push(`recovered ${recovered} missing migration(s)`);
    console.log(
      `[recover-journal] Done: ${parts.join(", ")}. Journal is now consistent.`,
    );
  }
} finally {
  client.release();
  await pool.end();
}
