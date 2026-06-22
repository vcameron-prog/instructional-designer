import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file.
// ---------------------------------------------------------------------------
const { mockCheckMigrationDrift, mockMigrate, mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockCheckMigrationDrift: vi.fn(),
  mockMigrate: vi.fn(),
  mockExistsSync: vi.fn(() => false),
  mockReadFileSync: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {},
  pool: {},
}));

vi.mock("./migrationCheck", () => ({
  checkMigrationDrift: mockCheckMigrationDrift,
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: mockMigrate,
}));

// Stub fs so the journal pre-flight check is skipped in all tests that don't
// need it (journalPath does not exist → pre-flight exits early).
// NOTE: runMigrations.ts uses `import fs from "fs"` (CJS default), so we must
// override `default` as well as the named exports.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mockedDefault = Object.assign(Object.create(null), actual.default, {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  });
  return {
    ...actual,
    default: mockedDefault,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered.
// ---------------------------------------------------------------------------
import { runMigrations } from "./runMigrations";
import path from "path";

describe("runMigrations – production guard", () => {
  let originalNodeEnv: string | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalNodeEnv = process.env.NODE_ENV;
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockMigrate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("calls process.exit(1) when there are pending migrations in production", async () => {
    process.env.NODE_ENV = "production";
    mockCheckMigrationDrift.mockResolvedValue({
      expected: ["0000_initial", "0001_add_users"],
      applied: 1,
      pending: ["0001_add_users"],
      extra: 0,
    });

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs an actionable error message naming the pending migration(s)", async () => {
    process.env.NODE_ENV = "production";
    mockCheckMigrationDrift.mockResolvedValue({
      expected: ["0000_initial", "0001_add_users"],
      applied: 1,
      pending: ["0001_add_users"],
      extra: 0,
    });

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    const errorArg: string = errorSpy.mock.calls[0][0];
    expect(errorArg).toContain("FATAL");
    expect(errorArg).toContain("0001_add_users");
    expect(errorArg).toContain("npm run db:migrate");
    expect(errorArg).toContain("Production startup aborted");
  });

  it("does NOT exit in development when there are pending migrations", async () => {
    process.env.NODE_ENV = "development";
    mockCheckMigrationDrift.mockResolvedValue({
      expected: ["0000_initial", "0001_add_users"],
      applied: 1,
      pending: ["0001_add_users"],
      extra: 0,
    });

    await expect(runMigrations()).resolves.not.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit in production when all migrations are applied", async () => {
    process.env.NODE_ENV = "production";
    mockCheckMigrationDrift.mockResolvedValue({
      expected: ["0000_initial", "0001_add_users"],
      applied: 2,
      pending: [],
      extra: 0,
    });

    await expect(runMigrations()).resolves.not.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("proceeds to apply migrations even if drift check throws (connectivity issue)", async () => {
    process.env.NODE_ENV = "production";
    mockCheckMigrationDrift.mockRejectedValue(new Error("DB not reachable"));

    await expect(runMigrations()).resolves.not.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mockMigrate).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Over-applied guard — deleted migration files
  // -------------------------------------------------------------------------

  it("calls process.exit(1) in production when extra > 0", async () => {
    process.env.NODE_ENV = "production";
    mockCheckMigrationDrift.mockResolvedValue({
      expected: ["0000_initial", "0001_add_users"],
      applied: 3,
      pending: [],
      extra: 1,
    });

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("calls process.exit(1) in development when extra > 0", async () => {
    process.env.NODE_ENV = "development";
    mockCheckMigrationDrift.mockResolvedValue({
      expected: ["0000_initial"],
      applied: 3,
      pending: [],
      extra: 2,
    });

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs an actionable FATAL error message when migration files are deleted", async () => {
    process.env.NODE_ENV = "production";
    mockCheckMigrationDrift.mockResolvedValue({
      expected: ["0000_initial", "0001_add_users"],
      applied: 3,
      pending: [],
      extra: 1,
    });

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    const errorArg: string = errorSpy.mock.calls[0][0];
    expect(errorArg).toContain("FATAL");
    expect(errorArg).toContain("deleted after being applied");
    expect(errorArg).toContain("Startup aborted");
  });
});

describe("runMigrations – phantom journal guard", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const migrationsFolder = path.resolve(process.cwd(), "migrations");
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockMigrate.mockResolvedValue(undefined);
    mockCheckMigrationDrift.mockResolvedValue({ expected: [], applied: 0, pending: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls process.exit(1) when a journal entry has no matching SQL file on disk", async () => {
    const fakeJournal = JSON.stringify({
      entries: [{ idx: 0, tag: "0000_phantom_migration" }],
    });

    mockExistsSync.mockImplementation((p: string) => p === journalPath);
    mockReadFileSync.mockReturnValue(fakeJournal);

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs an actionable error message naming the phantom entry and the journal file", async () => {
    const fakeJournal = JSON.stringify({
      entries: [{ idx: 3, tag: "0003_orphaned_entry" }],
    });

    mockExistsSync.mockImplementation((p: string) => p === journalPath);
    mockReadFileSync.mockReturnValue(fakeJournal);

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    const errorArg: string = errorSpy.mock.calls[0][0];
    expect(errorArg).toContain("FATAL");
    expect(errorArg).toContain("0003_orphaned_entry.sql");
    expect(errorArg).toContain("journal");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT exit when every journal entry has a matching SQL file", async () => {
    const fakeJournal = JSON.stringify({
      entries: [{ idx: 0, tag: "0000_initial" }],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(fakeJournal);

    await expect(runMigrations()).resolves.not.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("names only the phantom entry in the error when the journal has a mix of valid and phantom entries", async () => {
    const fakeJournal = JSON.stringify({
      entries: [
        { idx: 0, tag: "0000_initial" },
        { idx: 1, tag: "0001_add_users" },
        { idx: 2, tag: "0002_phantom_migration" },
      ],
    });

    mockExistsSync.mockImplementation((p: string) => {
      if (p === journalPath) return true;
      if (p === path.join(migrationsFolder, "0000_initial.sql")) return true;
      if (p === path.join(migrationsFolder, "0001_add_users.sql")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(fakeJournal);

    await expect(runMigrations()).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);

    const errorArg: string = errorSpy.mock.calls[0][0];
    expect(errorArg).toContain("0002_phantom_migration.sql");
    expect(errorArg).not.toContain("0000_initial");
    expect(errorArg).not.toContain("0001_add_users");
  });
});
