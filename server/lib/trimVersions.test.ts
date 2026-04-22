import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are lifted to the top of the file, so any
// variables they reference must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const { mockNotInArray, mockEq, mockAnd, mockDesc, mockDelete, mockSelect } = vi.hoisted(() => ({
  mockNotInArray: vi.fn((_col: unknown, ids: unknown) => ({ notInArray: ids })),
  mockEq: vi.fn((_col: unknown, val: unknown) => ({ eq: val })),
  mockAnd: vi.fn((...args: unknown[]) => ({ and: args })),
  mockDesc: vi.fn((col: unknown) => ({ desc: col })),
  mockDelete: vi.fn(),
  mockSelect: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock drizzle-orm helpers – only used as arguments to the mocked db methods.
// notInArray is the key one: its arguments tell us which IDs are preserved.
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", () => ({
  eq: mockEq,
  desc: mockDesc,
  and: mockAnd,
  notInArray: mockNotInArray,
  sql: new Proxy(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ sql: true }),
    { get: () => vi.fn(() => ({ sql: true })) },
  ),
}));

// Mock shared schema – the table object is only passed as an argument.
vi.mock("../../shared/schema.js", () => ({
  contentVersions: {
    generatedContentId: "col_generatedContentId",
    id: "col_id",
    createdAt: "col_createdAt",
  },
}));

// Mock the db singleton.
vi.mock("../db.js", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

// ---------------------------------------------------------------------------
// Drizzle chain helper
// Creates a thenable, fully-chainable object.  Awaiting it resolves to
// `resolvedValue`, simulating the drizzle query builder pattern.
// ---------------------------------------------------------------------------
function makeChain(resolvedValue: unknown) {
  const self: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "groupBy", "having"]) {
    self[m] = () => self;
  }
  self["then"] = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolvedValue).then(resolve, reject);
  return self;
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { trimAllOversizedVersions } from "./trimVersions.js";

// ---------------------------------------------------------------------------

describe("trimAllOversizedVersions", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.CONTENT_VERSION_KEEP_COUNT;
  });

  function loggedText(): string {
    return consoleSpy.mock.calls.map((c) => c[0] as string).join(" ");
  }

  // -------------------------------------------------------------------------
  // Path 1 – nothing to trim
  // -------------------------------------------------------------------------
  describe("when all content items are within the version limit", () => {
    it("performs no deletes and logs a clean startup message", async () => {
      mockSelect.mockReturnValue(makeChain([]));

      await trimAllOversizedVersions();

      expect(mockDelete).not.toHaveBeenCalled();
      expect(loggedText()).toContain("[startup]");
      expect(loggedText()).toContain("within the");
    });

    it("includes the default keep-count (10) in the log when env var is absent", async () => {
      mockSelect.mockReturnValue(makeChain([]));

      await trimAllOversizedVersions();

      expect(loggedText()).toContain("10-version limit");
    });

    it("uses a custom keep-count from CONTENT_VERSION_KEEP_COUNT env var", async () => {
      process.env.CONTENT_VERSION_KEEP_COUNT = "5";
      mockSelect.mockReturnValue(makeChain([]));

      await trimAllOversizedVersions();

      expect(loggedText()).toContain("5-version limit");
    });
  });

  // -------------------------------------------------------------------------
  // Path 2 – oversized content items present
  // -------------------------------------------------------------------------
  describe("when a content item has more versions than the limit", () => {
    it("calls delete exactly once for one oversized item and logs total deleted", async () => {
      const KEEP = 3;
      process.env.CONTENT_VERSION_KEEP_COUNT = String(KEEP);

      const totalVersions = KEEP + 2; // 2 excess rows
      const keepIds = [{ id: 5 }, { id: 4 }, { id: 3 }]; // 3 newest

      mockSelect.mockReturnValueOnce(makeChain([{ contentId: 42, total: totalVersions }]));
      mockSelect.mockReturnValueOnce(makeChain(keepIds));
      mockDelete.mockReturnValue(makeChain(undefined));

      await trimAllOversizedVersions();

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain("deleted 2 excess version row(s)");
    });

    it("passes only the newest N version IDs to the delete exclusion predicate", async () => {
      // The delete call uses notInArray(col, keepIds) so only older rows are
      // removed.  Asserting the exact IDs passed to notInArray confirms that
      // the N newest versions are preserved and the rest are targeted.
      const KEEP = 3;
      process.env.CONTENT_VERSION_KEEP_COUNT = String(KEEP);

      // Simulate DB returning ids 5, 4, 3 as the newest N versions to keep.
      // Ids 2 and 1 are the excess and should be targeted for deletion.
      const newestIds = [{ id: 5 }, { id: 4 }, { id: 3 }];

      mockSelect.mockReturnValueOnce(makeChain([{ contentId: 42, total: KEEP + 2 }]));
      mockSelect.mockReturnValueOnce(makeChain(newestIds));
      mockDelete.mockReturnValue(makeChain(undefined));

      await trimAllOversizedVersions();

      // notInArray should be called once, with the IDs of the newest versions.
      // This proves that the delete predicate excludes (keeps) exactly those rows.
      expect(mockNotInArray).toHaveBeenCalledTimes(1);
      const [_col, passedIds] = mockNotInArray.mock.calls[0];
      expect(passedIds).toEqual([5, 4, 3]);
    });

    it("handles multiple oversized content items and accumulates deleted count", async () => {
      const KEEP = 2;
      process.env.CONTENT_VERSION_KEEP_COUNT = String(KEEP);

      mockSelect.mockReturnValueOnce(
        makeChain([
          { contentId: 10, total: KEEP + 1 },
          { contentId: 20, total: KEEP + 1 },
        ]),
      );
      mockSelect.mockReturnValueOnce(makeChain([{ id: 3 }, { id: 2 }]));
      mockSelect.mockReturnValueOnce(makeChain([{ id: 9 }, { id: 8 }]));
      mockDelete.mockReturnValue(makeChain(undefined));

      await trimAllOversizedVersions();

      expect(mockDelete).toHaveBeenCalledTimes(2);
      // 2 items × 1 excess each = 2 total deleted
      expect(loggedText()).toContain("deleted 2 excess version row(s)");
    });

    it("logs how many content items exceeded the limit before trimming", async () => {
      const KEEP = 2;
      process.env.CONTENT_VERSION_KEEP_COUNT = String(KEEP);

      mockSelect.mockReturnValueOnce(makeChain([{ contentId: 7, total: KEEP + 3 }]));
      mockSelect.mockReturnValueOnce(makeChain([{ id: 10 }, { id: 9 }]));
      mockDelete.mockReturnValue(makeChain(undefined));

      await trimAllOversizedVersions();

      expect(loggedText()).toContain("1 content item(s) exceed");
    });
  });
});
