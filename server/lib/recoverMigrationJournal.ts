/**
 * recoverMigrationJournal.ts
 *
 * Core logic extracted from scripts/recover-migration-journal.ts so it can be
 * exercised by automated tests without spawning a subprocess.
 *
 * The caller is responsible for acquiring and releasing the pg client.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface RecoverJournalResult {
  orphansRemoved: number;
  duplicatesRemoved: number;
  realigned: number;
  recovered: number;
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

// Minimal interface for a pg PoolClient used by the recovery logic —
// narrow enough that a mock object satisfies it in tests.
export interface MigrationDbClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/**
 * Brings the drizzle.__drizzle_migrations tracking table into a consistent
 * state relative to the on-disk journal:
 *
 *  1. Removes orphan rows (hash not in any current migration SQL file).
 *  2. Removes duplicate rows for the same hash (keeps newest; skips hashes
 *     that map to multiple distinct journal entries — ambiguous case).
 *  3. Aligns each survivor row's created_at with the journal's `when`.
 *  4. Runs and records any journal entry whose hash is missing from the DB.
 *
 * @param client     A connected pg PoolClient (or a compatible mock).
 * @param migrationsDir  Absolute path to the migrations/ directory.
 * @param fsMod      Optionally inject a fs-like module (used in tests).
 * @returns Counts of changes made in each phase.
 */
export async function recoverMigrationJournal(
  client: MigrationDbClient,
  migrationsDir: string,
  fsMod: Pick<typeof fs, "existsSync" | "readFileSync"> = fs,
): Promise<RecoverJournalResult> {
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");

  if (!fsMod.existsSync(journalPath)) {
    console.log("[recover-journal] No journal found — skipping.");
    return { orphansRemoved: 0, duplicatesRemoved: 0, realigned: 0, recovered: 0 };
  }

  const journal = JSON.parse(fsMod.readFileSync(journalPath, "utf-8") as string) as {
    entries: JournalEntry[];
  };

  // ── Bootstrap the tracking table if absent ──────────────────────────────
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  // ── Read current tracking rows ───────────────────────────────────────────
  const { rows: dbRows } = await client.query<{
    id: number;
    hash: string;
    created_at: string | null;
  }>(
    `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
     ORDER BY created_at ASC NULLS FIRST, id ASC`,
  );

  // ── Build hash maps from journal ─────────────────────────────────────────
  /** hash → journal `when` (last entry wins for the ambiguous case) */
  const journalWhenByHash = new Map<string, number>();
  /** hash → count of journal entries that produce this hash */
  const journalHashCounts = new Map<string, number>();
  /** hash → tag (used only for forward-recovery logging) */
  const knownHashes = new Map<string, string>();

  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fsMod.existsSync(sqlPath)) continue;
    const content = fsMod.readFileSync(sqlPath, "utf-8") as string;
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    knownHashes.set(hash, entry.tag);
    journalWhenByHash.set(hash, entry.when);
    journalHashCounts.set(hash, (journalHashCounts.get(hash) ?? 0) + 1);
  }

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
  // Rows are ordered created_at ASC, so the last row seen per hash is newest.
  const newestRowByHash = new Map<string, { id: number; created_at: string | null }>();
  const rowsByHash = new Map<string, number[]>();
  for (const row of dbRows) {
    if (orphanIds.includes(row.id)) continue;
    newestRowByHash.set(row.hash, row);
    const ids = rowsByHash.get(row.hash) ?? [];
    ids.push(row.id);
    rowsByHash.set(row.hash, ids);
  }

  const duplicateIds: number[] = [];
  for (const [hash, ids] of rowsByHash) {
    if (ids.length <= 1) continue;
    if ((journalHashCounts.get(hash) ?? 1) > 1) {
      // Ambiguous: multiple journal entries share identical SQL content.
      // Deduping could delete a legitimately-tracked row — skip with a warning.
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

  // ── 1c. TIMESTAMP REALIGNMENT ────────────────────────────────────────────
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

  // ── 2. FORWARD RECOVERY ──────────────────────────────────────────────────
  const removedIds = new Set([...orphanIds, ...duplicateIds]);
  const appliedHashes = new Set(
    dbRows.filter((r) => !removedIds.has(r.id)).map((r) => r.hash),
  );

  let recovered = 0;
  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fsMod.existsSync(sqlPath)) continue;

    const sqlContent = fsMod.readFileSync(sqlPath, "utf-8") as string;
    const hash = crypto.createHash("sha256").update(sqlContent).digest("hex");

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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[recover-journal] ERROR running statement in ${entry.tag}:\n${stmt}\n`,
          message,
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
  if (
    orphanIds.length === 0 &&
    duplicateIds.length === 0 &&
    realigned === 0 &&
    recovered === 0
  ) {
    console.log(
      `[recover-journal] All migrations already tracked — no recovery needed.`,
    );
  } else {
    const parts: string[] = [];
    if (orphanIds.length > 0) parts.push(`removed ${orphanIds.length} orphan(s)`);
    if (duplicateIds.length > 0) parts.push(`removed ${duplicateIds.length} duplicate(s)`);
    if (realigned > 0) parts.push(`realigned ${realigned} timestamp(s)`);
    if (recovered > 0) parts.push(`recovered ${recovered} missing migration(s)`);
    console.log(
      `[recover-journal] Done: ${parts.join(", ")}. Journal is now consistent.`,
    );
  }

  return {
    orphansRemoved: orphanIds.length,
    duplicatesRemoved: duplicateIds.length,
    realigned,
    recovered,
  };
}
