import fs from "fs";
import path from "path";
import type pg from "pg";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface MigrationDriftResult {
  expected: string[];
  applied: number;
  pending: string[];
}

/**
 * Reads the Drizzle migration journal and compares it against the
 * `drizzle.__drizzle_migrations` table to surface any unapplied migrations.
 *
 * Only journal entries that have a corresponding .sql file on disk are counted;
 * phantom entries (e.g. manually added placeholders) are ignored.
 */
export async function checkMigrationDrift(
  pool: pg.Pool,
): Promise<MigrationDriftResult> {
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    return { expected: [], applied: 0, pending: [] };
  }

  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

  const expectedTags = journal.entries
    .filter((entry) =>
      fs.existsSync(path.join(migrationsDir, `${entry.tag}.sql`)),
    )
    .map((entry) => entry.tag);

  let appliedCount = 0;
  const client = await pool.connect();
  try {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM information_schema.tables
        WHERE table_schema = 'drizzle'
          AND table_name   = '__drizzle_migrations'`,
    );
    const tableExists = parseInt(result.rows[0].count, 10) > 0;

    if (tableExists) {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations`,
      );
      appliedCount = parseInt(countResult.rows[0].count, 10);
    }
  } finally {
    client.release();
  }

  const pending = expectedTags.slice(appliedCount);

  return {
    expected: expectedTags,
    applied: appliedCount,
    pending,
  };
}
