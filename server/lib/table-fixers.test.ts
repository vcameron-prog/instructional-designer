import { describe, it, expect } from "vitest";
import { fixHtmlTableCaption, fixHtmlTableThead } from "./table-fixers.js";

// ---------------------------------------------------------------------------
// fixHtmlTableCaption — flat tables
// ---------------------------------------------------------------------------
describe("fixHtmlTableCaption — flat tables", () => {
  it("adds a caption after the opening tag of a table that has none", () => {
    const input = `<table><tr><td>A</td></tr></table>`;
    const output = fixHtmlTableCaption(input);
    expect(output).toBe(
      `<table><caption>Table summary</caption>\n<tr><td>A</td></tr></table>`
    );
  });

  it("leaves a table that already has a <caption> unchanged", () => {
    const input = `<table><caption>My caption</caption><tr><td>A</td></tr></table>`;
    expect(fixHtmlTableCaption(input)).toBe(input);
  });

  it("handles a table opening tag that carries attributes", () => {
    const input = `<table class="data"><tr><td>A</td></tr></table>`;
    const output = fixHtmlTableCaption(input);
    expect(output).toContain('<table class="data"><caption>Table summary</caption>');
  });

  it("adds captions to multiple sibling flat tables independently", () => {
    const input = `<table><tr><td>T1</td></tr></table>\n<table><tr><td>T2</td></tr></table>`;
    const output = fixHtmlTableCaption(input);
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(2);
  });

  it("does not add a second caption to a table that already has one", () => {
    const input = `<table><caption>Existing</caption><tr><td>A</td></tr></table>`;
    expect(fixHtmlTableCaption(input)).toBe(input);
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
    const output = fixHtmlTableCaption(outer);

    // Both tables get a caption.
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(2);
    // Tag balance is maintained.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("adds a caption to the outer table even when the inner table already has one", () => {
    // Inner already has a caption so it is left alone; outer still needs one.
    const inner = `<table><caption>Inner</caption><tr><td>cell</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const output = fixHtmlTableCaption(outer);

    // Outer now has a caption; inner's caption is preserved unchanged.
    expect(output).toContain("<caption>Table summary</caption>");
    expect(output).toContain("<caption>Inner</caption>");
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
    const output = fixHtmlTableCaption(outer);
    // outer + inner1 + inner2 each get a caption.
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(3);
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("does not add a duplicate caption when the second inner sibling already has one", () => {
    const inner1 = `<table><tr><td>A</td></tr></table>`;
    const inner2 = `<table><caption>Existing</caption><tr><td>B</td></tr></table>`;
    const outer = `<table><tr><td>${inner1}</td><td>${inner2}</td></tr></table>`;
    const output = fixHtmlTableCaption(outer);
    // inner2 already has a caption — it must not gain a second one.
    // outer + inner1 each gain a new caption; inner2 keeps its existing one.
    const count = (output.match(/<caption/gi) ?? []).length;
    expect(count).toBe(3); // outer (new) + inner1 (new) + inner2 (existing)
    expect(output).toContain("<caption>Existing</caption>");
  });

  it("keeps tags balanced for three levels of nesting and adds a caption to every table", () => {
    const deep = `<table><tr><td>d</td></tr></table>`;
    const mid = `<table><tr><td>${deep}</td></tr></table>`;
    const outer = `<table><tr><td>${mid}</td></tr></table>`;
    const output = fixHtmlTableCaption(outer);
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
    // All three tables receive a caption.
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// fixHtmlTableThead — flat tables
// ---------------------------------------------------------------------------
describe("fixHtmlTableThead — flat tables", () => {
  it("wraps the first <tr> in a <thead> and converts its cells to <th scope=col>", () => {
    const input = `<table><tr><td>Col A</td><td>Col B</td></tr><tr><td>1</td><td>2</td></tr></table>`;
    const output = fixHtmlTableThead(input);
    expect(output).toContain("<thead>");
    expect(output).toContain("</thead>");
    expect(output).toContain('<th scope="col">Col A</th>');
    expect(output).toContain('<th scope="col">Col B</th>');
    expect(output).toContain("<td>1</td>");
  });

  it("leaves a table that already has a <thead> unchanged", () => {
    const input = `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>`;
    expect(fixHtmlTableThead(input)).toBe(input);
  });

  it("promotes the first <tr> out of <tbody> when there is no <thead>", () => {
    const input = `<table><tbody><tr><td>H1</td></tr><tr><td>D1</td></tr></tbody></table>`;
    const output = fixHtmlTableThead(input);
    expect(output).toContain("<thead>");
    expect(output).toContain('<th scope="col">H1</th>');
    expect(output).toContain("<td>D1</td>");
    expect((output.match(/<thead/gi) ?? []).length).toBe(1);
  });

  it("adds <thead> to each of multiple sibling flat tables that lack one", () => {
    const t1 = `<table><tr><td>H1</td></tr></table>`;
    const t2 = `<table><tr><td>H2</td></tr></table>`;
    const output = fixHtmlTableThead(`${t1}\n${t2}`);
    expect((output.match(/<thead/gi) ?? []).length).toBe(2);
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
    const output = fixHtmlTableThead(outer);

    // Both tables get a <thead>.
    expect((output.match(/<thead/gi) ?? []).length).toBe(2);
    expect(output).toContain("</thead>");
    // The opening <table> tags (outer + inner) and their matching </table> tags survive.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("adds a <thead> to the outer table while leaving the inner table's existing <thead> intact", () => {
    // Inner already has a thead so it is skipped; outer still needs one.
    const inner = `<table><thead><tr><th>IH</th></tr></thead><tbody><tr><td>ID</td></tr></tbody></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const output = fixHtmlTableThead(outer);

    // The inner thead content must be preserved intact.
    expect(output).toContain("<thead><tr><th>IH</th></tr></thead>");
    // Outer gets its own new thead — two theads total.
    expect((output.match(/<thead/gi) ?? []).length).toBe(2);
    // Tags remain balanced.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("does not modify either table when both already have a <thead>", () => {
    const inner = `<table><thead><tr><th>IH</th></tr></thead><tbody><tr><td>ID</td></tr></tbody></table>`;
    const outer = `<table><thead><tr><th>OH</th></tr></thead><tbody><tr><td>${inner}</td></tr></tbody></table>`;
    expect(fixHtmlTableThead(outer)).toBe(outer);
  });

  it("preserves the existing <thead> of a second standalone inner sibling", () => {
    // First match: outer-open … first-inner-close (no thead → thead inserted).
    // Second match: second-inner (standalone block — it already has a thead → unchanged).
    const inner1 = `<table><tr><td>H1</td></tr><tr><td>D1</td></tr></table>`;
    const inner2 = `<table><thead><tr><th>H2</th></tr></thead><tbody><tr><td>D2</td></tr></tbody></table>`;
    const outer = `<table><tr><td>${inner1}</td><td>${inner2}</td></tr></table>`;
    const output = fixHtmlTableThead(outer);

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
    const output = fixHtmlTableThead(outer);

    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
    // At least one <thead> is inserted somewhere in the output.
    expect(output).toContain("<thead>");
  });
});
