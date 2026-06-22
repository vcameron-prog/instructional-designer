import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file.
// ---------------------------------------------------------------------------
const { mockCheckMigrationDrift, mockMigrate } = vi.hoisted(() => ({
  mockCheckMigrationDrift: vi.fn(),
  mockMigrate: vi.fn(),
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
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: actual.readFileSync,
  };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered.
// ---------------------------------------------------------------------------
import { runMigrations } from "./runMigrations";

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
});
