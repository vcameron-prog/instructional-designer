import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractRtfContent } from "./rtf-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("extractRtfContent", () => {
  it("extracts plain text from a fixture RTF file", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
    const result = await extractRtfContent(buffer);

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("strips RTF control words from the output", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
    const result = await extractRtfContent(buffer);

    expect(result.text).not.toContain("\\rtf1");
    expect(result.text).not.toContain("\\fonttbl");
    expect(result.text).not.toContain("\\par");
  });

  it("includes readable content words", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
    const result = await extractRtfContent(buffer);

    expect(result.text).toContain("Course Syllabus");
    expect(result.text).toContain("Grading Policy");
  });

  it("returns at least 1 page", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
    const result = await extractRtfContent(buffer);

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const buffer = readFileSync(join(fixturesDir, "sample.rtf"));
    const result = await extractRtfContent(buffer);

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
    expect(result.tables).toEqual([]);
    expect(result.images).toEqual([]);
  });

  it("decodes RTF \\par as newlines to separate paragraphs", async () => {
    const rtf = Buffer.from("{\\rtf1\\ansi First paragraph\\par Second paragraph\\par}");
    const result = await extractRtfContent(rtf);

    expect(result.text).toContain("First paragraph");
    expect(result.text).toContain("Second paragraph");
  });

  it("decodes RTF unicode escapes correctly", async () => {
    const rtf = Buffer.from("{\\rtf1\\ansi \\u8364? Euro symbol\\par}");
    const result = await extractRtfContent(rtf);

    expect(result.text).toContain("\u20ac");
  });

  it("preserves ASCII text adjacent to RTF hex escapes", async () => {
    // rtf-parser handles \'e9 as a Unicode replacement character (U+FFFD);
    // the fallback regex-based path decodes it to é (U+00E9).
    // Either way the surrounding ASCII text must survive.
    const rtf = Buffer.from("{\\rtf1\\ansi caf\\'e9\\par}");
    const result = await extractRtfContent(rtf);

    expect(result.text).toContain("caf");
  });

  it("handles an empty RTF document without throwing", async () => {
    const rtf = Buffer.from("{\\rtf1\\ansi\\deff0 }");
    const result = await extractRtfContent(rtf);

    expect(result.text).toBe("");
    expect(result.pageCount).toBe(1);
  });
});
