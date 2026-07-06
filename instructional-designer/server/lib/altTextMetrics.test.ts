import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockInsert, mockOnConflictDoUpdate, mockValues, mockWhere, mockFrom } =
  vi.hoisted(() => {
    const mockOnConflictDoUpdate = vi.fn();
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));
    const mockWhere = vi.fn();
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    return { mockSelect, mockInsert, mockOnConflictDoUpdate, mockValues, mockWhere, mockFrom };
  });

vi.mock("../db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
}));

vi.mock("@shared/schema", () => ({
  appMetrics: {
    key: "key",
  },
}));

import {
  getAltTextParseFailMetrics,
  recordAltTextParseFail,
  initAltTextParseFailMetrics,
  _resetAltTextParseFailMetricsForTest,
  ALT_TEXT_METRIC_KEYS,
} from "./altTextMetrics";

describe("altTextMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAltTextParseFailMetricsForTest();
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockWhere.mockResolvedValue([]);
  });

  it("starts at zero with no lastAt", () => {
    const metrics = getAltTextParseFailMetrics();
    expect(metrics).toEqual({ count: 0, lastAt: null });
  });

  it("increments the in-memory counter and sets lastAt on each call", async () => {
    await recordAltTextParseFail();
    let metrics = getAltTextParseFailMetrics();
    expect(metrics.count).toBe(1);
    expect(metrics.lastAt).not.toBeNull();

    const firstLastAt = metrics.lastAt;

    await recordAltTextParseFail();
    metrics = getAltTextParseFailMetrics();
    expect(metrics.count).toBe(2);
    expect(metrics.lastAt).not.toBeNull();
    expect(typeof metrics.lastAt).toBe("string");
    expect(firstLastAt).not.toBeNull();
  });

  it("persists the incremented count and lastAt to the DB via onConflictDoUpdate", async () => {
    await recordAltTextParseFail();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        key: ALT_TEXT_METRIC_KEYS.parseFailCount,
        count: 1,
        lastAt: expect.any(Date),
      }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "key",
        set: expect.objectContaining({
          count: 1,
          lastAt: expect.any(Date),
        }),
      }),
    );
  });

  it("seeds the in-memory counter from mocked DB rows on init", async () => {
    const seededLastAt = new Date("2026-01-01T00:00:00.000Z");
    mockWhere.mockResolvedValueOnce([
      { key: ALT_TEXT_METRIC_KEYS.parseFailCount, count: 42, lastAt: seededLastAt },
    ]);

    await initAltTextParseFailMetrics();

    const metrics = getAltTextParseFailMetrics();
    expect(metrics.count).toBe(42);
    expect(metrics.lastAt).toBe(seededLastAt.toISOString());
  });

  it("leaves counters at zero when init finds no matching DB rows", async () => {
    mockWhere.mockResolvedValueOnce([]);

    await initAltTextParseFailMetrics();

    expect(getAltTextParseFailMetrics()).toEqual({ count: 0, lastAt: null });
  });

  it("catches a DB failure during init and leaves counters at zero", async () => {
    mockWhere.mockRejectedValueOnce(new Error("db unreachable"));

    await expect(initAltTextParseFailMetrics()).resolves.toBeUndefined();

    expect(getAltTextParseFailMetrics()).toEqual({ count: 0, lastAt: null });
  });

  it("catches a DB write failure during recordAltTextParseFail without throwing, while keeping the in-memory increment and logging the failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error("db write failed"));

    await expect(recordAltTextParseFail()).resolves.toBeUndefined();

    const metrics = getAltTextParseFailMetrics();
    expect(metrics.count).toBe(1);
    expect(metrics.lastAt).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to persist parse-fail metric to DB"),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it("continues incrementing normally after a prior DB failure", async () => {
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error("db write failed"));
    await recordAltTextParseFail();
    expect(getAltTextParseFailMetrics().count).toBe(1);

    mockOnConflictDoUpdate.mockResolvedValueOnce(undefined);
    await recordAltTextParseFail();
    expect(getAltTextParseFailMetrics().count).toBe(2);
  });
});
