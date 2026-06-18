import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { rateLimitLog } from "@shared/schema";

/**
 * DB-backed, cross-instance rate limiter using PostgreSQL advisory locks.
 *
 * Each call opens a transaction, acquires an exclusive advisory lock keyed on
 * `hashtext("${key}:${action}")`, reads the current count of rows in the
 * window, and — if below the limit — inserts a new row.  The lock ensures
 * that concurrent transactions for the same (key, action) pair are
 * serialized, preventing a race condition where two simultaneous requests
 * both read count = limit-1, both pass the check, and both insert.
 *
 * @param key       Rate-limit key (userId, IP, visitor token, etc.)
 * @param action    Action name ("ai-gen", "upload", …)
 * @param limit     Maximum allowed events within the window.
 * @param windowMs  Sliding window duration in milliseconds.
 * @param fallbackFn Optional process-local fallback invoked on DB errors.
 *                   If omitted the function fails CLOSED (returns false).
 * @returns true if the request is allowed, false if it should be denied.
 */
export async function checkSharedRateLimit(
  key: string,
  action: string,
  limit: number,
  windowMs: number,
  fallbackFn?: () => boolean,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMs);
  const lockKeyStr = `${key}:${action}`;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKeyStr}))`);

      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimitLog)
        .where(
          and(
            eq(rateLimitLog.key, key),
            eq(rateLimitLog.action, action),
            sql`${rateLimitLog.createdAt} >= ${windowStart}`,
          ),
        );

      if (n >= limit) return false;

      await tx.insert(rateLimitLog).values({ key, action });
      return true;
    });
  } catch {
    if (fallbackFn) return fallbackFn();
    return false;
  }
}
