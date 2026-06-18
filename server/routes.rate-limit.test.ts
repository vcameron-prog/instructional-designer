/**
 * Direct unit tests for the rate-limiter functions in server/lib/rateLimiters.ts.
 *
 * These tests call the exported functions directly — no HTTP, no Express, no
 * Anthropic, and no storage mock required.  The only external dependency is
 * `db` (for checkSharedRateLimit), which is mocked below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockDbTransaction, mockDbDelete, mockDbExecute } = vi.hoisted(() => ({
  mockDbTransaction: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbExecute: vi.fn(),
}));

// Mock the db singleton used by checkSharedRateLimit.
vi.mock("./db", () => ({
  db: {
    transaction: mockDbTransaction,
    delete: mockDbDelete,
    execute: mockDbExecute,
  },
}));

// rateLimiters.ts imports from @shared/schema — provide a minimal stub so the
// module resolves without a live database connection.
vi.mock("@shared/schema", () => ({
  rateLimitLog: { key: "key", action: "action", createdAt: "createdAt" },
  insertCourseSchema: {},
  courses: {},
  conversions: {},
  generatedContent: {},
  contentVersions: {},
}));

// ---------------------------------------------------------------------------
// Module under test – imported AFTER mocks are registered.
// ---------------------------------------------------------------------------
import {
  checkSharedRateLimit,
  checkAnonRateLimit,
  checkAiGenRateLimit,
  checkUploadRateLimit,
  checkHeavyOpRateLimit,
  anonRateLimits,
  aiGenRateLimits,
  uploadRateLimits,
  heavyOpRateLimits,
  AI_GEN_RATE_LIMIT,
  ANON_RATE_LIMIT,
  UPLOAD_RATE_LIMIT,
  HEAVY_OP_RATE_LIMIT,
  anonRateLimitCleanupCallback,
  aiGenRateLimitCleanupCallback,
  uploadRateLimitCleanupCallback,
  heavyOpRateLimitCleanupCallback,
  sharedRateLimitCleanupCallback,
  clearRateLimiterIntervals,
  sharedRateLimitCleanupInterval,
  anonRateLimitCleanupInterval,
  heavyOpRateLimitCleanupInterval,
  aiGenRateLimitCleanupInterval,
  uploadRateLimitCleanupInterval,
} from "./lib/rateLimiters.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a stateful mock for db.transaction that simulates the rate_limit_log
 * table.  The mock serialises all calls through a single shared counter so
 * sequential requests correctly accumulate toward the limit.
 *
 * The returned `capturedLockSqlJson` array is filled with
 * `JSON.stringify(sqlObj)` for every call to `tx.execute()`, so tests can
 * assert that `pg_advisory_xact_lock` is present even when the SQL object is
 * a Drizzle template (not a plain string).
 */
function makeStatefulTransactionMock(initialCount: number) {
  let count = initialCount;
  const capturedLockSqlJson: string[] = [];

  const transactionMock = vi.fn().mockImplementation(
    async (callback: (tx: any) => Promise<any>) => {
      const tx = {
        execute: vi.fn().mockImplementation(async (sqlObj: any) => {
          capturedLockSqlJson.push(JSON.stringify(sqlObj));
          return undefined;
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(async () => [{ n: count }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation(async () => {
            count++;
            return undefined;
          }),
        }),
      };
      return callback(tx);
    },
  );

  return { transactionMock, capturedLockSqlJson, getCount: () => count };
}

/** Generate a unique key to avoid cross-test in-memory bucket pollution. */
let keyCounter = 0;
function freshKey(prefix = "test"): string {
  return `${prefix}-${++keyCounter}`;
}

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – limit enforcement
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – limit enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("allows requests when the count is below the limit", async () => {
    const { transactionMock } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    const allowed = await checkSharedRateLimit("user-a", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(allowed).toBe(true);
  });

  it("allows the exact limit-th request when count equals limit minus one", async () => {
    const { transactionMock } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT - 1);
    mockDbTransaction.mockImplementation(transactionMock);

    const allowed = await checkSharedRateLimit("user-b", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(allowed).toBe(true);
  });

  it("returns false when the count has already reached the limit", async () => {
    const { transactionMock } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT);
    mockDbTransaction.mockImplementation(transactionMock);

    const allowed = await checkSharedRateLimit("user-c", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(allowed).toBe(false);
  });

  it("returns false when the count exceeds the limit", async () => {
    const { transactionMock } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT + 5);
    mockDbTransaction.mockImplementation(transactionMock);

    const allowed = await checkSharedRateLimit("user-d", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(allowed).toBe(false);
  });

  it("increments the stored count on each allowed request", async () => {
    const { transactionMock, getCount } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    await checkSharedRateLimit("user-e", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(getCount()).toBe(1);

    await checkSharedRateLimit("user-e", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(getCount()).toBe(2);
  });

  it("enforces the limit sequentially: N successful calls then denied", async () => {
    let count = 0;
    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const snapshot = count;
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: snapshot }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => { count++; }),
          }),
        };
        return callback(tx);
      },
    );

    for (let i = 0; i < AI_GEN_RATE_LIMIT; i++) {
      const result = await checkSharedRateLimit("user-seq", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
      expect(result).toBe(true);
    }

    const overLimit = await checkSharedRateLimit("user-seq", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(overLimit).toBe(false);
  });

  it("does NOT insert a new row when the limit is already reached", async () => {
    let insertCallCount = 0;
    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: AI_GEN_RATE_LIMIT }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => { insertCallCount++; }),
          }),
        };
        return callback(tx);
      },
    );

    await checkSharedRateLimit("user-nins", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(insertCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – advisory lock is always acquired
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – advisory lock is acquired on every transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("calls pg_advisory_xact_lock for every allowed request", async () => {
    const { transactionMock, capturedLockSqlJson } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    await checkSharedRateLimit("user-lock1", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    await checkSharedRateLimit("user-lock1", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);

    expect(capturedLockSqlJson.length).toBeGreaterThanOrEqual(2);
    for (const json of capturedLockSqlJson) {
      expect(json).toContain("pg_advisory_xact_lock");
    }
  });

  it("calls pg_advisory_xact_lock even when the limit has been reached", async () => {
    const { transactionMock, capturedLockSqlJson } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT);
    mockDbTransaction.mockImplementation(transactionMock);

    await checkSharedRateLimit("user-lock2", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);

    expect(capturedLockSqlJson.length).toBeGreaterThanOrEqual(1);
    expect(capturedLockSqlJson[0]).toContain("pg_advisory_xact_lock");
  });

  it("includes the composite key (userId:action) in the advisory lock SQL", async () => {
    const userId = freshKey("lockuser");
    const { transactionMock, capturedLockSqlJson } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    await checkSharedRateLimit(userId, "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);

    expect(capturedLockSqlJson.length).toBeGreaterThanOrEqual(1);
    const json = capturedLockSqlJson[0];
    expect(json).toContain(userId);
    expect(json).toContain("ai-gen");
  });

  it("uses a different advisory lock key for upload actions vs ai-gen actions", async () => {
    const userId = freshKey("lockdiff");
    const lockKeys: string[] = [];
    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockImplementation(async (sqlObj: any) => {
            lockKeys.push(JSON.stringify(sqlObj));
            return undefined;
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: 0 }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(tx);
      },
    );

    await checkSharedRateLimit(userId, "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    await checkSharedRateLimit(userId, "upload", UPLOAD_RATE_LIMIT, 3600_000);

    const aiGenLocks = lockKeys.filter((k) => k.includes("ai-gen"));
    const uploadLocks = lockKeys.filter((k) => k.includes("upload"));
    expect(aiGenLocks.length).toBeGreaterThanOrEqual(1);
    expect(uploadLocks.length).toBeGreaterThanOrEqual(1);
    expect(aiGenLocks[0]).not.toBe(uploadLocks[0]);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – advisory lock precedes the count SELECT
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – advisory lock precedes the count SELECT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("executes execute() before select() inside the transaction callback", async () => {
    const callOrder: string[] = [];

    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockImplementation(async () => {
            callOrder.push("execute");
            return undefined;
          }),
          select: vi.fn().mockImplementation(() => {
            callOrder.push("select");
            return {
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ n: 0 }]),
              }),
            };
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(tx);
      },
    );

    await checkSharedRateLimit("user-order", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);

    expect(callOrder[0]).toBe("execute");
    expect(callOrder[1]).toBe("select");
  });

  it("only inserts when count < limit (count-check and insert share the same transaction)", async () => {
    const insertCalls: number[] = [];

    // First call: count = 0 → insert expected
    mockDbTransaction.mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: 0 }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => { insertCalls.push(1); }),
          }),
        };
        return callback(tx);
      },
    );

    // Second call: count = limit → no insert
    mockDbTransaction.mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: AI_GEN_RATE_LIMIT }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => { insertCalls.push(2); }),
          }),
        };
        return callback(tx);
      },
    );

    await checkSharedRateLimit("user-txn", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    await checkSharedRateLimit("user-txn", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);

    expect(insertCalls).toEqual([1]); // only the first (allowed) call inserted
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – DB error fallback
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – DB error falls back to the provided fallbackFn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbTransaction.mockRejectedValue(new Error("DB connection refused"));
  });

  it("invokes fallbackFn and returns its result when the DB throws", async () => {
    const fallback = vi.fn().mockReturnValue(true);
    const result = await checkSharedRateLimit("user-fb1", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000, fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it("returns false when no fallbackFn is provided and the DB throws (fail-closed)", async () => {
    const result = await checkSharedRateLimit("user-fb2", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(result).toBe(false);
  });

  it("returns false from fallbackFn when the fallback itself is exhausted", async () => {
    const fallback = vi.fn().mockReturnValue(false);
    const result = await checkSharedRateLimit("user-fb3", "ai-gen", AI_GEN_RATE_LIMIT, 3600_000, fallback);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – key isolation across users
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – different users are isolated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("denies user-A but allows user-B when user-A is at the limit", async () => {
    const userA = freshKey("isolationA");
    const userB = freshKey("isolationB");

    const capturedLockKeys: string[] = [];
    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        let lockKey = "";
        const tx = {
          execute: vi.fn().mockImplementation(async (sqlObj: any) => {
            lockKey = JSON.stringify(sqlObj);
            capturedLockKeys.push(lockKey);
            return undefined;
          }),
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(async () => {
                const isUserA = lockKey.includes(userA);
                return [{ n: isUserA ? AI_GEN_RATE_LIMIT : 0 }];
              }),
            }),
          })),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(tx);
      },
    );

    const resA = await checkSharedRateLimit(userA, "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(resA).toBe(false);

    const resB = await checkSharedRateLimit(userB, "ai-gen", AI_GEN_RATE_LIMIT, 3600_000);
    expect(resB).toBe(true);

    const aLocks = capturedLockKeys.filter((k) => k.includes(userA));
    const bLocks = capturedLockKeys.filter((k) => k.includes(userB));
    expect(aLocks.length).toBeGreaterThan(0);
    expect(bLocks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkAnonRateLimit – process-local in-memory limiter
// ---------------------------------------------------------------------------
describe("checkAnonRateLimit – in-memory per-IP anonymous limiter", () => {
  beforeEach(() => {
    anonRateLimits.clear();
  });

  it("allows the first request for a new IP", () => {
    expect(checkAnonRateLimit(freshKey("anon"))).toBe(true);
  });

  it("allows exactly ANON_RATE_LIMIT requests before returning false", () => {
    const ip = freshKey("anon");
    const results: boolean[] = [];
    for (let i = 0; i < ANON_RATE_LIMIT + 1; i++) {
      results.push(checkAnonRateLimit(ip));
    }
    expect(results.filter(Boolean)).toHaveLength(ANON_RATE_LIMIT);
    expect(results[results.length - 1]).toBe(false);
  });

  it("maintains separate buckets per IP", () => {
    const ip1 = freshKey("anon");
    const ip2 = freshKey("anon");

    for (let i = 0; i < ANON_RATE_LIMIT; i++) {
      checkAnonRateLimit(ip1);
    }
    expect(checkAnonRateLimit(ip1)).toBe(false);
    expect(checkAnonRateLimit(ip2)).toBe(true);
  });

  it("resets the bucket after the window has elapsed", () => {
    const ip = freshKey("anon");

    // Exhaust the bucket
    for (let i = 0; i < ANON_RATE_LIMIT; i++) {
      checkAnonRateLimit(ip);
    }
    expect(checkAnonRateLimit(ip)).toBe(false);

    // Force the bucket to expire by back-dating resetAt
    const entry = anonRateLimits.get(ip)!;
    entry.resetAt = Date.now() - 1;

    // Next call should reset and allow
    expect(checkAnonRateLimit(ip)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkAiGenRateLimit – process-local in-memory limiter
// ---------------------------------------------------------------------------
describe("checkAiGenRateLimit – in-memory per-user AI-gen rate limiter", () => {
  beforeEach(() => {
    aiGenRateLimits.clear();
  });

  it("allows the first request when the bucket is empty", () => {
    expect(checkAiGenRateLimit(freshKey("aigen"))).toBe(true);
  });

  it("allows exactly AI_GEN_RATE_LIMIT requests before returning false", () => {
    const key = freshKey("aigen");
    const results: boolean[] = [];
    for (let i = 0; i < AI_GEN_RATE_LIMIT + 1; i++) {
      results.push(checkAiGenRateLimit(key));
    }
    expect(results.filter(Boolean)).toHaveLength(AI_GEN_RATE_LIMIT);
    expect(results[results.length - 1]).toBe(false);
  });

  it("maintains separate buckets per key (fresh key gets full quota)", () => {
    const k1 = freshKey("aigen");
    const k2 = freshKey("aigen");

    for (let i = 0; i < AI_GEN_RATE_LIMIT; i++) {
      checkAiGenRateLimit(k1);
    }
    expect(checkAiGenRateLimit(k1)).toBe(false);
    expect(checkAiGenRateLimit(k2)).toBe(true);
  });

  it("resets the bucket after the window has elapsed", () => {
    const key = freshKey("aigen");

    for (let i = 0; i < AI_GEN_RATE_LIMIT; i++) {
      checkAiGenRateLimit(key);
    }
    expect(checkAiGenRateLimit(key)).toBe(false);

    const entry = aiGenRateLimits.get(key)!;
    entry.resetAt = Date.now() - 1;

    expect(checkAiGenRateLimit(key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkUploadRateLimit – process-local in-memory limiter
// ---------------------------------------------------------------------------
describe("checkUploadRateLimit – in-memory per-user upload rate limiter", () => {
  beforeEach(() => {
    uploadRateLimits.clear();
  });

  it("allows the first upload when the bucket is empty", () => {
    expect(checkUploadRateLimit(freshKey("upload"))).toBe(true);
  });

  it("allows exactly UPLOAD_RATE_LIMIT requests before returning false", () => {
    const key = freshKey("upload");
    const results: boolean[] = [];
    for (let i = 0; i < UPLOAD_RATE_LIMIT + 1; i++) {
      results.push(checkUploadRateLimit(key));
    }
    expect(results.filter(Boolean)).toHaveLength(UPLOAD_RATE_LIMIT);
    expect(results[results.length - 1]).toBe(false);
  });

  it("maintains separate buckets per key (fresh key gets full quota)", () => {
    const k1 = freshKey("upload");
    const k2 = freshKey("upload");

    for (let i = 0; i < UPLOAD_RATE_LIMIT; i++) {
      checkUploadRateLimit(k1);
    }
    expect(checkUploadRateLimit(k1)).toBe(false);
    expect(checkUploadRateLimit(k2)).toBe(true);
  });

  it("resets the bucket after the window has elapsed", () => {
    const key = freshKey("upload");

    for (let i = 0; i < UPLOAD_RATE_LIMIT; i++) {
      checkUploadRateLimit(key);
    }
    expect(checkUploadRateLimit(key)).toBe(false);

    const entry = uploadRateLimits.get(key)!;
    entry.resetAt = Date.now() - 1;

    expect(checkUploadRateLimit(key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkHeavyOpRateLimit – process-local in-memory limiter
// ---------------------------------------------------------------------------
describe("checkHeavyOpRateLimit – in-memory per-key heavy-operation rate limiter", () => {
  beforeEach(() => {
    heavyOpRateLimits.clear();
  });

  it("allows the first request when the bucket is empty", () => {
    expect(checkHeavyOpRateLimit(freshKey("heavy"))).toBe(true);
  });

  it("allows exactly HEAVY_OP_RATE_LIMIT requests before returning false", () => {
    const key = freshKey("heavy");
    const results: boolean[] = [];
    for (let i = 0; i < HEAVY_OP_RATE_LIMIT + 1; i++) {
      results.push(checkHeavyOpRateLimit(key));
    }
    expect(results.filter(Boolean)).toHaveLength(HEAVY_OP_RATE_LIMIT);
    expect(results[results.length - 1]).toBe(false);
  });

  it("maintains separate buckets per key", () => {
    const k1 = freshKey("heavy");
    const k2 = freshKey("heavy");

    for (let i = 0; i < HEAVY_OP_RATE_LIMIT; i++) {
      checkHeavyOpRateLimit(k1);
    }
    expect(checkHeavyOpRateLimit(k1)).toBe(false);
    expect(checkHeavyOpRateLimit(k2)).toBe(true);
  });

  it("resets the bucket after the window has elapsed", () => {
    const key = freshKey("heavy");

    for (let i = 0; i < HEAVY_OP_RATE_LIMIT; i++) {
      checkHeavyOpRateLimit(key);
    }
    expect(checkHeavyOpRateLimit(key)).toBe(false);

    const entry = heavyOpRateLimits.get(key)!;
    entry.resetAt = Date.now() - 1;

    expect(checkHeavyOpRateLimit(key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: in-memory cleanup callbacks (fake timers)
// ---------------------------------------------------------------------------

describe("anonRateLimitCleanupCallback – prunes stale entries, keeps fresh ones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    anonRateLimits.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes entries whose resetAt is in the past", () => {
    const staleKey = freshKey("anon-stale");
    anonRateLimits.set(staleKey, { count: 3, resetAt: Date.now() - 1 });

    anonRateLimitCleanupCallback();

    expect(anonRateLimits.has(staleKey)).toBe(false);
  });

  it("keeps entries whose resetAt is in the future", () => {
    const freshIp = freshKey("anon-fresh");
    anonRateLimits.set(freshIp, { count: 1, resetAt: Date.now() + 60_000 });

    anonRateLimitCleanupCallback();

    expect(anonRateLimits.has(freshIp)).toBe(true);
  });

  it("removes only stale entries when both exist", () => {
    const staleKey = freshKey("anon-mix-stale");
    const freshIp = freshKey("anon-mix-fresh");
    anonRateLimits.set(staleKey, { count: 5, resetAt: Date.now() - 1 });
    anonRateLimits.set(freshIp, { count: 2, resetAt: Date.now() + 60_000 });

    anonRateLimitCleanupCallback();

    expect(anonRateLimits.has(staleKey)).toBe(false);
    expect(anonRateLimits.has(freshIp)).toBe(true);
  });

  it("advances the clock past resetAt and then the callback removes the entry", () => {
    const ip = freshKey("anon-adv");
    const windowMs = 60_000;
    anonRateLimits.set(ip, { count: 1, resetAt: Date.now() + windowMs });

    // Before the window elapses the entry should survive cleanup.
    anonRateLimitCleanupCallback();
    expect(anonRateLimits.has(ip)).toBe(true);

    // Advance past the window; now the entry should be pruned.
    vi.advanceTimersByTime(windowMs + 1);
    anonRateLimitCleanupCallback();
    expect(anonRateLimits.has(ip)).toBe(false);
  });
});

describe("aiGenRateLimitCleanupCallback – prunes stale entries, keeps fresh ones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    aiGenRateLimits.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes entries whose resetAt is in the past", () => {
    const staleKey = freshKey("aigen-stale");
    aiGenRateLimits.set(staleKey, { count: 3, resetAt: Date.now() - 1 });

    aiGenRateLimitCleanupCallback();

    expect(aiGenRateLimits.has(staleKey)).toBe(false);
  });

  it("keeps entries whose resetAt is in the future", () => {
    const freshKey2 = freshKey("aigen-fresh");
    aiGenRateLimits.set(freshKey2, { count: 1, resetAt: Date.now() + 60_000 });

    aiGenRateLimitCleanupCallback();

    expect(aiGenRateLimits.has(freshKey2)).toBe(true);
  });

  it("removes only stale entries when both exist", () => {
    const staleKey = freshKey("aigen-mix-stale");
    const freshKey2 = freshKey("aigen-mix-fresh");
    aiGenRateLimits.set(staleKey, { count: 10, resetAt: Date.now() - 1 });
    aiGenRateLimits.set(freshKey2, { count: 2, resetAt: Date.now() + 60_000 });

    aiGenRateLimitCleanupCallback();

    expect(aiGenRateLimits.has(staleKey)).toBe(false);
    expect(aiGenRateLimits.has(freshKey2)).toBe(true);
  });

  it("advances the clock past resetAt and then the callback removes the entry", () => {
    const key = freshKey("aigen-adv");
    const windowMs = 60_000;
    aiGenRateLimits.set(key, { count: 1, resetAt: Date.now() + windowMs });

    aiGenRateLimitCleanupCallback();
    expect(aiGenRateLimits.has(key)).toBe(true);

    vi.advanceTimersByTime(windowMs + 1);
    aiGenRateLimitCleanupCallback();
    expect(aiGenRateLimits.has(key)).toBe(false);
  });
});

describe("uploadRateLimitCleanupCallback – prunes stale entries, keeps fresh ones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    uploadRateLimits.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes entries whose resetAt is in the past", () => {
    const staleKey = freshKey("upload-stale");
    uploadRateLimits.set(staleKey, { count: 5, resetAt: Date.now() - 1 });

    uploadRateLimitCleanupCallback();

    expect(uploadRateLimits.has(staleKey)).toBe(false);
  });

  it("keeps entries whose resetAt is in the future", () => {
    const freshKey2 = freshKey("upload-fresh");
    uploadRateLimits.set(freshKey2, { count: 1, resetAt: Date.now() + 60_000 });

    uploadRateLimitCleanupCallback();

    expect(uploadRateLimits.has(freshKey2)).toBe(true);
  });

  it("removes only stale entries when both exist", () => {
    const staleKey = freshKey("upload-mix-stale");
    const freshKey2 = freshKey("upload-mix-fresh");
    uploadRateLimits.set(staleKey, { count: 15, resetAt: Date.now() - 1 });
    uploadRateLimits.set(freshKey2, { count: 3, resetAt: Date.now() + 60_000 });

    uploadRateLimitCleanupCallback();

    expect(uploadRateLimits.has(staleKey)).toBe(false);
    expect(uploadRateLimits.has(freshKey2)).toBe(true);
  });

  it("advances the clock past resetAt and then the callback removes the entry", () => {
    const key = freshKey("upload-adv");
    const windowMs = 60_000;
    uploadRateLimits.set(key, { count: 1, resetAt: Date.now() + windowMs });

    uploadRateLimitCleanupCallback();
    expect(uploadRateLimits.has(key)).toBe(true);

    vi.advanceTimersByTime(windowMs + 1);
    uploadRateLimitCleanupCallback();
    expect(uploadRateLimits.has(key)).toBe(false);
  });
});

describe("heavyOpRateLimitCleanupCallback – prunes stale entries, keeps fresh ones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    heavyOpRateLimits.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes entries whose resetAt is in the past", () => {
    const staleKey = freshKey("heavy-stale");
    heavyOpRateLimits.set(staleKey, { count: 2, resetAt: Date.now() - 1 });

    heavyOpRateLimitCleanupCallback();

    expect(heavyOpRateLimits.has(staleKey)).toBe(false);
  });

  it("keeps entries whose resetAt is in the future", () => {
    const freshKey2 = freshKey("heavy-fresh");
    heavyOpRateLimits.set(freshKey2, { count: 1, resetAt: Date.now() + 60_000 });

    heavyOpRateLimitCleanupCallback();

    expect(heavyOpRateLimits.has(freshKey2)).toBe(true);
  });

  it("removes only stale entries when both exist", () => {
    const staleKey = freshKey("heavy-mix-stale");
    const freshKey2 = freshKey("heavy-mix-fresh");
    heavyOpRateLimits.set(staleKey, { count: 4, resetAt: Date.now() - 1 });
    heavyOpRateLimits.set(freshKey2, { count: 1, resetAt: Date.now() + 60_000 });

    heavyOpRateLimitCleanupCallback();

    expect(heavyOpRateLimits.has(staleKey)).toBe(false);
    expect(heavyOpRateLimits.has(freshKey2)).toBe(true);
  });

  it("advances the clock past resetAt and then the callback removes the entry", () => {
    const key = freshKey("heavy-adv");
    const windowMs = 60_000;
    heavyOpRateLimits.set(key, { count: 1, resetAt: Date.now() + windowMs });

    heavyOpRateLimitCleanupCallback();
    expect(heavyOpRateLimits.has(key)).toBe(true);

    vi.advanceTimersByTime(windowMs + 1);
    heavyOpRateLimitCleanupCallback();
    expect(heavyOpRateLimits.has(key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: sharedRateLimitCleanupCallback – DB cutoff is two hours in the past
// ---------------------------------------------------------------------------

describe("sharedRateLimitCleanupCallback – DB delete uses a two-hour cutoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: advisory lock is acquired by this instance (acquired: true).
    // The callback calls db.execute twice per successful run: once to acquire
    // the lock and once to release it.
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })  // pg_try_advisory_lock
      .mockResolvedValue({ rows: [] });                        // pg_advisory_unlock
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls db.delete(rateLimitLog) once per invocation", async () => {
    const mockWhere = vi.fn().mockResolvedValue({ rowCount: 0 });
    mockDbDelete.mockReturnValue({ where: mockWhere });

    await sharedRateLimitCleanupCallback();

    expect(mockDbDelete).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
  });

  it("passes a cutoff approximately two hours before Date.now()", async () => {
    const fixedNow = new Date("2026-06-18T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    let capturedSqlArg: any;
    const mockWhere = vi.fn().mockImplementation((arg) => {
      capturedSqlArg = arg;
      return Promise.resolve({ rowCount: 0 });
    });
    mockDbDelete.mockReturnValue({ where: mockWhere });

    await sharedRateLimitCleanupCallback();

    // The cutoff should be serialised in the SQL template literal.  We
    // stringify and inspect it — the exact Date value that was used is
    // embedded in the Drizzle SQL object's params array.
    const sqlJson = JSON.stringify(capturedSqlArg);
    const expectedCutoff = new Date(fixedNow - 2 * 60 * 60 * 1000).toISOString();
    expect(sqlJson).toContain(expectedCutoff);
  });

  it("uses a later cutoff after the clock advances by one hour", async () => {
    const baseNow = new Date("2026-06-18T12:00:00.000Z").getTime();
    vi.setSystemTime(baseNow);

    const capturedArgs: any[] = [];
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockImplementation((arg) => {
        capturedArgs.push(JSON.stringify(arg));
        return Promise.resolve({ rowCount: 0 });
      }),
    });

    await sharedRateLimitCleanupCallback();

    // Re-arm the execute mock for the second invocation.
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValue({ rows: [] });

    vi.advanceTimersByTime(60 * 60 * 1000); // +1 hour
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockImplementation((arg) => {
        capturedArgs.push(JSON.stringify(arg));
        return Promise.resolve({ rowCount: 0 });
      }),
    });
    await sharedRateLimitCleanupCallback();

    // Second cutoff should be one hour later than the first.
    const cutoff1 = new Date(baseNow - 2 * 60 * 60 * 1000).toISOString();
    const cutoff2 = new Date(baseNow + 60 * 60 * 1000 - 2 * 60 * 60 * 1000).toISOString();
    expect(capturedArgs[0]).toContain(cutoff1);
    expect(capturedArgs[1]).toContain(cutoff2);
  });

  it("swallows DB errors silently and does not throw", async () => {
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    });

    await expect(sharedRateLimitCleanupCallback()).resolves.toBeUndefined();
  });

  it("skips db.delete when advisory lock is not acquired", async () => {
    // Reset and configure execute to return acquired: false (another instance holds the lock).
    mockDbExecute.mockReset();
    mockDbExecute.mockResolvedValue({ rows: [{ acquired: false }] });
    const mockWhere = vi.fn().mockResolvedValue({ rowCount: 0 });
    mockDbDelete.mockReturnValue({ where: mockWhere });

    await sharedRateLimitCleanupCallback();

    expect(mockDbDelete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: clearRateLimiterIntervals – graceful-shutdown helper
// ---------------------------------------------------------------------------

describe("clearRateLimiterIntervals – stops all five cleanup intervals", () => {
  it("calls clearInterval exactly once for each of the five interval handles", () => {
    const spy = vi.spyOn(globalThis, "clearInterval");

    clearRateLimiterIntervals();

    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy).toHaveBeenCalledWith(sharedRateLimitCleanupInterval);
    expect(spy).toHaveBeenCalledWith(anonRateLimitCleanupInterval);
    expect(spy).toHaveBeenCalledWith(heavyOpRateLimitCleanupInterval);
    expect(spy).toHaveBeenCalledWith(aiGenRateLimitCleanupInterval);
    expect(spy).toHaveBeenCalledWith(uploadRateLimitCleanupInterval);

    spy.mockRestore();
  });

  it("after calling clearRateLimiterIntervals, fake-timer advancement no longer triggers cleanup callbacks", () => {
    vi.useFakeTimers();
    try {
      // Seed stale entries that each cleanup callback would remove if it ran.
      const staleAnonKey = "teardown-stale-anon";
      const staleAiGenKey = "teardown-stale-aigen";
      const staleUploadKey = "teardown-stale-upload";
      const staleHeavyKey = "teardown-stale-heavy";
      anonRateLimits.set(staleAnonKey, { count: 1, resetAt: Date.now() - 1 });
      aiGenRateLimits.set(staleAiGenKey, { count: 1, resetAt: Date.now() - 1 });
      uploadRateLimits.set(staleUploadKey, { count: 1, resetAt: Date.now() - 1 });
      heavyOpRateLimits.set(staleHeavyKey, { count: 1, resetAt: Date.now() - 1 });

      // Clear all five intervals — after this call no scheduled callback should fire.
      clearRateLimiterIntervals();

      // Advance well past every cleanup period (10 min in-memory, 15 min shared).
      vi.advanceTimersByTime(60 * 60 * 1000);

      // The stale entries must still be present because the cleanup intervals are gone.
      expect(anonRateLimits.has(staleAnonKey)).toBe(true);
      expect(aiGenRateLimits.has(staleAiGenKey)).toBe(true);
      expect(uploadRateLimits.has(staleUploadKey)).toBe(true);
      expect(heavyOpRateLimits.has(staleHeavyKey)).toBe(true);
    } finally {
      anonRateLimits.clear();
      aiGenRateLimits.clear();
      uploadRateLimits.clear();
      heavyOpRateLimits.clear();
      vi.useRealTimers();
    }
  });

  it("is idempotent – calling it twice does not throw", () => {
    expect(() => {
      clearRateLimiterIntervals();
      clearRateLimiterIntervals();
    }).not.toThrow();
  });
});
