import { describe, it, expect } from "vitest";
import { fixHtmlTableCaption, fixHtmlTableThead, editHtmlTableCaption, fixDuplicateTableCaptions } from "./table-fixers.js";

// ---------------------------------------------------------------------------
// fixHtmlTableCaption — flat tables
// ---------------------------------------------------------------------------
describe("fixHtmlTableCaption — flat tables", () => {
  it("adds a caption after the opening tag of a table that has none", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input);
    expect(output).toBe(
      `<table><caption>Table summary</caption>\n<tr><td>A</td></tr></table>`
    );
    expect(tablesFixed).toBe(1);
  });

  it("leaves a table that already has a <caption> unchanged", () => {
    const input = `<table><caption>My caption</caption><tr><td>A</td></tr></table>`;
    const { html, tablesFixed } = fixHtmlTableCaption(input);
    expect(html).toBe(input);
    expect(tablesFixed).toBe(0);
  });

  it("handles a table opening tag that carries attributes", () => {
    const input = `<table class="data"><tr><td>A</td></tr></table>`;
    const { html: output } = fixHtmlTableCaption(input);
    expect(output).toContain('<table class="data"><caption>Table summary</caption>');
  });

  it("adds captions to multiple sibling flat tables independently", () => {
    const input = `<table><tr><td>T1</td></tr></table>\n<table><tr><td>T2</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input);
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(2);
    expect(tablesFixed).toBe(2);
  });

  it("does not add a second caption to a table that already has one", () => {
    const input = `<table><caption>Existing</caption><tr><td>A</td></tr></table>`;
    const { html, tablesFixed } = fixHtmlTableCaption(input);
    expect(html).toBe(input);
    expect(tablesFixed).toBe(0);
  });

  it("escapes HTML tags in the supplied caption text so they render as literal characters", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html } = fixHtmlTableCaption(input, "<b>Bold</b>");
    expect(html).toContain("<caption>&lt;b&gt;Bold&lt;/b&gt;</caption>");
    expect(html).not.toContain("<caption><b>Bold</b></caption>");
  });

  it("escapes a <script> tag in caption text so it is not executed", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html } = fixHtmlTableCaption(input, '<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("escapes ampersands and quotes in caption text", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html } = fixHtmlTableCaption(input, 'A & B "test"');
    expect(html).toContain("A &amp; B &quot;test&quot;");
  });
});

// ---------------------------------------------------------------------------
// fixHtmlTableCaption — nested tables
//
// node-html-parser visits every <table> element independently at every
// nesting depth, so each table is processed as a self-contained unit and
// receives its own <caption> when missing.
// ---------------------------------------------------------------------------
describe("fixHtmlTableCaption — nested tables", () => {
  it("inserts a caption into both the outer and inner table when neither has one", () => {
    const inner = `<table><tr><td>cell</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(outer);

    // Both tables get a caption.
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(2);
    expect(tablesFixed).toBe(2);
    // Tag balance is maintained.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("adds a caption to the outer table even when the inner table already has one", () => {
    // Inner already has a caption so it is left alone; outer still needs one.
    const inner = `<table><caption>Inner</caption><tr><td>cell</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(outer);

    // Outer now has a caption; inner's caption is preserved unchanged.
    expect(output).toContain("<caption>Table summary</caption>");
    expect(output).toContain("<caption>Inner</caption>");
    expect(tablesFixed).toBe(1);
    // Inner must not have gained a second caption.
    const innerCaptionCount = (output.match(/<caption>Inner<\/caption>/gi) ?? []).length;
    expect(innerCaptionCount).toBe(1);
    // Tag balance is maintained.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("adds captions to all three tables when two sibling inner tables and the outer table all lack one", () => {
    const inner1 = `<table><tr><td>A</td></tr></table>`;
    const inner2 = `<table><tr><td>B</td></tr></table>`;
    const outer = `<table><tr><td>${inner1}</td><td>${inner2}</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(outer);
    // outer + inner1 + inner2 each get a caption.
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(3);
    expect(tablesFixed).toBe(3);
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("does not add a duplicate caption when the second inner sibling already has one", () => {
    const inner1 = `<table><tr><td>A</td></tr></table>`;
    const inner2 = `<table><caption>Existing</caption><tr><td>B</td></tr></table>`;
    const outer = `<table><tr><td>${inner1}</td><td>${inner2}</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(outer);
    // inner2 already has a caption — it must not gain a second one.
    // outer + inner1 each gain a new caption; inner2 keeps its existing one.
    const count = (output.match(/<caption/gi) ?? []).length;
    expect(count).toBe(3); // outer (new) + inner1 (new) + inner2 (existing)
    expect(output).toContain("<caption>Existing</caption>");
    expect(tablesFixed).toBe(2);
  });

  it("keeps tags balanced for three levels of nesting and adds a caption to every table", () => {
    const deep = `<table><tr><td>d</td></tr></table>`;
    const mid = `<table><tr><td>${deep}</td></tr></table>`;
    const outer = `<table><tr><td>${mid}</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(outer);
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
    // All three tables receive a caption.
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(3);
    expect(tablesFixed).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// fixHtmlTableCaption — single string parameter
// ---------------------------------------------------------------------------
describe("fixHtmlTableCaption — single string parameter", () => {
  it("inserts the custom string verbatim when a non-empty string is passed", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input, "Course grades");
    expect(output).toContain("<caption>Course grades</caption>");
    expect(tablesFixed).toBe(1);
  });

  it("applies the custom string to the first uncaptioned table and falls back for subsequent ones", () => {
    const t1 = `<table><tr><td>T1</td></tr></table>`;
    const t2 = `<table><tr><td>T2</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(`${t1}\n${t2}`, "First caption");
    // Single string is treated as a one-element array; first table gets the
    // custom text, second table falls back to "Table summary".
    expect(output).toContain("<caption>First caption</caption>");
    expect(output).toContain("<caption>Table summary</caption>");
    expect(tablesFixed).toBe(2);
  });

  it("falls back to 'Table summary' when an empty string is passed as a single string", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input, "");
    expect(output).toContain("<caption>Table summary</caption>");
    expect(tablesFixed).toBe(1);
  });

  it("falls back to 'Table summary' when a whitespace-only string is passed", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input, "   ");
    expect(output).toContain("<caption>Table summary</caption>");
    expect(tablesFixed).toBe(1);
  });

  it("does not overwrite an existing caption when a custom string is passed", () => {
    const input = `<table><caption>Original</caption><tr><td>A</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input, "Replacement");
    expect(output).toContain("<caption>Original</caption>");
    expect(output).not.toContain("<caption>Replacement</caption>");
    expect(tablesFixed).toBe(0);
  });

  it("escapes raw ampersands in caption text as &amp;", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html: output } = fixHtmlTableCaption(input, "Grades & Attendance");
    expect(output).toContain("<caption>Grades &amp; Attendance</caption>");
    expect(output).not.toContain("Grades & Attendance</caption>");
  });

  it("escapes raw angle brackets in caption text so they render as text, not markup", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html: output } = fixHtmlTableCaption(input, "A < B > C");
    expect(output).toContain("<caption>A &lt; B &gt; C</caption>");
    expect(output).not.toContain("<caption>A < B > C</caption>");
    // Table tag balance must be maintained.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("neutralises an HTML injection payload in caption text — tags are rendered as text", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const payload = `<img src=x onerror=alert(1)>`;
    const { html: output } = fixHtmlTableCaption(input, payload);
    expect(output).toContain("&lt;img");
    expect(output).not.toContain("<img ");
    // Table structure must remain balanced.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("handles numeric and punctuation characters in caption text without escaping", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const { html: output } = fixHtmlTableCaption(input, "Table 1: Q1 Results (2024)");
    expect(output).toContain("<caption>Table 1: Q1 Results (2024)</caption>");
  });
});

// ---------------------------------------------------------------------------
// fixHtmlTableCaption — captionTexts array path
// ---------------------------------------------------------------------------
describe("fixHtmlTableCaption — captionTexts array", () => {
  it("applies distinct captions from an array to multiple uncaptioned tables in order", () => {
    const t1 = `<table><tr><td>T1</td></tr></table>`;
    const t2 = `<table><tr><td>T2</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(`${t1}\n${t2}`, ["Grade distribution", "Attendance log"]);
    expect(output).toContain("<caption>Grade distribution</caption>");
    expect(output).toContain("<caption>Attendance log</caption>");
    expect(tablesFixed).toBe(2);
  });

  it("falls back to 'Table summary' for tables beyond the end of a short array", () => {
    const t1 = `<table><tr><td>T1</td></tr></table>`;
    const t2 = `<table><tr><td>T2</td></tr></table>`;
    const t3 = `<table><tr><td>T3</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(`${t1}\n${t2}\n${t3}`, ["Only one caption"]);
    expect(output).toContain("<caption>Only one caption</caption>");
    const fallbackCount = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(fallbackCount).toBe(2);
    expect(tablesFixed).toBe(3);
  });

  it("ignores extra captions when the array is longer than the number of uncaptioned tables", () => {
    const input = `<table><tr><td>T1</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input, ["Caption A", "Caption B", "Caption C"]);
    expect(output).toContain("<caption>Caption A</caption>");
    const captionCount = (output.match(/<caption/gi) ?? []).length;
    expect(captionCount).toBe(1);
    expect(tablesFixed).toBe(1);
  });

  it("falls back to 'Table summary' for empty string entries in the array", () => {
    const t1 = `<table><tr><td>T1</td></tr></table>`;
    const t2 = `<table><tr><td>T2</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(`${t1}\n${t2}`, ["", ""]);
    const fallbackCount = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(fallbackCount).toBe(2);
    expect(tablesFixed).toBe(2);
  });

  it("falls back to 'Table summary' for whitespace-only string entries in the array", () => {
    const input = `<table><tr><td>T1</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(input, ["   "]);
    expect(output).toContain("<caption>Table summary</caption>");
    expect(tablesFixed).toBe(1);
  });

  it("skips already-captioned tables and applies array captions only to uncaptioned ones", () => {
    const captioned = `<table><caption>Existing</caption><tr><td>C</td></tr></table>`;
    const uncaptioned = `<table><tr><td>U</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableCaption(`${captioned}\n${uncaptioned}`, ["New caption"]);
    expect(output).toContain("<caption>Existing</caption>");
    expect(output).toContain("<caption>New caption</caption>");
    const captionCount = (output.match(/<caption/gi) ?? []).length;
    expect(captionCount).toBe(2);
    expect(tablesFixed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fixHtmlTableThead — flat tables
// ---------------------------------------------------------------------------
describe("fixHtmlTableThead — flat tables", () => {
  it("wraps the first <tr> in a <thead> and converts its cells to <th scope=col>", () => {
    const input = `<table><tr><td>Col A</td><td>Col B</td></tr><tr><td>1</td><td>2</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableThead(input);
    expect(output).toContain("<thead>");
    expect(output).toContain("</thead>");
    expect(output).toContain('<th scope="col">Col A</th>');
    expect(output).toContain('<th scope="col">Col B</th>');
    expect(output).toContain("<td>1</td>");
    expect(tablesFixed).toBe(1);
  });

  it("leaves a table that already has a <thead> unchanged", () => {
    const input = `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>`;
    const { html, tablesFixed } = fixHtmlTableThead(input);
    expect(html).toBe(input);
    expect(tablesFixed).toBe(0);
  });

  it("promotes the first <tr> out of <tbody> when there is no <thead>", () => {
    const input = `<table><tbody><tr><td>H1</td></tr><tr><td>D1</td></tr></tbody></table>`;
    const { html: output, tablesFixed } = fixHtmlTableThead(input);
    expect(output).toContain("<thead>");
    expect(output).toContain('<th scope="col">H1</th>');
    expect(output).toContain("<td>D1</td>");
    expect((output.match(/<thead/gi) ?? []).length).toBe(1);
    expect(tablesFixed).toBe(1);
  });

  it("adds <thead> to each of multiple sibling flat tables that lack one", () => {
    const t1 = `<table><tr><td>H1</td></tr></table>`;
    const t2 = `<table><tr><td>H2</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableThead(`${t1}\n${t2}`);
    expect((output.match(/<thead/gi) ?? []).length).toBe(2);
    expect(tablesFixed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// fixHtmlTableThead — nested tables
//
// node-html-parser processes tables innermost-first so each table is treated
// as a self-contained unit; both the outer and inner tables receive a <thead>
// when one is missing.
// ---------------------------------------------------------------------------
describe("fixHtmlTableThead — nested tables", () => {
  it("inserts <thead> into both the outer and inner table when neither has one", () => {
    const inner = `<table><tr><td>IH</td></tr><tr><td>ID</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableThead(outer);

    // Both tables get a <thead>.
    expect((output.match(/<thead/gi) ?? []).length).toBe(2);
    expect(output).toContain("</thead>");
    expect(tablesFixed).toBe(2);
    // The opening <table> tags (outer + inner) and their matching </table> tags survive.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("adds a <thead> to the outer table while leaving the inner table's existing <thead> intact", () => {
    // Inner already has a thead so it is skipped; outer still needs one.
    const inner = `<table><thead><tr><th>IH</th></tr></thead><tbody><tr><td>ID</td></tr></tbody></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const { html: output, tablesFixed } = fixHtmlTableThead(outer);

    // The inner thead content must be preserved intact.
    expect(output).toContain("<thead><tr><th>IH</th></tr></thead>");
    // Outer gets its own new thead — two theads total.
    expect((output.match(/<thead/gi) ?? []).length).toBe(2);
    expect(tablesFixed).toBe(1);
    // Tags remain balanced.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("does not modify either table when both already have a <thead>", () => {
    const inner = `<table><thead><tr><th>IH</th></tr></thead><tbody><tr><td>ID</td></tr></tbody></table>`;
    const outer = `<table><thead><tr><th>OH</th></tr></thead><tbody><tr><td>${inner}</td></tr></tbody></table>`;
    const { html, tablesFixed } = fixHtmlTableThead(outer);
    expect(html).toBe(outer);
    expect(tablesFixed).toBe(0);
  });

  it("preserves the existing <thead> of a second standalone inner sibling", () => {
    // First match: outer-open … first-inner-close (no thead → thead inserted).
    // Second match: second-inner (standalone block — it already has a thead → unchanged).
    const inner1 = `<table><tr><td>H1</td></tr><tr><td>D1</td></tr></table>`;
    const inner2 = `<table><thead><tr><th>H2</th></tr></thead><tbody><tr><td>D2</td></tr></tbody></table>`;
    const outer = `<table><tr><td>${inner1}</td><td>${inner2}</td></tr></table>`;
    const { html: output } = fixHtmlTableThead(outer);

    // inner2's thead content must survive.
    expect(output).toContain("<th>H2</th>");
    // Tags remain balanced.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("keeps tags balanced for three levels of nesting", () => {
    const deep = `<table><tr><td>dH</td></tr><tr><td>dD</td></tr></table>`;
    const mid = `<table><tr><td>${deep}</td></tr><tr><td>mD</td></tr></table>`;
    const outer = `<table><tr><td>${mid}</td></tr><tr><td>oD</td></tr></table>`;
    const { html: output } = fixHtmlTableThead(outer);

    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
    // At least one <thead> is inserted somewhere in the output.
    expect(output).toContain("<thead>");
  });
});

// ---------------------------------------------------------------------------
// Full pipeline integration — fixHtmlTableCaption then fixHtmlTableThead
//
// These tests exercise both fixers applied sequentially, verifying that the
// two fixers compose correctly and do not interfere with each other's output
// when nested tables are involved.
// ---------------------------------------------------------------------------
describe("full pipeline — fixHtmlTableCaption then fixHtmlTableThead on nested tables", () => {
  it("adds caption and thead to both outer and inner table when both are missing", () => {
    const inner = `<table><tr><td>IH</td></tr><tr><td>ID</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr><tr><td>OD</td></tr></table>`;

    const { html: stage1 } = fixHtmlTableCaption(outer);
    const { html: result } = fixHtmlTableThead(stage1);

    // Both tables must have a caption.
    expect((result.match(/<caption>Table summary<\/caption>/gi) ?? []).length).toBe(2);
    // Both tables must have a thead.
    expect((result.match(/<thead/gi) ?? []).length).toBe(2);
    // Tags must remain balanced.
    expect((result.match(/<table/gi) ?? []).length).toBe(
      (result.match(/<\/table>/gi) ?? []).length
    );
  });

  it("preserves an existing caption and thead in the inner table while adding them to the outer table", () => {
    const inner = `<table><caption>Inner cap</caption><thead><tr><th>IH</th></tr></thead><tbody><tr><td>ID</td></tr></tbody></table>`;
    const outer = `<table><tr><td>${inner}</td></tr><tr><td>OD</td></tr></table>`;

    const { html: stage1 } = fixHtmlTableCaption(outer);
    const { html: result } = fixHtmlTableThead(stage1);

    // Outer gets a new caption; inner keeps its own.
    expect(result).toContain("<caption>Table summary</caption>");
    expect(result).toContain("<caption>Inner cap</caption>");
    expect((result.match(/<caption/gi) ?? []).length).toBe(2);

    // Inner thead content must survive unchanged.
    expect(result).toContain("<th>IH</th>");
    // Outer gets a new thead — two theads total.
    expect((result.match(/<thead/gi) ?? []).length).toBe(2);

    // Tags must remain balanced.
    expect((result.match(/<table/gi) ?? []).length).toBe(
      (result.match(/<\/table>/gi) ?? []).length
    );
  });

  it("applies both fixes to all three tables across three nesting levels", () => {
    const deep = `<table><tr><td>dH</td></tr><tr><td>dD</td></tr></table>`;
    const mid = `<table><tr><td>${deep}</td></tr><tr><td>mD</td></tr></table>`;
    const outer = `<table><tr><td>${mid}</td></tr><tr><td>oD</td></tr></table>`;

    const { html: stage1 } = fixHtmlTableCaption(outer);
    const { html: result } = fixHtmlTableThead(stage1);

    // All three tables receive a caption.
    expect((result.match(/<caption>Table summary<\/caption>/gi) ?? []).length).toBe(3);
    // All three tables receive a thead.
    expect((result.match(/<thead/gi) ?? []).length).toBe(3);
    // Tags must remain balanced.
    expect((result.match(/<table/gi) ?? []).length).toBe(
      (result.match(/<\/table>/gi) ?? []).length
    );
  });

  it("handles two sibling inner tables where one already has a caption and one already has a thead", () => {
    // inner1: has caption, no thead.
    // inner2: no caption, has thead.
    const inner1 = `<table><caption>Cap1</caption><tr><td>H1</td></tr><tr><td>D1</td></tr></table>`;
    const inner2 = `<table><thead><tr><th>H2</th></tr></thead><tbody><tr><td>D2</td></tr></tbody></table>`;
    const outer = `<table><tr><td>${inner1}</td><td>${inner2}</td></tr></table>`;

    const { html: stage1 } = fixHtmlTableCaption(outer);
    const { html: result } = fixHtmlTableThead(stage1);

    // Outer + inner2 each gain a new caption; inner1 keeps its own (3 total).
    expect((result.match(/<caption/gi) ?? []).length).toBe(3);
    expect(result).toContain("<caption>Cap1</caption>");

    // Outer + inner1 each gain a thead; inner2 keeps its own (3 total).
    expect((result.match(/<thead/gi) ?? []).length).toBe(3);
    // inner2's existing th content must survive.
    expect(result).toContain("<th>H2</th>");

    // Tags must remain balanced.
    expect((result.match(/<table/gi) ?? []).length).toBe(
      (result.match(/<\/table>/gi) ?? []).length
    );
  });

  it("is idempotent: running the pipeline twice produces the same output as running it once", () => {
    const inner = `<table><tr><td>IH</td></tr><tr><td>ID</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr><tr><td>OD</td></tr></table>`;

    const runPipeline = (html: string) => fixHtmlTableThead(fixHtmlTableCaption(html).html).html;

    const once = runPipeline(outer);
    const twice = runPipeline(once);

    expect(twice).toBe(once);
  });

  it("leaves fully-formed nested tables unchanged when both caption and thead are present", () => {
    const inner = `<table><caption>Inner cap</caption><thead><tr><th scope="col">IH</th></tr></thead><tbody><tr><td>ID</td></tr></tbody></table>`;
    const outer = `<table><caption>Outer cap</caption><thead><tr><th scope="col">OH</th></tr></thead><tbody><tr><td>${inner}</td></tr></tbody></table>`;

    const { html: stage1 } = fixHtmlTableCaption(outer);
    const { html: result } = fixHtmlTableThead(stage1);

    // Nothing should change — both fixers are no-ops on fully-formed tables.
    expect(result).toBe(outer);
  });
});

// ---------------------------------------------------------------------------
// editHtmlTableCaption
//
// This function is used when the pencil icon is clicked on any rendered table
// caption — whether the caption was inserted by fixHtmlTableCaption or
// auto-generated by convertMarkdownTablesToHtml (convert-markdown-tables fix).
// ---------------------------------------------------------------------------
describe("editHtmlTableCaption", () => {
  // ── single-table cases ──────────────────────────────────────────────────

  it("replaces the caption text in a single-table document (captionIndex 0)", () => {
    const input = `<table>\n  <caption>Data table</caption>\n  <thead><tr><th>A</th></tr></thead>\n</table>`;
    const output = editHtmlTableCaption(input, "Updated caption", 0);
    expect(output).toContain("<caption>Updated caption</caption>");
    expect(output).not.toContain("<caption>Data table</caption>");
  });

  it("trims whitespace from the new caption text", () => {
    const input = `<table><caption>Old</caption></table>`;
    const output = editHtmlTableCaption(input, "  Trimmed  ", 0);
    expect(output).toContain("<caption>Trimmed</caption>");
  });

  it("falls back to 'Table summary' when the new caption text is blank", () => {
    const input = `<table><caption>Old</caption></table>`;
    const output = editHtmlTableCaption(input, "   ", 0);
    expect(output).toContain("<caption>Table summary</caption>");
  });

  it("preserves any attributes on the existing <caption> tag", () => {
    const input = `<table><caption class="my-cap">Old</caption></table>`;
    const output = editHtmlTableCaption(input, "New", 0);
    expect(output).toContain(`<caption class="my-cap">New</caption>`);
  });

  // ── multi-table cases (document-order indexing) ──────────────────────────

  it("edits only the first caption when captionIndex is 0", () => {
    const input =
      `<table><caption>First</caption></table>\n` +
      `<table><caption>Second</caption></table>`;
    const output = editHtmlTableCaption(input, "Changed", 0);
    expect(output).toContain("<caption>Changed</caption>");
    expect(output).toContain("<caption>Second</caption>");
    expect(output).not.toContain("<caption>First</caption>");
  });

  it("edits only the second caption when captionIndex is 1", () => {
    const input =
      `<table><caption>First</caption></table>\n` +
      `<table><caption>Second</caption></table>`;
    const output = editHtmlTableCaption(input, "Changed", 1);
    expect(output).toContain("<caption>First</caption>");
    expect(output).toContain("<caption>Changed</caption>");
    expect(output).not.toContain("<caption>Second</caption>");
  });

  it("leaves all captions unchanged when captionIndex exceeds the number of captions", () => {
    const input = `<table><caption>Only</caption></table>`;
    const output = editHtmlTableCaption(input, "New", 5);
    expect(output).toBe(input);
  });

  // ── omitted-index legacy mode ────────────────────────────────────────────

  it("updates every caption in the document when captionIndex is omitted", () => {
    const input =
      `<table><caption>First</caption></table>\n` +
      `<table><caption>Second</caption></table>`;
    const output = editHtmlTableCaption(input, "All changed");
    const count = (output.match(/<caption>All changed<\/caption>/gi) ?? []).length;
    expect(count).toBe(2);
  });

  // ── convert-markdown-tables format ──────────────────────────────────────
  // These cases mirror the exact HTML structure produced by
  // convertMarkdownTablesToHtml so that the pencil-edit save path is
  // verified for auto-generated captions.

  it("edits a caption auto-generated from the nearest heading (convert-markdown-tables style)", () => {
    const input =
      `<table>\n` +
      `  <caption>Data Overview</caption>\n` +
      `  <thead>\n    <tr><th scope="col">Name</th><th scope="col">Value</th></tr>\n  </thead>\n` +
      `  <tbody>\n    <tr><td>Alpha</td><td>1</td></tr>\n  </tbody>\n` +
      `</table>`;
    const output = editHtmlTableCaption(input, "Renamed Caption", 0);
    expect(output).toContain("<caption>Renamed Caption</caption>");
    expect(output).not.toContain("<caption>Data Overview</caption>");
    expect(output).toContain('<th scope="col">Name</th>');
  });

  it("edits the fallback 'Data table' caption produced when no heading precedes the markdown table", () => {
    const input =
      `<table>\n` +
      `  <caption>Data table</caption>\n` +
      `  <thead><tr><th scope="col">Col</th></tr></thead>\n` +
      `  <tbody><tr><td>val</td></tr></tbody>\n` +
      `</table>`;
    const output = editHtmlTableCaption(input, "My Custom Caption", 0);
    expect(output).toContain("<caption>My Custom Caption</caption>");
    expect(output).not.toContain("<caption>Data table</caption>");
  });

  it("correctly indexes captions across a document that mixes fix-html-table-caption and convert-markdown-tables captions", () => {
    // First table: caption inserted by fixHtmlTableCaption (no attributes).
    // Second table: caption auto-generated by convertMarkdownTablesToHtml.
    const input =
      `<table><caption>User supplied</caption><tr><td>A</td></tr></table>\n` +
      `<table>\n  <caption>Auto heading</caption>\n` +
      `  <thead><tr><th scope="col">X</th></tr></thead>\n` +
      `  <tbody><tr><td>1</td></tr></tbody>\n</table>`;

    const editFirst = editHtmlTableCaption(input, "Edited first", 0);
    expect(editFirst).toContain("<caption>Edited first</caption>");
    expect(editFirst).toContain("<caption>Auto heading</caption>");

    const editSecond = editHtmlTableCaption(input, "Edited second", 1);
    expect(editSecond).toContain("<caption>User supplied</caption>");
    expect(editSecond).toContain("<caption>Edited second</caption>");
  });

  // ── HTML escaping ────────────────────────────────────────────────────────

  it("escapes HTML tags in the new caption text so they render as literal characters", () => {
    const input = `<table><caption>Old</caption></table>`;
    const output = editHtmlTableCaption(input, "<b>Bold</b>", 0);
    expect(output).toContain("<caption>&lt;b&gt;Bold&lt;/b&gt;</caption>");
    expect(output).not.toContain("<caption><b>Bold</b></caption>");
  });

  it("escapes a <script> tag in new caption text so it is not executed", () => {
    const input = `<table><caption>Old</caption></table>`;
    const output = editHtmlTableCaption(input, '<script>alert("xss")</script>');
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>");
  });

  it("escapes ampersands and quotes in new caption text", () => {
    const input = `<table><caption>Old</caption></table>`;
    const output = editHtmlTableCaption(input, 'A & B "test"', 0);
    expect(output).toContain("A &amp; B &quot;test&quot;");
  });

  it("escapes HTML tags when updating all captions (omitted captionIndex)", () => {
    const input =
      `<table><caption>First</caption></table>\n` +
      `<table><caption>Second</caption></table>`;
    const output = editHtmlTableCaption(input, "<em>Note</em>");
    const count = (output.match(/&lt;em&gt;Note&lt;\/em&gt;/gi) ?? []).length;
    expect(count).toBe(2);
    expect(output).not.toContain("<em>Note</em>");
  });
});

// ---------------------------------------------------------------------------
// fixDuplicateTableCaptions
// ---------------------------------------------------------------------------
describe("fixDuplicateTableCaptions", () => {
  it("leaves captions unchanged when all are already unique", () => {
    const html =
      `<table><caption>Alpha</caption><tbody><tr><td>A</td></tr></tbody></table>` +
      `<table><caption>Beta</caption><tbody><tr><td>B</td></tr></tbody></table>`;
    const result = fixDuplicateTableCaptions(html);
    expect(result).toContain("<caption>Alpha</caption>");
    expect(result).toContain("<caption>Beta</caption>");
    expect(result).not.toContain("of 2");
  });

  it("appends positional suffixes when two tables share the same caption", () => {
    const html =
      `<table><caption>Summary</caption><tbody><tr><td>1</td></tr></tbody></table>` +
      `<table><caption>Summary</caption><tbody><tr><td>2</td></tr></tbody></table>`;
    const result = fixDuplicateTableCaptions(html);
    expect(result).toContain("Summary (1 of 2)");
    expect(result).toContain("Summary (2 of 2)");
  });

  it("handles two independent duplicate groups at the same time", () => {
    const html =
      `<table><caption>Grades</caption><tbody><tr><td>A</td></tr></tbody></table>` +
      `<table><caption>Roster</caption><tbody><tr><td>B</td></tr></tbody></table>` +
      `<table><caption>Grades</caption><tbody><tr><td>C</td></tr></tbody></table>` +
      `<table><caption>Roster</caption><tbody><tr><td>D</td></tr></tbody></table>`;
    const result = fixDuplicateTableCaptions(html);
    expect(result).toContain("Grades (1 of 2)");
    expect(result).toContain("Grades (2 of 2)");
    expect(result).toContain("Roster (1 of 2)");
    expect(result).toContain("Roster (2 of 2)");
  });

  it("skips tables with no caption and still suffixes the duplicates", () => {
    const html =
      `<table><tbody><tr><td>no caption</td></tr></tbody></table>` +
      `<table><caption>Data</caption><tbody><tr><td>X</td></tr></tbody></table>` +
      `<table><caption>Data</caption><tbody><tr><td>Y</td></tr></tbody></table>`;
    const result = fixDuplicateTableCaptions(html);
    expect(result).toContain("Data (1 of 2)");
    expect(result).toContain("Data (2 of 2)");
    const captionCount = (result.match(/<caption/gi) ?? []).length;
    expect(captionCount).toBe(2);
  });

  it("skips whitespace-only captions and does not add suffixes to them", () => {
    const html =
      `<table><caption>   </caption><tbody><tr><td>A</td></tr></tbody></table>` +
      `<table><caption>   </caption><tbody><tr><td>B</td></tr></tbody></table>`;
    const result = fixDuplicateTableCaptions(html);
    expect(result).not.toContain("of 2");
    expect(result).not.toContain("1 of");
  });

  it("preserves original casing in the suffix text", () => {
    const html =
      `<table><caption>Course OUTCOMES</caption><tbody><tr><td>1</td></tr></tbody></table>` +
      `<table><caption>course outcomes</caption><tbody><tr><td>2</td></tr></tbody></table>`;
    const result = fixDuplicateTableCaptions(html);
    expect(result).toContain("Course OUTCOMES (1 of 2)");
    expect(result).toContain("course outcomes (2 of 2)");
  });

  it("uses the correct total when three tables share the same caption", () => {
    const html =
      `<table><caption>Report</caption><tbody><tr><td>a</td></tr></tbody></table>` +
      `<table><caption>Report</caption><tbody><tr><td>b</td></tr></tbody></table>` +
      `<table><caption>Report</caption><tbody><tr><td>c</td></tr></tbody></table>`;
    const result = fixDuplicateTableCaptions(html);
    expect(result).toContain("Report (1 of 3)");
    expect(result).toContain("Report (2 of 3)");
    expect(result).toContain("Report (3 of 3)");
  });
});
