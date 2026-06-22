import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist fs mock helpers before vi.mock() calls
// ---------------------------------------------------------------------------
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { checkMigrationDrift } from "./migrationCheck.js";
import type pg from "pg";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JOURNAL_PATH_SUFFIX = "meta/_journal.json";

function buildJournal(tags: string[]): string {
  return JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: tags.map((tag, idx) => ({ idx, tag, when: 1000000 + idx })),
  });
}

function makePool(tableExists: boolean, appliedCount: number): pg.Pool {
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return Promise.resolve({ rows: [{ count: tableExists ? "1" : "0" }] });
      }
      if (sql.includes("__drizzle_migrations")) {
        return Promise.resolve({
          rows: [{ count: String(appliedCount) }],
        });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as pg.Pool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkMigrationDrift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Journal missing — graceful no-op
  // -------------------------------------------------------------------------

  it("returns empty result when journal file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    const pool = makePool(true, 0);
    const result = await checkMigrationDrift(pool);

    expect(result).toEqual({ expected: [], applied: 0, pending: [], extra: 0 });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Table does not exist yet — first-run path
  // -------------------------------------------------------------------------

  it("returns all tags as pending when the migrations table does not exist", async () => {
    const tags = ["0000_first", "0001_second"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tags.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(tags));

    const pool = makePool(false, 0);
    const result = await checkMigrationDrift(pool);

    expect(result.expected).toEqual(tags);
    expect(result.applied).toBe(0);
    expect(result.pending).toEqual(tags);
  });

  // -------------------------------------------------------------------------
  // All migrations applied — no pending
  // -------------------------------------------------------------------------

  it("returns empty pending list when all migrations are applied", async () => {
    const tags = ["0000_first", "0001_second", "0002_third"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tags.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(tags));

    const pool = makePool(true, tags.length);
    const result = await checkMigrationDrift(pool);

    expect(result.expected).toEqual(tags);
    expect(result.applied).toBe(tags.length);
    expect(result.pending).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Some migrations unapplied — correct tags listed
  // -------------------------------------------------------------------------

  it("lists only the unapplied tail of migrations as pending", async () => {
    const tags = ["0000_first", "0001_second", "0002_third", "0003_fourth"];
    const appliedCount = 2;

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tags.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(tags));

    const pool = makePool(true, appliedCount);
    const result = await checkMigrationDrift(pool);

    expect(result.expected).toEqual(tags);
    expect(result.applied).toBe(appliedCount);
    expect(result.pending).toEqual(["0002_third", "0003_fourth"]);
  });

  // -------------------------------------------------------------------------
  // Journal entry with no matching .sql file is excluded from expected set
  // -------------------------------------------------------------------------

  it("excludes journal entries that have no corresponding .sql file", async () => {
    const allTags = ["0000_real", "0001_phantom", "0002_also_real"];
    const tagsWithSql = ["0000_real", "0002_also_real"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tagsWithSql.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(allTags));

    const pool = makePool(true, tagsWithSql.length);
    const result = await checkMigrationDrift(pool);

    expect(result.expected).toEqual(tagsWithSql);
    expect(result.applied).toBe(tagsWithSql.length);
    expect(result.pending).toEqual([]);
  });

  it("phantom-only entries leave all real migrations as pending when none applied", async () => {
    const allTags = ["0000_real", "0001_phantom"];
    const tagsWithSql = ["0000_real"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tagsWithSql.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(allTags));

    const pool = makePool(true, 0);
    const result = await checkMigrationDrift(pool);

    expect(result.expected).toEqual(["0000_real"]);
    expect(result.pending).toEqual(["0000_real"]);
    expect(result.extra).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Over-applied — DB has more applied migrations than the journal tracks
  // -------------------------------------------------------------------------

  it("sets extra to the count of migrations applied beyond the journal", async () => {
    const tags = ["0000_first", "0001_second"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tags.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(tags));

    // DB says 3 applied but journal only has 2 entries — one file was deleted
    const pool = makePool(true, 3);
    const result = await checkMigrationDrift(pool);

    expect(result.expected).toEqual(tags);
    expect(result.applied).toBe(3);
    expect(result.pending).toEqual([]);
    expect(result.extra).toBe(1);
  });

  it("sets extra correctly when multiple migration files are missing", async () => {
    const tags = ["0000_first"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tags.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(tags));

    // DB says 4 applied but journal only has 1 entry
    const pool = makePool(true, 4);
    const result = await checkMigrationDrift(pool);

    expect(result.expected).toEqual(tags);
    expect(result.applied).toBe(4);
    expect(result.pending).toEqual([]);
    expect(result.extra).toBe(3);
  });

  it("returns extra of 0 when applied equals expected length", async () => {
    const tags = ["0000_first", "0001_second"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tags.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(tags));

    const pool = makePool(true, tags.length);
    const result = await checkMigrationDrift(pool);

    expect(result.extra).toBe(0);
  });

  it("returns extra of 0 when applied is less than expected length (pending case)", async () => {
    const tags = ["0000_first", "0001_second", "0002_third"];

    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith(JOURNAL_PATH_SUFFIX)) return true;
      return tags.some((t) => String(p).endsWith(`${t}.sql`));
    });
    mockReadFileSync.mockReturnValue(buildJournal(tags));

    const pool = makePool(true, 1);
    const result = await checkMigrationDrift(pool);

    expect(result.extra).toBe(0);
    expect(result.pending).toEqual(["0001_second", "0002_third"]);
  });
});
