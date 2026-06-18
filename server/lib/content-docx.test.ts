import { describe, it, expect } from "vitest";
import { parseMarkdownInline, buildContentDocx } from "./content-docx.js";

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
});
