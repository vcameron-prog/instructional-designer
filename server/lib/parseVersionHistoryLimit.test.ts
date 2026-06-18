import { describe, it, expect, vi } from "vitest";
import { parseVersionHistoryLimit } from "./parseVersionHistoryLimit.js";

const DEFAULT = 10;

describe("parseVersionHistoryLimit", () => {
  describe("when VERSION_HISTORY_LIMIT is unset (undefined)", () => {
    it("returns the default of 10 with no warning", () => {
      const warn = vi.fn();
      const result = parseVersionHistoryLimit(undefined, warn);
      expect(result).toBe(DEFAULT);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when VERSION_HISTORY_LIMIT is a non-numeric string", () => {
    it("logs a console.warn and falls back to 10", () => {
      const warn = vi.fn();
      const result = parseVersionHistoryLimit("abc", warn);
      expect(result).toBe(DEFAULT);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('"abc"');
      expect(warn.mock.calls[0][0]).toContain("invalid");
      expect(warn.mock.calls[0][0]).toContain(String(DEFAULT));
    });
  });

  describe("when VERSION_HISTORY_LIMIT is zero", () => {
    it("logs a console.warn and falls back to 10", () => {
      const warn = vi.fn();
      const result = parseVersionHistoryLimit("0", warn);
      expect(result).toBe(DEFAULT);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('"0"');
    });
  });

  describe("when VERSION_HISTORY_LIMIT is a negative number", () => {
    it("logs a console.warn and falls back to 10", () => {
      const warn = vi.fn();
      const result = parseVersionHistoryLimit("-5", warn);
      expect(result).toBe(DEFAULT);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('"-5"');
    });
  });

  describe("when VERSION_HISTORY_LIMIT is a valid positive integer", () => {
    it("returns the parsed value with no warning", () => {
      const warn = vi.fn();
      const result = parseVersionHistoryLimit("25", warn);
      expect(result).toBe(25);
      expect(warn).not.toHaveBeenCalled();
    });

    it("returns 1 when set to '1'", () => {
      const warn = vi.fn();
      const result = parseVersionHistoryLimit("1", warn);
      expect(result).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
