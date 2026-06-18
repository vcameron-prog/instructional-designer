/**
 * Integration tests: each extractor is called with a real binary fixture file
 * created outside of the test suite (not a programmatic in-memory fixture).
 * These tests catch parser edge cases — namespace quirks in ODF exports,
 * embedded fonts in EPUB, OLE compound-document variants in legacy DOC files —
 * that synthetic fixtures won't expose.
 *
 * FIXTURE SIZE GUARD
 * All binary fixtures must stay under FIXTURE_SIZE_LIMIT_BYTES. If someone
 * swaps a fixture for a larger "real-world" file, the suite fails at setup
 * rather than silently ballooning CI time.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { extractDocContent } from "./doc-extractor.js";
import { extractOdfContent } from "./odf-extractor.js";
import { extractEpubContent } from "./epub-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

/** Maximum allowed size for any single binary fixture file (50 KB). */
const FIXTURE_SIZE_LIMIT_BYTES = 50 * 1024;

const BINARY_FIXTURES = [
  "sample.doc",
  "sample.odt",
  "sample.ods",
  "sample.odp",
  "sample.epub",
];

beforeAll(() => {
  for (const name of BINARY_FIXTURES) {
    const filePath = join(fixturesDir, name);
    const { size } = statSync(filePath);
    expect(
      size,
      `Fixture "${name}" is ${size} bytes — exceeds the ${FIXTURE_SIZE_LIMIT_BYTES}-byte ` +
        `limit. Replace it with a smaller synthetic fixture or update FIXTURE_SIZE_LIMIT_BYTES ` +
        `and budget extra CI time accordingly.`,
    ).toBeLessThanOrEqual(FIXTURE_SIZE_LIMIT_BYTES);
  }
});

function fixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

// ---------------------------------------------------------------------------
// DOC (legacy Word binary format)
// ---------------------------------------------------------------------------
describe("DOC extractor — real fixture", () => {
  it("returns non-empty text from sample.doc", async () => {
    const result = await extractDocContent(fixture("sample.doc"));
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("returns a valid PdfExtraction shape", async () => {
    const result = await extractDocContent(fixture("sample.doc"));
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
  });

  it("returns at least one page", async () => {
    const result = await extractDocContent(fixture("sample.doc"));
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// ODT (ODF text document)
// ---------------------------------------------------------------------------
describe("ODT extractor — real fixture", () => {
  it("returns non-empty text from sample.odt", async () => {
    const result = await extractOdfContent(fixture("sample.odt"), "odt");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("returns a valid PdfExtraction shape", async () => {
    const result = await extractOdfContent(fixture("sample.odt"), "odt");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
  });

  it("returns at least one page", async () => {
    const result = await extractOdfContent(fixture("sample.odt"), "odt");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// ODS (ODF spreadsheet)
// ---------------------------------------------------------------------------
describe("ODS extractor — real fixture", () => {
  it("returns non-empty text from sample.ods", async () => {
    const result = await extractOdfContent(fixture("sample.ods"), "ods");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("returns a valid PdfExtraction shape", async () => {
    const result = await extractOdfContent(fixture("sample.ods"), "ods");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
  });

  it("returns at least one page", async () => {
    const result = await extractOdfContent(fixture("sample.ods"), "ods");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("surfaces spreadsheet data in the tables array", async () => {
    const result = await extractOdfContent(fixture("sample.ods"), "ods");
    expect(result.tables.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// ODP (ODF presentation)
// ---------------------------------------------------------------------------
describe("ODP extractor — real fixture", () => {
  it("returns non-empty text from sample.odp", async () => {
    const result = await extractOdfContent(fixture("sample.odp"), "odp");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("returns a valid PdfExtraction shape", async () => {
    const result = await extractOdfContent(fixture("sample.odp"), "odp");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
  });

  it("returns at least one page (one slide)", async () => {
    const result = await extractOdfContent(fixture("sample.odp"), "odp");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------
describe("EPUB extractor — real fixture", () => {
  it("returns non-empty text from sample.epub", async () => {
    const result = await extractEpubContent(fixture("sample.epub"));
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("returns a valid PdfExtraction shape", async () => {
    const result = await extractEpubContent(fixture("sample.epub"));
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
  });

  it("returns at least one page (chapter)", async () => {
    const result = await extractEpubContent(fixture("sample.epub"));
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });
});
