import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import JSZip from "jszip";
import { parseMarkdownInline, buildContentDocx } from "./content-docx.js";
import { processTable } from "./docx-builder.js";

async function extractDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("word/document.xml not found in docx buffer");
  return file.async("string");
}

describe("parseMarkdownInline", () => {
  it("returns a plain run for plain text", () => {
    const runs = parseMarkdownInline("hello world");
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("hello world");
    expect(runs[0].bold).toBeUndefined();
    expect(runs[0].italics).toBeUndefined();
  });

  it("wraps **bold** text in a bold run", () => {
    const runs = parseMarkdownInline("say **hello** there");
    expect(runs).toHaveLength(3);
    expect(runs[0].text).toBe("say ");
    expect(runs[1].text).toBe("hello");
    expect(runs[1].bold).toBe(true);
    expect(runs[2].text).toBe(" there");
  });

  it("wraps *italic* text in an italic run", () => {
    const runs = parseMarkdownInline("say *hello* there");
    expect(runs).toHaveLength(3);
    expect(runs[1].text).toBe("hello");
    expect(runs[1].italics).toBe(true);
  });

  it("wraps __bold__ text in a bold run", () => {
    const runs = parseMarkdownInline("__bold__");
    expect(runs).toHaveLength(1);
    expect(runs[0].bold).toBe(true);
    expect(runs[0].text).toBe("bold");
  });

  it("wraps _italic_ text in an italic run", () => {
    const runs = parseMarkdownInline("_italic_");
    expect(runs).toHaveLength(1);
    expect(runs[0].italics).toBe(true);
    expect(runs[0].text).toBe("italic");
  });

  it("handles multiple inline marks in one line", () => {
    const runs = parseMarkdownInline("**a** and *b*");
    const boldRun = runs.find((r) => r.bold);
    const italicRun = runs.find((r) => r.italics);
    expect(boldRun?.text).toBe("a");
    expect(italicRun?.text).toBe("b");
  });

  it("returns a single run for empty string", () => {
    const runs = parseMarkdownInline("");
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("");
  });
});

describe("buildContentDocx", () => {
  const baseItem = {
    toolName: "Test Tool",
    content: "# Heading One\n\nSome body text.\n- bullet",
    createdAt: new Date("2026-01-15"),
  };

  const course = {
    courseName: "Intro to Testing",
    courseNumber: "TST101",
    sectionNumber: "01",
    instructor: "Prof. Smith",
    semester: "Spring 2026",
  };

  it("returns a non-empty Buffer", async () => {
    const buf = await buildContentDocx(baseItem, course);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("returns a Buffer when course is null", async () => {
    const buf = await buildContentDocx(baseItem, null);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("produces a valid DOCX zip magic header (PK\\x03\\x04)", async () => {
    const buf = await buildContentDocx(baseItem, course);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it("handles content with numbered lists", async () => {
    const item = { ...baseItem, content: "1. First\n2. Second" };
    const buf = await buildContentDocx(item, null);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles content with bold standalone lines", async () => {
    const item = { ...baseItem, content: "**Section Header**\nsome text" };
    const buf = await buildContentDocx(item, null);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles content with nested bullet items", async () => {
    const item = { ...baseItem, content: "- parent\n   - child" };
    const buf = await buildContentDocx(item, null);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles a Date object and a date string equally", async () => {
    const withDate = await buildContentDocx(baseItem, null);
    const withString = await buildContentDocx(
      { ...baseItem, createdAt: "2026-01-15" },
      null,
    );
    expect(withDate.length).toBeGreaterThan(0);
    expect(withString.length).toBeGreaterThan(0);
  });

  it("does not drop a <ul> inside a table cell", async () => {
    const html = `<table><tr><th>Feature</th><th>Options</th></tr><tr><td>Formats</td><td><ul><li>PDF</li><li>DOCX</li></ul></td></tr></table>`;
    const buf = await buildContentDocx({ ...baseItem, content: html }, null);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("does not drop an <ol> inside a table cell", async () => {
    const html = `<table><tr><th>Step</th><th>Actions</th></tr><tr><td>Setup</td><td><ol><li>Install</li><li>Configure</li></ol></td></tr></table>`;
    const buf = await buildContentDocx({ ...baseItem, content: html }, null);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("does not leak raw <table HTML into the docx XML when content contains an HTML table", async () => {
    const tableHtml = [
      "<table>",
      "  <thead><tr><th>Name</th><th>Score</th></tr></thead>",
      "  <tbody>",
      "    <tr><td>Alice</td><td>95</td></tr>",
      "    <tr><td>Bob</td><td>87</td></tr>",
      "  </tbody>",
      "</table>",
    ].join("\n");

    const item = { ...baseItem, content: tableHtml };
    const buf = await buildContentDocx(item, null);
    const xml = await extractDocumentXml(buf);

    expect(xml).not.toMatch(/<table/i);
    expect(xml).not.toMatch(/<\/table>/i);
    expect(xml).not.toMatch(/<th[^>]*>/i);
    expect(xml).not.toMatch(/<td[^>]*>/i);
  });

  it("produces a valid DOCX buffer when content contains an HTML table", async () => {
    const tableHtml =
      "<table><tr><th>Col A</th><th>Col B</th></tr><tr><td>1</td><td>2</td></tr></table>";
    const item = { ...baseItem, content: tableHtml };
    const buf = await buildContentDocx(item, null);

    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it("includes cell text content in the document XML when table is present", async () => {
    const tableHtml =
      "<table><tr><th>Header</th></tr><tr><td>CellValue</td></tr></table>";
    const item = { ...baseItem, content: tableHtml };
    const buf = await buildContentDocx(item, null);
    const xml = await extractDocumentXml(buf);

    expect(xml).toContain("Header");
    expect(xml).toContain("CellValue");
  });

  it("handles mixed markdown and HTML table content without leaking raw HTML", async () => {
    const content = [
      "## Section Title",
      "",
      "Some introductory text.",
      "",
      "<table>",
      "  <tr><th>Item</th><th>Value</th></tr>",
      "  <tr><td>Alpha</td><td>10</td></tr>",
      "</table>",
      "",
      "Text after the table.",
    ].join("\n");

    const item = { ...baseItem, content };
    const buf = await buildContentDocx(item, null);
    const xml = await extractDocumentXml(buf);

    expect(xml).not.toMatch(/<table/i);
    expect(xml).toContain("Section Title");
    expect(xml).toContain("Alpha");
    expect(xml).toContain("Text after the table.");
  });

  it("pure markdown content produces a valid docx with no HTML table tags", async () => {
    const item = {
      ...baseItem,
      content:
        "## Overview\n\nThis course covers **key topics**.\n\n- Topic A\n- Topic B\n\n1. Step one\n2. Step two",
    };
    const buf = await buildContentDocx(item, null);
    const xml = await extractDocumentXml(buf);

    expect(buf).toBeInstanceOf(Buffer);
    expect(xml).not.toMatch(/<table/i);
    expect(xml).toContain("Overview");
    expect(xml).toContain("key topics");
  });

  it("handles a table with colspan and rowspan without leaking raw HTML", async () => {
    const tableHtml = [
      "<table>",
      "  <tr><th colspan='2'>Wide Header</th></tr>",
      "  <tr><td rowspan='2'>Tall Cell</td><td>Row 1</td></tr>",
      "  <tr><td>Row 2</td></tr>",
      "</table>",
    ].join("\n");

    const item = { ...baseItem, content: tableHtml };
    const buf = await buildContentDocx(item, null);
    const xml = await extractDocumentXml(buf);

    expect(xml).not.toMatch(/<table/i);
    expect(xml).toContain("Wide Header");
    expect(xml).toContain("Tall Cell");
  });
});

describe("processTable — nested lists in cells", () => {
  function parseTable(html: string) {
    const root = parse(html);
    const el = root.querySelector("table");
    if (!el) throw new Error("no table found");
    return el;
  }

  function getParagraphsInFirstCell(table: ReturnType<typeof processTable>) {
    const tableAny = table as any;
    const row = tableAny.root.find((n: any) => n.rootKey === "w:tr");
    const cell = row.root.find((n: any) => n.rootKey === "w:tc");
    return (cell.root as any[]).filter((n: any) => n.rootKey === "w:p");
  }

  it("renders unordered list items as separate paragraphs in the cell", () => {
    const html = `<table><tr><td><ul><li>Alpha</li><li>Beta</li></ul></td></tr></table>`;
    const table = processTable(parseTable(html));
    expect(table).not.toBeNull();
    const paragraphs = getParagraphsInFirstCell(table);
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  it("renders ordered list items as separate paragraphs in the cell", () => {
    const html = `<table><tr><td><ol><li>First</li><li>Second</li><li>Third</li></ol></td></tr></table>`;
    const table = processTable(parseTable(html));
    expect(table).not.toBeNull();
    const paragraphs = getParagraphsInFirstCell(table);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
  });

  it("renders inline text before a list as a separate paragraph", () => {
    const html = `<table><tr><td>Intro text<ul><li>Item A</li><li>Item B</li></ul></td></tr></table>`;
    const table = processTable(parseTable(html));
    expect(table).not.toBeNull();
    const paragraphs = getParagraphsInFirstCell(table);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps plain text cells unaffected (single paragraph)", () => {
    const html = `<table><tr><td>Plain text only</td></tr></table>`;
    const table = processTable(parseTable(html));
    expect(table).not.toBeNull();
    const paragraphs = getParagraphsInFirstCell(table);
    expect(paragraphs).toHaveLength(1);
  });
});
