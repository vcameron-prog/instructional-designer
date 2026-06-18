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

import { db } from "../db";
import { rateLimitLog } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Shared (DB-backed) rate limiter
// ---------------------------------------------------------------------------

export const SHARED_ANON_UPLOAD_RATE_LIMIT =
  parseInt(process.env.ANON_DB_RATE_LIMIT ?? "10", 10) || 10;
export const SHARED_HEAVY_OP_RATE_LIMIT =
  parseInt(process.env.HEAVY_OP_RATE_LIMIT ?? "5", 10) || 5;

/**
 * Check (and record) a rate-limit event in the shared PostgreSQL table.
 *
 * ATOMICITY: A pg_advisory_xact_lock is acquired at the start of each
 * transaction so that count-read + insert is atomic for the same (key, action)
 * pair — preventing the classic TOCTOU race under concurrent requests.
 *
 * ERROR HANDLING: On DB failure the caller-supplied `fallbackFn` is invoked.
 * If no fallback is provided the check fails CLOSED (denies the request).
 *
 * IMPORTANT: callers MUST use ensureVisitorToken() (not getVisitorToken()) so
 * that a sticky token is always assigned before the check — preventing bypass
 * via cookie rotation.
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

// Periodic cleanup — remove rows older than 2 hours so the table does not
// grow without bound.  Runs every 15 minutes.
export const sharedRateLimitCleanupInterval = setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.delete(rateLimitLog).where(sql`${rateLimitLog.createdAt} < ${cutoff}`);
  } catch {
    // Non-critical; next interval will retry.
  }
}, 15 * 60 * 1000);

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

export const anonRateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of anonRateLimits) {
    if (now > entry.resetAt) anonRateLimits.delete(ip);
  }
}, 10 * 60 * 1000);

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

export const heavyOpRateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of heavyOpRateLimits) {
    if (now > entry.resetAt) heavyOpRateLimits.delete(key);
  }
}, 10 * 60 * 1000);

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

export const aiGenRateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of aiGenRateLimits) {
    if (now > entry.resetAt) aiGenRateLimits.delete(key);
  }
}, 10 * 60 * 1000);

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

export const uploadRateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of uploadRateLimits) {
    if (now > entry.resetAt) uploadRateLimits.delete(key);
  }
}, 10 * 60 * 1000);
