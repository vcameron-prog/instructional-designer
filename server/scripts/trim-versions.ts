/**
 * One-time migration script: trim content_versions rows that exceed the limit.
 *
 * The regular pruneOldVersions logic only fires on new writes, so any content
 * item that already had more than CONTENT_VERSION_KEEP_COUNT versions before
 * that logic was introduced will remain oversized until this script is run.
 *
 * Usage:
 *   tsx server/scripts/trim-versions.ts
 *
 * The keep count defaults to 10, matching the application default, but can be
 * overridden via the CONTENT_VERSION_KEEP_COUNT environment variable:
 *   CONTENT_VERSION_KEEP_COUNT=5 tsx server/scripts/trim-versions.ts
 */

import { trimAllOversizedVersions, resolveKeepCount } from "../lib/trimVersions.js";

const raw = process.env.CONTENT_VERSION_KEEP_COUNT;
if (raw !== undefined) {
  const parsed = parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(
      `Invalid CONTENT_VERSION_KEEP_COUNT="${raw}". ` +
        "Must be a positive integer (e.g. 10). Aborting.",
    );
    process.exit(1);
  }
}

async function main() {
  const keepCount = resolveKeepCount();
  console.log(`Starting version trim migration (keep_count=${keepCount})...`);
  await trimAllOversizedVersions();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
