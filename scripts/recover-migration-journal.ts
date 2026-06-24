#!/usr/bin/env tsx
/**
 * recover-migration-journal.ts
 *
 * Ensures every migration in the journal has a tracking record in
 * drizzle.__drizzle_migrations. For any migration whose hash is absent from
 * the tracking table, the script runs the SQL (all migrations in this project
 * use IF NOT EXISTS / IF EXISTS guards, making them idempotent) and inserts
 * the corresponding hash record.
 *
 * This resolves a production state where some migrations were applied
 * out-of-band (e.g. via drizzle-kit push or the runtime migrator) without
 * their hashes being recorded, causing drizzle-kit migrate to detect an
 * inconsistent ordering and silently refuse to apply the remaining migrations.
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

  const { rows } = await client.query<{ hash: string }>(
    `SELECT hash FROM drizzle.__drizzle_migrations`,
  );
  const appliedHashes = new Set(rows.map((r) => r.hash));

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

  if (recovered > 0) {
    console.log(
      `[recover-journal] Recovered ${recovered} migration(s). Journal is now consistent.`,
    );
  } else {
    console.log(
      `[recover-journal] All migrations already tracked — no recovery needed.`,
    );
  }
} finally {
  client.release();
  await pool.end();
}
