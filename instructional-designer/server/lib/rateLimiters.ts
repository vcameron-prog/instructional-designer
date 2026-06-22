/**
 * Rate-limiter functions extracted from routes.ts so they can be unit-tested
 * directly without an HTTP stack.
 *
 * SHARED (DB-backed, cross-instance):
 *   checkSharedRateLimit  – primary limiter for all users; uses the
 *                           rate_limit_log PostgreSQL table with an advisory
 *                           lock to guarantee atomicity.
 *
 * PROCESS-LOCAL (in-memory fallbacks):
 *   checkAnonRateLimit    – anonymous request fallback
 *   checkAiGenRateLimit   – AI generation fallback
 *   checkUploadRateLimit  – file upload fallback
 *   checkHeavyOpRateLimit – heavy operation fallback
 *
 * Each process-local limiter also exports its backing Map so tests can inspect
 * or reset internal state without going through HTTP routes.
 */

export { checkSharedRateLimit } from "./shared-rate-limit.js";
import { cleanupRateLimitLog } from "./shared-rate-limit.js";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { appMetrics } from "@shared/schema";

// ---------------------------------------------------------------------------
// Shared (DB-backed) rate limiter constants
// ---------------------------------------------------------------------------

export const SHARED_ANON_UPLOAD_RATE_LIMIT =
  parseInt(process.env.ANON_DB_RATE_LIMIT ?? "10", 10) || 10;
export const SHARED_HEAVY_OP_RATE_LIMIT =
  parseInt(process.env.HEAVY_OP_RATE_LIMIT ?? "5", 10) || 5;

// Periodic cleanup — remove rows older than RATE_LIMIT_LOG_TTL_HOURS (default 2)
// so the table does not grow without bound.
// Interval is controlled by RATE_LIMIT_CLEANUP_INTERVAL_MINUTES (default 15).
// On multi-instance deployments a PostgreSQL advisory lock ensures only one
// instance performs the delete on each cycle; the others skip silently.
// Delegates to cleanupRateLimitLog (shared-rate-limit.ts) so the deletion
// predicate is exercised in automated tests independently of this module.
const RATE_LIMIT_LOG_TTL_HOURS =
  parseFloat(process.env.RATE_LIMIT_LOG_TTL_HOURS ?? "2") || 2;
const RATE_LIMIT_CLEANUP_INTERVAL_MINUTES =
  parseFloat(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MINUTES ?? "15") || 15;

// Stable advisory lock key (arbitrary constant, crc32-inspired, fits int4).
const RATE_LIMIT_CLEANUP_LOCK_KEY = 0x7a3f1c2d;

// ---------------------------------------------------------------------------
// Observable metrics for the cleanup interval
// Exposed via GET /api/metrics as rateLimitCleanup.*
// In-memory state is seeded from DB on startup via initRateLimitCleanupMetrics().
// ---------------------------------------------------------------------------
let _cleanupLastRunAt: string | null = null;
let _cleanupLastErrorAt: string | null = null;
let _cleanupRowsDeletedTotal = 0;

// DB row keys used in the app_metrics table.
// Exported so tests can reference the canonical values instead of repeating
// the string literals — a rename in source will cause a compile-time mismatch.
export const CLEANUP_METRIC_KEYS = {
  lastRunAt: "rateLimitCleanup.lastRunAt",
  lastErrorAt: "rateLimitCleanup.lastErrorAt",
  rowsDeleted: "rateLimitCleanup.rowsDeleted",
} as const;

const CLEANUP_LAST_RUN_KEY = CLEANUP_METRIC_KEYS.lastRunAt;
const CLEANUP_LAST_ERROR_KEY = CLEANUP_METRIC_KEYS.lastErrorAt;
const CLEANUP_ROWS_DELETED_KEY = CLEANUP_METRIC_KEYS.rowsDeleted;

export function getRateLimitCleanupMetrics(): {
  lastRunAt: string | null;
  lastErrorAt: string | null;
  rowsDeletedTotal: number;
} {
  return {
    lastRunAt: _cleanupLastRunAt,
    lastErrorAt: _cleanupLastErrorAt,
    rowsDeletedTotal: _cleanupRowsDeletedTotal,
  };
}

/**
 * Reset in-memory cleanup counters to their initial (zero) state.
 *
 * This is intentionally exported only for use in automated tests that need
 * to simulate a process restart before calling initRateLimitCleanupMetrics.
 * Do NOT call this in production code.
 */
export function _resetCleanupMetricsForTest(): void {
  _cleanupLastRunAt = null;
  _cleanupLastErrorAt = null;
  _cleanupRowsDeletedTotal = 0;
}

/**
 * Seed in-memory cleanup counters from the DB on server startup so metrics
 * survive process restarts and deployments.
 */
export async function initRateLimitCleanupMetrics(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(appMetrics)
      .where(
        sql`${appMetrics.key} IN (${CLEANUP_LAST_RUN_KEY}, ${CLEANUP_LAST_ERROR_KEY}, ${CLEANUP_ROWS_DELETED_KEY})`,
      );
    for (const row of rows) {
      if (row.key === CLEANUP_LAST_RUN_KEY) {
        _cleanupLastRunAt = row.lastAt ? row.lastAt.toISOString() : null;
      } else if (row.key === CLEANUP_LAST_ERROR_KEY) {
        _cleanupLastErrorAt = row.lastAt ? row.lastAt.toISOString() : null;
      } else if (row.key === CLEANUP_ROWS_DELETED_KEY) {
        _cleanupRowsDeletedTotal = row.count;
      }
    }
  } catch (err) {
    console.warn("[rateLimiters] Failed to seed cleanup metrics from DB, starting from zero:", err);
  }
}

async function persistCleanupRun(nowIso: string, newTotal: number): Promise<void> {
  try {
    const now = new Date(nowIso);
    await db
      .insert(appMetrics)
      .values({ key: CLEANUP_LAST_RUN_KEY, count: 0, lastAt: now })
      .onConflictDoUpdate({
        target: appMetrics.key,
        set: { lastAt: now },
      });
    await db
      .insert(appMetrics)
      .values({ key: CLEANUP_ROWS_DELETED_KEY, count: newTotal, lastAt: null })
      .onConflictDoUpdate({
        target: appMetrics.key,
        set: { count: newTotal },
      });
  } catch (err) {
    console.warn("[rateLimiters] Failed to persist cleanup run metrics to DB:", err);
  }
}

async function persistCleanupError(nowIso: string): Promise<void> {
  try {
    const now = new Date(nowIso);
    await db
      .insert(appMetrics)
      .values({ key: CLEANUP_LAST_ERROR_KEY, count: 0, lastAt: now })
      .onConflictDoUpdate({
        target: appMetrics.key,
        set: { lastAt: now },
      });
  } catch (err) {
    console.warn("[rateLimiters] Failed to persist cleanup error metric to DB:", err);
  }
}

export async function sharedRateLimitCleanupCallback(): Promise<void> {
  try {
    // Try to acquire a non-blocking session-level advisory lock.
    // Returns true if this instance won; false if another holds it.
    const lockResult = await db.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_lock(${RATE_LIMIT_CLEANUP_LOCK_KEY}) AS acquired`,
    );
    const acquired = lockResult.rows?.[0]?.acquired ?? true;
    if (!acquired) return; // Another instance is handling cleanup this cycle.

    try {
      const ttlMs = RATE_LIMIT_LOG_TTL_HOURS * 60 * 60 * 1000;
      const deleted = await cleanupRateLimitLog(ttlMs);
      _cleanupLastRunAt = new Date().toISOString();
      _cleanupRowsDeletedTotal += deleted;
      await persistCleanupRun(_cleanupLastRunAt, _cleanupRowsDeletedTotal);
    } finally {
      // Always release so the next cycle is contested fairly.
      await db.execute(
        sql`SELECT pg_advisory_unlock(${RATE_LIMIT_CLEANUP_LOCK_KEY})`,
      );
    }
  } catch (err) {
    _cleanupLastErrorAt = new Date().toISOString();
    await persistCleanupError(_cleanupLastErrorAt);
    // Non-critical; next interval will retry.
  }
}

export const sharedRateLimitCleanupInterval = setInterval(
  sharedRateLimitCleanupCallback,
  RATE_LIMIT_CLEANUP_INTERVAL_MINUTES * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Process-local in-memory limiters (DB-unavailable fallbacks)
// ---------------------------------------------------------------------------

// Anonymous request limiter
export const anonRateLimits = new Map<string, { count: number; resetAt: number }>();
export const ANON_RATE_LIMIT = 10;
export const ANON_RATE_WINDOW_MS = 60 * 60 * 1000;

export function checkAnonRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = anonRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    anonRateLimits.set(ip, { count: 1, resetAt: now + ANON_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= ANON_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export function anonRateLimitCleanupCallback(): void {
  const now = Date.now();
  for (const [ip, entry] of anonRateLimits) {
    if (now > entry.resetAt) anonRateLimits.delete(ip);
  }
}

export const anonRateLimitCleanupInterval = setInterval(
  anonRateLimitCleanupCallback,
  10 * 60 * 1000,
);

// Heavy-operation limiter
export const heavyOpRateLimits = new Map<string, { count: number; resetAt: number }>();
export const HEAVY_OP_RATE_LIMIT = parseInt(process.env.HEAVY_OP_RATE_LIMIT ?? "5", 10) || 5;
export const HEAVY_OP_RATE_WINDOW_MS = 60 * 60 * 1000;

export function checkHeavyOpRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = heavyOpRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    heavyOpRateLimits.set(key, { count: 1, resetAt: now + HEAVY_OP_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= HEAVY_OP_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export function heavyOpRateLimitCleanupCallback(): void {
  const now = Date.now();
  for (const [key, entry] of heavyOpRateLimits) {
    if (now > entry.resetAt) heavyOpRateLimits.delete(key);
  }
}

export const heavyOpRateLimitCleanupInterval = setInterval(
  heavyOpRateLimitCleanupCallback,
  10 * 60 * 1000,
);

// AI generation limiter
export const aiGenRateLimits = new Map<string, { count: number; resetAt: number }>();
export const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
export const AI_GEN_RATE_WINDOW_MS = 60 * 60 * 1000;

export function checkAiGenRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = aiGenRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    aiGenRateLimits.set(key, { count: 1, resetAt: now + AI_GEN_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= AI_GEN_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export function aiGenRateLimitCleanupCallback(): void {
  const now = Date.now();
  for (const [key, entry] of aiGenRateLimits) {
    if (now > entry.resetAt) aiGenRateLimits.delete(key);
  }
}

export const aiGenRateLimitCleanupInterval = setInterval(
  aiGenRateLimitCleanupCallback,
  10 * 60 * 1000,
);

// Upload limiter
export const uploadRateLimits = new Map<string, { count: number; resetAt: number }>();
export const UPLOAD_RATE_LIMIT = parseInt(process.env.UPLOAD_RATE_LIMIT ?? "30", 10) || 30;
export const UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;

export function checkUploadRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = uploadRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    uploadRateLimits.set(key, { count: 1, resetAt: now + UPLOAD_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= UPLOAD_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export function uploadRateLimitCleanupCallback(): void {
  const now = Date.now();
  for (const [key, entry] of uploadRateLimits) {
    if (now > entry.resetAt) uploadRateLimits.delete(key);
  }
}

export const uploadRateLimitCleanupInterval = setInterval(
  uploadRateLimitCleanupCallback,
  10 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Graceful-shutdown helper
// ---------------------------------------------------------------------------

/**
 * Clear all five rate-limiter `setInterval` handles.
 *
 * Call this from the process SIGTERM / SIGINT handler so the callbacks do not
 * fire one final time against a partially-torn-down database connection, and
 * so integration-test runs can clean up their timer state cleanly.
 */
export function clearRateLimiterIntervals(): void {
  clearInterval(sharedRateLimitCleanupInterval);
  clearInterval(anonRateLimitCleanupInterval);
  clearInterval(heavyOpRateLimitCleanupInterval);
  clearInterval(aiGenRateLimitCleanupInterval);
  clearInterval(uploadRateLimitCleanupInterval);
}
