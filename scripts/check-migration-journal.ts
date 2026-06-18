#!/usr/bin/env tsx
/**
 * check-migration-journal.ts
 *
 * Validates that every entry in migrations/meta/_journal.json has a
 * corresponding .sql file on disk.  Exits with a non-zero code (and a clear,
 * actionable error message) if any entry is missing its file so the problem
 * is caught in CI / pre-commit rather than at runtime.
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

const phantomEntries = journal.entries.filter(
  (entry) => !fs.existsSync(path.join(migrationsDir, `${entry.tag}.sql`)),
);

if (phantomEntries.length === 0) {
  const total = journal.entries.length;
  console.log(
    `✓ Migration journal OK — all ${total} ${total === 1 ? "entry" : "entries"} have a matching SQL file.`,
  );
  process.exit(0);
}

console.error("");
console.error("============================================================");
console.error("  MIGRATION JOURNAL ERROR");
console.error("============================================================");
console.error(
  `  ${phantomEntries.length} journal ${phantomEntries.length === 1 ? "entry" : "entries"} ` +
    `${phantomEntries.length === 1 ? "has" : "have"} no matching SQL file on disk:`,
);
console.error("");
for (const entry of phantomEntries) {
  console.error(
    `    • migrations/${entry.tag}.sql   (journal idx ${entry.idx})`,
  );
}
console.error("");
console.error("  How to fix:");
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
console.error("============================================================");
console.error("");
process.exit(1);
