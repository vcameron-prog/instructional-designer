import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("fs");

import fs from "fs";
import { checkMigrationSnapshots } from "./check-migration-snapshots.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

function makeJournal(entries: Array<{ idx: number; tag: string }>) {
  return JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: entries.map((e) => ({ ...e, when: 1_700_000_000_000, breakpoints: true })),
  });
}

describe("checkMigrationSnapshots", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe("when all snapshots are present", () => {
    it("returns { missing: [], checked: N } without calling process.exit", () => {
      const entries = [
        { idx: 0, tag: "0000_initial" },
        { idx: 1, tag: "0001_add_users" },
        { idx: 2, tag: "0002_add_courses" },
      ];

      mockExistsSync.mockImplementation((p) => {
        const filePath = String(p);
        if (filePath.endsWith("_journal.json")) return true;
        if (
          filePath.endsWith("0000_snapshot.json") ||
          filePath.endsWith("0001_snapshot.json") ||
          filePath.endsWith("0002_snapshot.json")
        ) return true;
        return false;
      });

      mockReadFileSync.mockReturnValue(makeJournal(entries) as never);

      const result = checkMigrationSnapshots();

      expect(result.missing).toEqual([]);
      expect(result.checked).toBe(3);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when one snapshot file is missing", () => {
    it("returns the correct missing entry in the result", () => {
      const entries = [
        { idx: 0, tag: "0000_initial" },
        { idx: 1, tag: "0001_add_users" },
        { idx: 2, tag: "0002_add_courses" },
      ];

      mockExistsSync.mockImplementation((p) => {
        const filePath = String(p);
        if (filePath.endsWith("_journal.json")) return true;
        if (filePath.endsWith("0001_snapshot.json")) return false;
        return true;
      });

      mockReadFileSync.mockReturnValue(makeJournal(entries) as never);

      const result = checkMigrationSnapshots();

      expect(result.checked).toBe(3);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]).toMatchObject({
        idx: 1,
        tag: "0001_add_users",
        expectedFile: "0001_snapshot.json",
      });
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the journal file is absent", () => {
    it("calls process.exit(1) and logs a clear error mentioning the journal", () => {
      mockExistsSync.mockReturnValue(false);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => checkMigrationSnapshots()).toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);

      const messages = errorSpy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(messages).toMatch(/journal/i);
      expect(messages).toMatch(/not found/i);

      errorSpy.mockRestore();
    });
  });
});
