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
// The regex /<table(?:\s[^>]*)?>[\s\S]*?<\/table>/gi uses a non-greedy
// quantifier, so each match runs from the leftmost <table> opening tag to the
// nearest </table>.  For nested tables this means a single match spans from
// the outer table's opening tag to the inner table's closing tag; the
// remaining closing tags of the outer table are not part of that match and
// are therefore never processed as a standalone table block.
// ---------------------------------------------------------------------------
describe("fixHtmlTableCaption — nested tables", () => {
  it("inserts caption after the outer opening tag when neither table has a caption", () => {
    // Match spans: <table> (outer open) … </table> (inner close)
    // The first <table> encountered in that span is the outer opening tag,
    // so the caption is placed there.  The inner <table> tag is inside the
    // matched block and is not independently visited.
    const inner = `<table><tr><td>cell</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const output = fixHtmlTableCaption(outer);

    // Caption is placed immediately after the outer <table> opening tag.
    expect(output).toContain("<table><caption>Table summary</caption>");
    // The inner <table> tag does not receive its own caption in this pass.
    expect(output).not.toContain("<table><caption>Table summary</caption><tr><td><table><caption>");
    // Tag balance is maintained.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("skips the mixed block when the inner table already has a caption, leaving both tables unchanged", () => {
    // The matched block (outer-open → inner-close) contains a <caption>,
    // so the guard `if (/<caption[\s>]/i.test(tableBlock)) return tableBlock`
    // fires and nothing is modified.  The trailing outer </table> is never
    // part of any matched block, so the outer table also remains unchanged.
    const inner = `<table><caption>Inner</caption><tr><td>cell</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    expect(fixHtmlTableCaption(outer)).toBe(outer);
  });

  it("handles two sibling inner tables: first inner block gets caption, second standalone block also gets caption", () => {
    // The regex produces two matches:
    //   Match 1: outer-open … first-inner-close  (no caption → caption added)
    //   Match 2: second-inner-open … second-inner-close (standalone → caption added)
    const inner1 = `<table><tr><td>A</td></tr></table>`;
    const inner2 = `<table><tr><td>B</td></tr></table>`;
    const outer = `<table><tr><td>${inner1}</td><td>${inner2}</td></tr></table>`;
    const output = fixHtmlTableCaption(outer);
    const count = (output.match(/<caption>Table summary<\/caption>/gi) ?? []).length;
    expect(count).toBe(2);
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
    const count = (output.match(/<caption/gi) ?? []).length;
    expect(count).toBe(2); // one from inner1 (new) + one from inner2 (existing)
    expect(output).toContain("<caption>Existing</caption>");
  });

  it("keeps tags balanced for three levels of nesting", () => {
    const deep = `<table><tr><td>d</td></tr></table>`;
    const mid = `<table><tr><td>${deep}</td></tr></table>`;
    const outer = `<table><tr><td>${mid}</td></tr></table>`;
    const output = fixHtmlTableCaption(outer);
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
    // At least one caption is inserted somewhere in the output.
    expect(output).toContain("<caption>Table summary</caption>");
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
// The same non-greedy matching behaviour applies here.  When an outer table
// wraps an inner table, the first regex match runs from the outer <table>
// opening tag to the inner table's </table>.  fixHtmlTableThead then looks
// for the first <tr> inside that mixed block.  Because the outer <tr> appears
// before the inner <tr>, the outer row's cells (which may contain the inner
// table's markup as text content) are what get converted to <th> elements.
// The second match (the remaining standalone closing tags) contains no
// <table> opening and so does not produce a meaningful table block.
// ---------------------------------------------------------------------------
describe("fixHtmlTableThead — nested tables", () => {
  it("inserts <thead> for the mixed block (outer-open to inner-close) when neither table has a <thead>", () => {
    // The regex match: outer <table> … inner </table>
    // The first <tr> inside that block is the outer table's row, so it gets
    // wrapped in <thead>.  The outer row's first cell content (which includes
    // the inner table's opening markup) is converted to a <th scope="col">.
    const inner = `<table><tr><td>IH</td></tr><tr><td>ID</td></tr></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const output = fixHtmlTableThead(outer);

    // A <thead> is present in the output.
    expect(output).toContain("<thead>");
    expect(output).toContain("</thead>");
    // The opening <table> tags (outer + inner) and their matching </table> tags survive.
    expect((output.match(/<table/gi) ?? []).length).toBe(
      (output.match(/<\/table>/gi) ?? []).length
    );
  });

  it("does not modify an inner table that already has a <thead>", () => {
    // When the inner table already has <thead>, the mixed block (outer-open →
    // inner-close) is detected as having a <thead> and returned unchanged.
    // The second regex match consists only of the outer trailing tags which
    // contain no <table> opening and are therefore also unchanged.
    const inner = `<table><thead><tr><th>IH</th></tr></thead><tbody><tr><td>ID</td></tr></tbody></table>`;
    const outer = `<table><tr><td>${inner}</td></tr></table>`;
    const output = fixHtmlTableThead(outer);

    // The inner thead content must be preserved intact.
    expect(output).toContain("<thead><tr><th>IH</th></tr></thead>");
    // No extra thead is inserted.
    expect((output.match(/<thead/gi) ?? []).length).toBe(1);
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
