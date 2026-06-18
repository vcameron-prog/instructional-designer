import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractCsvContent } from "./csv-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("extractCsvContent", () => {
  it("extracts text and table from a fixture CSV file", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.csv"));
    const result = await extractCsvContent(buffer);

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows.length).toBeGreaterThan(1);
    expect(result.pageCount).toBe(1);
    expect(result.images).toEqual([]);
  });

  it("includes column headers in returned text", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.csv"));
    const result = await extractCsvContent(buffer);

    expect(result.text).toContain("Name");
    expect(result.text).toContain("Grade");
    expect(result.text).toContain("Score");
  });

  it("preserves header row as first row in the table", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.csv"));
    const result = await extractCsvContent(buffer);

    const firstRow = result.tables[0].rows[0];
    expect(firstRow).toContain("Name");
    expect(firstRow).toContain("Grade");
  });

  it("includes data values in the table rows", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.csv"));
    const result = await extractCsvContent(buffer);

    const allText = result.tables[0].rows.flat().join(" ");
    expect(allText).toContain("Alice");
    expect(allText).toContain("Bob");
  });

  it("returns empty result for an empty CSV", async () => {
    const buffer = Buffer.from("");
    const result = await extractCsvContent(buffer);

    expect(result.text).toBe("");
    expect(result.tables).toEqual([]);
    expect(result.pageCount).toBe(1);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.csv"));
    const result = await extractCsvContent(buffer);

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
  });

  it("handles CSV with a single row (headers only)", async () => {
    const buffer = Buffer.from("Name,Score,Grade\n");
    const result = await extractCsvContent(buffer);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows).toHaveLength(1);
  });

  it("handles CSV with inline quotes", async () => {
    const csv = `Name,Description\nAlice,"Good work, excellent"\nBob,"Needs ""improvement"""\n`;
    const buffer = Buffer.from(csv);
    const result = await extractCsvContent(buffer);

    expect(result.text).toBeTruthy();
    expect(result.tables[0].rows.length).toBeGreaterThanOrEqual(2);
  });

  it("assigns pageNumber 1 to the extracted table", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.csv"));
    const result = await extractCsvContent(buffer);

    expect(result.tables[0].pageNumber).toBe(1);
  });
});
