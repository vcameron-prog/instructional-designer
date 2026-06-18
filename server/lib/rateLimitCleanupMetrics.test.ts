/**
 * Unit tests proving that rateLimitCleanup metrics survive a simulated server
 * restart: sharedRateLimitCleanupCallback writes counters to the DB; after
 * zeroing the in-memory state (simulating a process restart),
 * initRateLimitCleanupMetrics reads the persisted values back — and the
 * in-memory counters must match what was originally written.
 *
 * The DB is fully mocked so the suite runs without a live PostgreSQL instance.
 * cleanupRateLimitLog (from shared-rate-limit.ts) is also mocked so the
 * test controls exactly how many rows were deleted per run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any vi.mock() calls
// ---------------------------------------------------------------------------
const { mockDbInsert, mockDbSelect, mockDbExecute, mockCleanupRateLimitLog } =
  vi.hoisted(() => ({
    mockDbInsert: vi.fn(),
    mockDbSelect: vi.fn(),
    mockDbExecute: vi.fn(),
    mockCleanupRateLimitLog: vi.fn(),
  }));

// Mock the db singleton used by rateLimiters.ts
vi.mock("../db", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    execute: mockDbExecute,
  },
}));

// Minimal schema stub — only appMetrics is referenced by the functions under test
vi.mock("@shared/schema", () => ({
  appMetrics: { key: "key", count: "count", lastAt: "last_at" },
  rateLimitLog: { key: "key", action: "action", createdAt: "created_at" },
}));

// Mock cleanupRateLimitLog so sharedRateLimitCleanupCallback does not need a
// real rate_limit_log table.
vi.mock("./shared-rate-limit", () => ({
  cleanupRateLimitLog: mockCleanupRateLimitLog,
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER all vi.mock() registrations
// ---------------------------------------------------------------------------
import {
  sharedRateLimitCleanupCallback,
  initRateLimitCleanupMetrics,
  getRateLimitCleanupMetrics,
  _resetCleanupMetricsForTest,
  CLEANUP_METRIC_KEYS,
} from "./rateLimiters.js";

// ---------------------------------------------------------------------------
// Helper: build a stateful mock for db.insert / db.select that simulates the
// app_metrics table as an in-memory Map.
// ---------------------------------------------------------------------------
type MetricRow = { key: string; count: number; lastAt: Date | null };

/**
 * Configures mockDbInsert and mockDbSelect to use a shared in-memory Map as
 * the backing store, matching the upsert semantics of the real DB:
 *   - INSERT → store the full row
 *   - ON CONFLICT DO UPDATE → patch only the columns listed in `set`
 * Returns the store so individual tests can inspect or pre-populate it.
 */
function makeMetricsStoreMock(): Map<string, MetricRow> {
  const store = new Map<string, MetricRow>();

  mockDbInsert.mockImplementation(() => {
    let capturedVals: MetricRow;
    return {
      values: vi.fn().mockImplementation((vals: MetricRow) => {
        capturedVals = vals;
        return {
          onConflictDoUpdate: vi
            .fn()
            .mockImplementation(({ set }: { set: Partial<MetricRow> }) => {
              const existing = store.get(capturedVals.key);
              if (existing) {
                store.set(capturedVals.key, { ...existing, ...set });
              } else {
                store.set(capturedVals.key, { ...capturedVals });
              }
              return Promise.resolve();
            }),
        };
      }),
    };
  });

  mockDbSelect.mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Array.from(store.values()))
        ),
    })),
  }));

  return store;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanup metrics persist across simulated server restarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Zero the in-memory state before every test so each test starts clean.
    _resetCleanupMetricsForTest();

    // Default DB execute behaviour: advisory lock acquired on first call,
    // advisory lock released on any subsequent calls.
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] }) // pg_try_advisory_lock
      .mockResolvedValue({ rows: [] }); // pg_advisory_unlock (and extras)
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  it("lastRunAt and rowsDeletedTotal are restored after a simulated restart", async () => {
    const store = makeMetricsStoreMock();
    const deletedThisRun = 7;
    mockCleanupRateLimitLog.mockResolvedValue(deletedThisRun);

    // Step 1: Run the cleanup callback — writes metrics to the mock DB.
    await sharedRateLimitCleanupCallback();

    const afterRun = getRateLimitCleanupMetrics();
    expect(afterRun.lastRunAt).not.toBeNull();
    expect(afterRun.rowsDeletedTotal).toBe(deletedThisRun);
    expect(afterRun.lastErrorAt).toBeNull();
    expect(store.size).toBeGreaterThanOrEqual(1);

    // Step 2: Simulate a server restart by zeroing the in-memory state.
    _resetCleanupMetricsForTest();
    const afterReset = getRateLimitCleanupMetrics();
    expect(afterReset.lastRunAt).toBeNull();
    expect(afterReset.rowsDeletedTotal).toBe(0);
    expect(afterReset.lastErrorAt).toBeNull();

    // Step 3: initRateLimitCleanupMetrics reads from the mock DB (simulates startup).
    await initRateLimitCleanupMetrics();

    // Step 4: Counters must match what was originally written.
    const afterInit = getRateLimitCleanupMetrics();
    expect(afterInit.lastRunAt).toBe(afterRun.lastRunAt);
    expect(afterInit.rowsDeletedTotal).toBe(deletedThisRun);
    expect(afterInit.lastErrorAt).toBeNull();
  });

  it("rowsDeletedTotal accumulates across multiple runs and is fully restored", async () => {
    const store = makeMetricsStoreMock();
    mockCleanupRateLimitLog.mockResolvedValueOnce(3).mockResolvedValueOnce(5);

    // First cleanup run
    await sharedRateLimitCleanupCallback();

    // Re-arm the execute mock for the second run.
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValue({ rows: [] });

    // Second cleanup run
    await sharedRateLimitCleanupCallback();

    const afterTwoRuns = getRateLimitCleanupMetrics();
    expect(afterTwoRuns.rowsDeletedTotal).toBe(8); // 3 + 5

    // Simulate restart.
    _resetCleanupMetricsForTest();

    // Restore from the mock DB.
    await initRateLimitCleanupMetrics();

    const afterInit = getRateLimitCleanupMetrics();
    expect(afterInit.rowsDeletedTotal).toBe(8);
    expect(afterInit.lastRunAt).not.toBeNull();
    expect(afterInit.lastErrorAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  it("lastErrorAt is restored after a simulated restart when the run fails", async () => {
    const store = makeMetricsStoreMock();

    // cleanupRateLimitLog throws inside the inner try block.
    // The inner finally (advisory unlock) still runs, then the outer catch
    // fires: _cleanupLastErrorAt is set and persistCleanupError writes to DB.
    mockCleanupRateLimitLog.mockRejectedValue(new Error("DB connection lost"));

    await sharedRateLimitCleanupCallback();

    const afterError = getRateLimitCleanupMetrics();
    expect(afterError.lastErrorAt).not.toBeNull();
    expect(afterError.lastRunAt).toBeNull(); // run did not complete successfully
    expect(afterError.rowsDeletedTotal).toBe(0);

    // Simulate restart.
    _resetCleanupMetricsForTest();

    // Restore from the mock DB.
    await initRateLimitCleanupMetrics();

    const afterInit = getRateLimitCleanupMetrics();
    expect(afterInit.lastErrorAt).toBe(afterError.lastErrorAt);
    expect(afterInit.lastRunAt).toBeNull();
    expect(afterInit.rowsDeletedTotal).toBe(0);
  });

  // -------------------------------------------------------------------------
  // DB key correctness
  // -------------------------------------------------------------------------

  it("callback writes to the expected DB key names", async () => {
    const store = makeMetricsStoreMock();
    mockCleanupRateLimitLog.mockResolvedValue(4);

    await sharedRateLimitCleanupCallback();

    // Both the run timestamp and the cumulative row count must be persisted.
    expect(store.has(CLEANUP_METRIC_KEYS.lastRunAt)).toBe(true);
    expect(store.has(CLEANUP_METRIC_KEYS.rowsDeleted)).toBe(true);
    // On the success path there must be no error entry.
    expect(store.has(CLEANUP_METRIC_KEYS.lastErrorAt)).toBe(false);

    // Restart and restore — keys must map to the correct in-memory fields.
    _resetCleanupMetricsForTest();
    await initRateLimitCleanupMetrics();

    const { lastRunAt, rowsDeletedTotal, lastErrorAt } = getRateLimitCleanupMetrics();
    expect(lastRunAt).not.toBeNull();
    expect(rowsDeletedTotal).toBe(4);
    expect(lastErrorAt).toBeNull();
  });

  it("error callback writes to the rateLimitCleanup.lastErrorAt key", async () => {
    const store = makeMetricsStoreMock();
    mockCleanupRateLimitLog.mockRejectedValue(new Error("timeout"));

    await sharedRateLimitCleanupCallback();

    expect(store.has(CLEANUP_METRIC_KEYS.lastErrorAt)).toBe(true);
    expect(store.has(CLEANUP_METRIC_KEYS.lastRunAt)).toBe(false);
    expect(store.has(CLEANUP_METRIC_KEYS.rowsDeleted)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Resilience of initRateLimitCleanupMetrics itself
  // -------------------------------------------------------------------------

  it("initRateLimitCleanupMetrics tolerates a DB error and leaves state zeroed", async () => {
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockRejectedValue(new Error("DB unavailable")),
      })),
    }));

    // Must not throw — the function warns and starts from zero.
    await expect(initRateLimitCleanupMetrics()).resolves.toBeUndefined();

    const { lastRunAt, rowsDeletedTotal, lastErrorAt } = getRateLimitCleanupMetrics();
    expect(lastRunAt).toBeNull();
    expect(rowsDeletedTotal).toBe(0);
    expect(lastErrorAt).toBeNull();
  });
});
