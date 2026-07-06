/**
 * Observability for the /api/tools/alt-text route's JSON confidence parsing.
 *
 * When Claude's response for alt-text generation fails to parse as the
 * expected {altText, confidence} JSON shape, the route falls back to a
 * single stricter-prompt retry (mirroring the existing fixComplianceIssue
 * retry pattern). If parsing still fails after the retry, the route drops
 * the confidence field and treats the raw response as the alt text.
 *
 * This module tracks how often that final fallback is hit so degraded
 * confidence coverage is observable in production, following the same
 * in-memory + DB-backed (app_metrics table) pattern used by
 * rateLimiters.ts for rateLimitCleanup.* metrics.
 */
import { db } from "../db";
import { appMetrics } from "@shared/schema";
import { sql } from "drizzle-orm";

// A single app_metrics row ("altTextParseFail.count") carries both the count
// and its own lastAt column — there is no separate lastAt key/row.
export const ALT_TEXT_METRIC_KEYS = {
  parseFailCount: "altTextParseFail.count",
} as const;

let _parseFailCount = 0;
let _parseFailLastAt: string | null = null;

export function getAltTextParseFailMetrics(): {
  count: number;
  lastAt: string | null;
} {
  return { count: _parseFailCount, lastAt: _parseFailLastAt };
}

/**
 * Reset in-memory counters to their initial (zero) state.
 *
 * Intentionally exported only for use in automated tests that need to
 * simulate a process restart before calling initAltTextParseFailMetrics.
 * Do NOT call this in production code.
 */
export function _resetAltTextParseFailMetricsForTest(): void {
  _parseFailCount = 0;
  _parseFailLastAt = null;
}

/**
 * Seed in-memory counters from the DB on server startup so metrics survive
 * process restarts and deployments.
 */
export async function initAltTextParseFailMetrics(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(appMetrics)
      .where(sql`${appMetrics.key} = ${ALT_TEXT_METRIC_KEYS.parseFailCount}`);
    for (const row of rows) {
      if (row.key === ALT_TEXT_METRIC_KEYS.parseFailCount) {
        _parseFailCount = row.count;
        _parseFailLastAt = row.lastAt ? row.lastAt.toISOString() : null;
      }
    }
  } catch (err) {
    console.warn(
      "[altTextMetrics] Failed to seed parse-fail metrics from DB, starting from zero:",
      err,
    );
  }
}

/**
 * Record a single alt-text JSON confidence parse failure (after the retry
 * has already been attempted and also failed). Increments the in-memory
 * counter immediately and best-effort persists to the DB so the count
 * survives restarts; DB failures are logged but never block the request.
 */
export async function recordAltTextParseFail(): Promise<void> {
  _parseFailCount += 1;
  const now = new Date();
  _parseFailLastAt = now.toISOString();

  console.warn(
    `[alt-text] Failed to parse AI JSON confidence response after retry (fallback #${_parseFailCount}). Confidence field dropped.`,
  );

  try {
    await db
      .insert(appMetrics)
      .values({ key: ALT_TEXT_METRIC_KEYS.parseFailCount, count: _parseFailCount, lastAt: now })
      .onConflictDoUpdate({
        target: appMetrics.key,
        set: { count: _parseFailCount, lastAt: now },
      });
  } catch (err) {
    // In-memory counters above are already updated; only DB persistence
    // (and therefore cross-restart durability) is affected by this failure.
    console.warn("[altTextMetrics] Failed to persist parse-fail metric to DB:", err);
  }
}
