import { db } from "../db.js";
import { contentVersions } from "../../shared/schema.js";
import { eq, desc, and, notInArray, sql } from "drizzle-orm";

const DEFAULT_VERSION_KEEP_COUNT = 10;

export function resolveKeepCount(): number {
  const raw = parseInt(process.env.CONTENT_VERSION_KEEP_COUNT ?? "", 10);
  if (Number.isInteger(raw) && raw >= 1) return raw;
  return DEFAULT_VERSION_KEEP_COUNT;
}

function startupLog(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [startup] ${message}`);
}

export async function trimAllOversizedVersions(): Promise<void> {
  const keepCount = resolveKeepCount();

  const oversized = await db
    .select({
      contentId: contentVersions.generatedContentId,
      total: sql<number>`count(*)::int`,
    })
    .from(contentVersions)
    .groupBy(contentVersions.generatedContentId)
    .having(sql`count(*) > ${keepCount}`);

  if (oversized.length === 0) {
    startupLog(`Version trim: all content items are within the ${keepCount}-version limit.`);
    return;
  }

  startupLog(
    `Version trim: ${oversized.length} content item(s) exceed the ${keepCount}-version limit. Trimming...`,
  );

  let totalDeleted = 0;

  for (const { contentId, total } of oversized) {
    const toKeep = await db
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .where(eq(contentVersions.generatedContentId, contentId))
      .orderBy(desc(contentVersions.createdAt))
      .limit(keepCount);

    const keepIds = toKeep.map((v) => v.id);

    await db
      .delete(contentVersions)
      .where(
        and(
          eq(contentVersions.generatedContentId, contentId),
          notInArray(contentVersions.id, keepIds),
        ),
      );

    const deleted = total - keepCount;
    totalDeleted += deleted;
  }

  startupLog(`Version trim: deleted ${totalDeleted} excess version row(s).`);
}
