#!/usr/bin/env tsx
/**
 * check-migration-journal.ts
 *
 * Validates consistency between migrations/meta/_journal.json and the SQL
 * files on disk in two directions:
 *
 *   1. Phantom journal entries  — a journal entry whose .sql file is missing.
 *   2. Orphaned SQL files       — a .sql file on disk with no journal entry.
 *
 * Exits with a non-zero code (and a clear, actionable error message) if
 * either problem is found, so the issue is caught in CI / pre-commit rather
 * than at runtime.
 *
 * Usage:
 *   npx tsx scripts/check-migration-journal.ts
 */

import fs from "fs";
import path from "path";

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

const projectRoot = path.resolve(process.cwd());
const migrationsDir = path.join(projectRoot, "migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

if (!fs.existsSync(journalPath)) {
  console.error(`ERROR: Journal file not found at ${journalPath}`);
  console.error(
    "Make sure you are running this script from the project root.",
  );
  process.exit(1);
}

let journal: Journal;
try {
  journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as Journal;
} catch (err) {
  console.error(`ERROR: Could not parse journal file at ${journalPath}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (!Array.isArray(journal.entries)) {
  console.error(
    `ERROR: Journal at ${journalPath} has no "entries" array. The file may be corrupt.`,
  );
  process.exit(1);
}

// --- 1. Phantom journal entries (entry exists, SQL file is missing) ----------

const phantomEntries = journal.entries.filter(
  (entry) => !fs.existsSync(path.join(migrationsDir, `${entry.tag}.sql`)),
);

// --- 2. Orphaned SQL files (SQL file exists, no journal entry covers it) -----

const journalTags = new Set(journal.entries.map((e) => e.tag));

const sqlFilesOnDisk = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"));

const orphanedFiles = sqlFilesOnDisk.filter((filename) => {
  const tag = filename.replace(/\.sql$/, "");
  return !journalTags.has(tag);
});

// --- Report ------------------------------------------------------------------

if (phantomEntries.length === 0 && orphanedFiles.length === 0) {
  const total = journal.entries.length;
  console.log(
    `✓ Migration journal OK — all ${total} ${total === 1 ? "entry" : "entries"} ` +
      `have a matching SQL file and all SQL files have a journal entry.`,
  );
  process.exit(0);
}

console.error("");
console.error("============================================================");
console.error("  MIGRATION JOURNAL ERROR");
console.error("============================================================");

if (phantomEntries.length > 0) {
  console.error(
    `  ${phantomEntries.length} phantom journal ${phantomEntries.length === 1 ? "entry" : "entries"} — ` +
      `journal ${phantomEntries.length === 1 ? "entry" : "entries"} with no matching SQL file on disk:`,
  );
  console.error("");
  for (const entry of phantomEntries) {
    console.error(
      `    • migrations/${entry.tag}.sql   (journal idx ${entry.idx})`,
    );
  }
  console.error("");
  console.error("  How to fix phantom entries:");
  console.error(
    "    Option A — The SQL file was accidentally deleted or never committed:",
  );
  console.error("      Re-create the missing file(s) or restore them from git:");
  console.error(`        git checkout HEAD -- migrations/<tag>.sql`);
  console.error("");
  console.error(
    "    Option B — The journal entry was added by mistake (no real migration):",
  );
  console.error(
    "      Remove the phantom entry/entries from migrations/meta/_journal.json",
  );
  console.error(
    "      and re-run the migration generator if you still need the migration:",
  );
  console.error("        npx drizzle-kit generate");
}

if (phantomEntries.length > 0 && orphanedFiles.length > 0) {
  console.error("");
  console.error("------------------------------------------------------------");
}

if (orphanedFiles.length > 0) {
  console.error(
    `  ${orphanedFiles.length} orphaned SQL ${orphanedFiles.length === 1 ? "file" : "files"} — ` +
      `SQL ${orphanedFiles.length === 1 ? "file" : "files"} on disk with no matching journal entry:`,
  );
  console.error("");
  for (const filename of orphanedFiles) {
    console.error(`    • migrations/${filename}`);
  }
  console.error("");
  console.error("  How to fix orphaned SQL files:");
  console.error(
    "    Option A — The file is a real migration that was never journalled:",
  );
  console.error(
    "      Delete the file and re-generate it so Drizzle adds a proper journal entry:",
  );
  console.error("        rm migrations/<filename>.sql");
  console.error("        npx drizzle-kit generate");
  console.error("");
  console.error(
    "    Option B — The file is a leftover / scratch file that is not needed:",
  );
  console.error("      Delete it:");
  console.error("        rm migrations/<filename>.sql");
}

console.error("============================================================");
console.error("");
process.exit(1);
