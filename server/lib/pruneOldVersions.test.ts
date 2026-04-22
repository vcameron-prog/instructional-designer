import { describe, it, expect, vi, beforeEach } from "vitest";

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
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", () => ({
  eq: mockEq,
  desc: mockDesc,
  and: mockAnd,
  notInArray: mockNotInArray,
  isNull: vi.fn(),
  sql: new Proxy(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ sql: true }),
    { get: () => vi.fn(() => ({ sql: true })) },
  ),
}));

// Mock shared schema – the table objects are only passed as arguments.
// Both the path-alias form and the relative form are mocked so the import
// resolves regardless of how the test runner resolves the alias.
vi.mock("../../shared/schema.js", () => ({
  courses: {},
  generatedContent: {},
  savedContent: {},
  contentVersions: {
    generatedContentId: "col_generatedContentId",
    id: "col_id",
    createdAt: "col_createdAt",
  },
}));
vi.mock("@shared/schema", () => ({
  courses: {},
  generatedContent: {},
  savedContent: {},
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
  for (const m of ["from", "where", "orderBy", "limit"]) {
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
import { DatabaseStorage } from "../storage.js";

// ---------------------------------------------------------------------------

describe("DatabaseStorage.pruneOldVersions", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  // -------------------------------------------------------------------------
  // Path 1 – fewer versions than keepCount (early return)
  // -------------------------------------------------------------------------
  describe("when fewer versions exist than keepCount", () => {
    it("returns early without performing any delete", async () => {
      const keepCount = 10;
      // Only 3 versions returned — below the keepCount of 10
      const existingVersions = [{ id: 3 }, { id: 2 }, { id: 1 }];
      mockSelect.mockReturnValue(makeChain(existingVersions));

      await storage.pruneOldVersions(42, keepCount);

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("does not call notInArray when returning early", async () => {
      const keepCount = 5;
      const existingVersions = [{ id: 2 }, { id: 1 }];
      mockSelect.mockReturnValue(makeChain(existingVersions));

      await storage.pruneOldVersions(99, keepCount);

      expect(mockNotInArray).not.toHaveBeenCalled();
    });

    it("does not delete when version count exactly equals keepCount minus one", async () => {
      const keepCount = 4;
      // 3 versions returned — one less than keepCount, still triggers early return
      const existingVersions = [{ id: 7 }, { id: 6 }, { id: 5 }];
      mockSelect.mockReturnValue(makeChain(existingVersions));

      await storage.pruneOldVersions(7, keepCount);

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Path 2 – versions exceed keepCount (delete old rows)
  // -------------------------------------------------------------------------
  describe("when versions meet or exceed keepCount", () => {
    it("calls delete once when there are excess versions", async () => {
      const keepCount = 3;
      // DB returns exactly keepCount rows (the newest N), meaning there are
      // older rows beyond those that must be deleted.
      const newestVersions = [{ id: 5 }, { id: 4 }, { id: 3 }];
      mockSelect.mockReturnValue(makeChain(newestVersions));
      mockDelete.mockReturnValue(makeChain(undefined));

      await storage.pruneOldVersions(42, keepCount);

      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it("passes the newest N version IDs to the notInArray exclusion predicate", async () => {
      const keepCount = 3;
      // Newest 3 versions – ids 5, 4, 3 are kept; 2 and 1 are excess.
      const newestVersions = [{ id: 5 }, { id: 4 }, { id: 3 }];
      mockSelect.mockReturnValue(makeChain(newestVersions));
      mockDelete.mockReturnValue(makeChain(undefined));

      await storage.pruneOldVersions(42, keepCount);

      expect(mockNotInArray).toHaveBeenCalledTimes(1);
      const [_col, passedIds] = mockNotInArray.mock.calls[0];
      expect(passedIds).toEqual([5, 4, 3]);
    });

    it("scopes the delete to the correct contentId", async () => {
      const keepCount = 2;
      const newestVersions = [{ id: 10 }, { id: 9 }];
      mockSelect.mockReturnValue(makeChain(newestVersions));
      mockDelete.mockReturnValue(makeChain(undefined));

      await storage.pruneOldVersions(77, keepCount);

      // eq should be called at least once with the contentId value (77)
      const eqCallValues = mockEq.mock.calls.map(([_col, val]) => val);
      expect(eqCallValues).toContain(77);
    });
  });
});
