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

import { db } from "../db.js";
import { contentVersions } from "../../shared/schema.js";
import { eq, desc, and, notInArray, sql } from "drizzle-orm";

const rawKeepCount = parseInt(process.env.CONTENT_VERSION_KEEP_COUNT ?? "10", 10);

if (!Number.isInteger(rawKeepCount) || rawKeepCount < 1) {
  console.error(
    `Invalid CONTENT_VERSION_KEEP_COUNT="${process.env.CONTENT_VERSION_KEEP_COUNT}". ` +
      "Must be a positive integer (e.g. 10). Aborting.",
  );
  process.exit(1);
}

const KEEP_COUNT = rawKeepCount;

async function main() {
  console.log(`Starting version trim migration (keep_count=${KEEP_COUNT})...`);

  const oversized = await db
    .select({
      contentId: contentVersions.generatedContentId,
      total: sql<number>`count(*)::int`,
    })
    .from(contentVersions)
    .groupBy(contentVersions.generatedContentId)
    .having(sql`count(*) > ${KEEP_COUNT}`);

  if (oversized.length === 0) {
    console.log("No content items exceed the version limit. Nothing to do.");
    process.exit(0);
  }

  console.log(
    `Found ${oversized.length} content item(s) with more than ${KEEP_COUNT} versions.`,
  );

  let totalDeleted = 0;

  for (const { contentId, total } of oversized) {
    const toKeep = await db
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .where(eq(contentVersions.generatedContentId, contentId))
      .orderBy(desc(contentVersions.createdAt))
      .limit(KEEP_COUNT);

    const keepIds = toKeep.map((v) => v.id);

    await db
      .delete(contentVersions)
      .where(
        and(
          eq(contentVersions.generatedContentId, contentId),
          notInArray(contentVersions.id, keepIds),
        ),
      );

    const deleted = total - KEEP_COUNT;
    totalDeleted += deleted;
    console.log(
      `  content_id=${contentId}: had ${total}, deleted ${deleted}, kept ${KEEP_COUNT}`,
    );
  }

  console.log(`\nDone. Deleted ${totalDeleted} excess version row(s) in total.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
