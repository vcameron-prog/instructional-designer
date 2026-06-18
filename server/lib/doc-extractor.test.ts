import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractDocContent } from "./doc-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("extractDocContent — fixture file", () => {
  it("extracts non-empty text from the sample.doc fixture", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.doc"));
    const result = await extractDocContent(buffer);

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("includes readable body content from the fixture", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.doc"));
    const result = await extractDocContent(buffer);

    expect(result.text).toContain("Legacy Course Syllabus");
    expect(result.text).toContain("Grading");
  });

  it("returns at least 1 page", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.doc"));
    const result = await extractDocContent(buffer);

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.doc"));
    const result = await extractDocContent(buffer);

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
    expect(result.images).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.metadata).toEqual({});
  });

  it("returns page count of 1 for a short document", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.doc"));
    const result = await extractDocContent(buffer);

    expect(result.pageCount).toBe(1);
  });

  it("throws a meaningful error for completely invalid DOC bytes", async () => {
    const invalidBuffer = Buffer.from("this is not a valid doc file at all");

    await expect(extractDocContent(invalidBuffer)).rejects.toThrow();
  });
});
