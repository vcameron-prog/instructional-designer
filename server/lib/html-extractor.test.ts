import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractHtmlContent } from "./html-extractor.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("extractHtmlContent", () => {
  it("extracts text from an existing HTML fixture", async () => {
    const buffer = readFileSync(join(fixturesDir, "corporate-report.html"));
    const result = await extractHtmlContent(buffer);

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("strips script and style tags from output text", async () => {
    const html = Buffer.from(`<html><head>
      <style>body { color: red; }</style>
      <script>alert('hi');</script>
    </head><body><p>Hello World</p></body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.text).toContain("Hello World");
    expect(result.text).not.toContain("color: red");
    expect(result.text).not.toContain("alert(");
  });

  it("extracts tables into the tables array", async () => {
    const html = Buffer.from(`<html><body>
      <p>Some text</p>
      <table>
        <tr><th>Name</th><th>Score</th></tr>
        <tr><td>Alice</td><td>95</td></tr>
        <tr><td>Bob</td><td>82</td></tr>
      </table>
    </body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows).toHaveLength(3);
    expect(result.tables[0].rows[0]).toContain("Name");
    expect(result.tables[0].rows[0]).toContain("Score");
  });

  it("does not double-count table text in the body text", async () => {
    const html = Buffer.from(`<html><body>
      <p>Intro text</p>
      <table><tr><td>UNIQUE_TABLE_CONTENT_XYZ</td></tr></table>
    </body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.text).toContain("Intro text");
    expect(result.text).not.toContain("UNIQUE_TABLE_CONTENT_XYZ");
  });

  it("extracts the page title from <title> tag", async () => {
    const html = Buffer.from(`<html><head><title>My Document Title</title></head><body><p>Body</p></body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.metadata.title).toBe("My Document Title");
  });

  it("falls back to <h1> for title when <title> is absent", async () => {
    const html = Buffer.from(`<html><body><h1>Main Heading</h1><p>Body</p></body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.metadata.title).toBe("Main Heading");
  });

  it("returns at least 1 page", async () => {
    const html = Buffer.from(`<html><body><p>Hello</p></body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("returns the correct PdfExtraction shape", async () => {
    const html = Buffer.from(`<html><body><p>Test</p></body></html>`);
    const result = await extractHtmlContent(html);

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("tables");
    expect(Array.isArray(result.images)).toBe(true);
    expect(Array.isArray(result.tables)).toBe(true);
    expect(result.images).toEqual([]);
  });

  it("handles multiple tables on the same page", async () => {
    const html = Buffer.from(`<html><body>
      <table><tr><td>Table 1</td></tr></table>
      <table><tr><td>Table 2</td></tr></table>
    </body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.tables).toHaveLength(2);
  });

  it("assigns pageNumber 1 to all extracted tables", async () => {
    const html = Buffer.from(`<html><body>
      <table><tr><td>A</td></tr></table>
    </body></html>`);
    const result = await extractHtmlContent(html);

    expect(result.tables[0].pageNumber).toBe(1);
  });
});
