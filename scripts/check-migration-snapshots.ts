#!/usr/bin/env tsx
/**
 * check-migration-snapshots.ts
 *
 * Verifies that every entry in migrations/meta/_journal.json has a
 * corresponding snapshot file (migrations/meta/<idx>_snapshot.json).
 *
 * Drizzle-kit uses these snapshot files to track the schema state after each
 * migration.  When a snapshot is absent, drizzle-kit silently skips that
 * migration during `db:migrate`, which can leave the database schema
 * incomplete without any visible error.  This script detects that gap at
 * PR / CI time rather than at runtime.
 *
 * This check is intentionally pure filesystem reads — no database connection
 * is required, so it runs fast and can be used as an early gate in both the
 * migration-journal CI workflow and the pre-start deploy gate.
 *
 * Usage:
 *   npx tsx scripts/check-migration-snapshots.ts
 *
 * Exit codes:
 *   0 — all journal entries have a matching snapshot file
 *   1 — one or more snapshot files are missing, or the journal cannot be read
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
const metaDir = path.join(projectRoot, "migrations", "meta");
const journalPath = path.join(metaDir, "_journal.json");

export interface SnapshotCheckResult {
  missing: Array<{ idx: number; tag: string; expectedFile: string }>;
  checked: number;
}

/**
 * Scans migrations/meta/ and returns any journal entries whose snapshot
 * JSON file is absent.  This function can be imported and called directly,
 * or the script can be executed as a CLI tool.
 */
export function checkMigrationSnapshots(): SnapshotCheckResult {
  if (!fs.existsSync(journalPath)) {
    console.error(
      `[check-snapshots] ERROR: Journal not found at ${journalPath}`,
    );
    console.error(
      "Make sure you are running this script from the project root.",
    );
    process.exit(1);
  }

  let journal: Journal;
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as Journal;
  } catch (err) {
    console.error(
      `[check-snapshots] ERROR: Could not parse journal at ${journalPath}`,
    );
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!Array.isArray(journal.entries)) {
    console.error(
      `[check-snapshots] ERROR: Journal has no "entries" array — file may be corrupt.`,
    );
    process.exit(1);
  }

  const missing: SnapshotCheckResult["missing"] = [];

  for (const entry of journal.entries) {
    const paddedIdx = String(entry.idx).padStart(4, "0");
    const snapshotFile = `${paddedIdx}_snapshot.json`;
    const snapshotPath = path.join(metaDir, snapshotFile);

    if (!fs.existsSync(snapshotPath)) {
      missing.push({ idx: entry.idx, tag: entry.tag, expectedFile: snapshotFile });
    }
  }

  return { missing, checked: journal.entries.length };
}

// ---- CLI entry-point (only runs when executed directly, not when imported) ---

// Detect whether this module is the Node.js entry point.  When the file is
// imported by another script (e.g. assert-migrations-applied.ts) the CLI block
// is skipped so the importer's process.exit() calls are not shadowed.
function resolvedPath(p: string): string {
  return p.startsWith("/") ? p : new URL(`file://${process.cwd()}/${p}`).pathname;
}

const isMain =
  Boolean(process.argv[1]) &&
  new URL(import.meta.url).pathname === resolvedPath(process.argv[1]);

if (isMain) {
  const result = checkMigrationSnapshots();

  if (result.missing.length === 0) {
    console.log(
      `✓ Migration snapshots OK — all ${result.checked} ${result.checked === 1 ? "entry" : "entries"} ` +
        `have a matching snapshot file in migrations/meta/.`,
    );
    process.exit(0);
  }

  console.error("");
  console.error("============================================================");
  console.error("  MISSING MIGRATION SNAPSHOT FILES");
  console.error("============================================================");
  console.error(
    `  ${result.missing.length} journal ${result.missing.length === 1 ? "entry" : "entries"} ` +
      `${result.missing.length === 1 ? "is" : "are"} missing a snapshot file in migrations/meta/:`,
  );
  console.error("");

  for (const item of result.missing) {
    console.error(
      `    • migrations/meta/${item.expectedFile}   (journal idx ${item.idx} — tag: ${item.tag})`,
    );
  }

  console.error("");
  console.error(
    "  Drizzle-kit silently skips migrations whose snapshot files are absent,",
  );
  console.error(
    "  which can leave the database schema incomplete without any visible error.",
  );
  console.error("");
  console.error("  How to fix:");
  console.error(
    "    Option A — The snapshot was accidentally deleted or never committed:",
  );
  console.error(
    "      Restore it from git or re-generate it by running drizzle-kit:",
  );
  console.error(`        git checkout HEAD -- migrations/meta/<file>`);
  console.error(
    "        # or, if no prior snapshot exists, re-run: npx drizzle-kit generate",
  );
  console.error("");
  console.error(
    "    Option B — The migration was hand-authored without running drizzle-kit generate:",
  );
  console.error(
    "      Re-create the snapshot by checking out the schema state at that",
  );
  console.error(
    "      migration and running: npx drizzle-kit generate",
  );
  console.error("============================================================");
  console.error("");
  process.exit(1);
}
