import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import {
  runDeterministicChecks,
  buildComplianceReport,
  evaluateOriginalDocument,
  fixComplianceIssue,
  fixAllAriaRoleMisuse,
  applyAriaRoleHeaderFix,
  applyAriaComboboxRoleFix,
  applyAriaGridRoleFix,
  applyAriaTabRoleFix,
  applyDeterministicReport,
  applyAriaLinkRoleFix,
  applyAriaCheckboxRoleFix,
  applyAriaRadioRoleFix,
  applyAriaListRoleFix,
  applyAriaListitemRoleFix,
  applyAriaButtonRoleFix,
  applyAriaHeadingRoleFix,
  analyzeAriaHeadingFallbacks,
  applyBypassBlocksFix,
  applyLangAttributeFix,
  applyPageTitleFix,
  extractPageTitleInfo,
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  checkHeadingOrder,
  ensureAltText,
  injectImageData,
  ensureMissingImages,
  registerDeterministicFixer,
  type ComplianceIssue,
  type ComplianceReport,
} from "./accessibility-engine.js";
import type { ExtractedImage } from "./pdf-processor.js";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => {
  function MockAnthropic() {
    return { messages: { create: mockCreate } };
  }
  return { default: MockAnthropic };
});

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function makeImage(name: string, dataUrl = `data:image/png;base64,${name}`): ExtractedImage {
  return { name, dataUrl, pageNumber: 1, width: 100, height: 100 };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

// ---------------------------------------------------------------------------
// runDeterministicChecks
// ---------------------------------------------------------------------------

describe("runDeterministicChecks", () => {
  // 3.1.1 Language of Page
  describe("criterion 3.1.1 – Language of Page", () => {
    it("passes when <html> has a lang attribute", () => {
      const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Hello</h1></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const lang = issues.find((i) => i.criterion === "3.1.1");
      expect(lang).toBeDefined();
      expect(lang!.status).toBe("pass");
    });

    it("fails when <html> has no lang attribute", () => {
      const html = `<!DOCTYPE html><html><head><title>Test</title></head><body><main><h1>Hello</h1></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const lang = issues.find((i) => i.criterion === "3.1.1");
      expect(lang!.status).toBe("fail");
    });

    it("passes with lang attribute using hyphenated locale", () => {
      const html = `<html lang="en-US"><head></head><body></body></html>`;
      const issues = runDeterministicChecks(html);
      const lang = issues.find((i) => i.criterion === "3.1.1");
      expect(lang!.status).toBe("pass");
    });
  });

  // 2.4.2 Page Titled
  describe("criterion 2.4.2 – Page Titled", () => {
    it("passes when a non-empty <title> is present", () => {
      const html = `<html lang="en"><head><title>My Document</title></head><body></body></html>`;
      const issues = runDeterministicChecks(html);
      const titled = issues.find((i) => i.criterion === "2.4.2");
      expect(titled!.status).toBe("pass");
    });

    it("fails when <title> is absent", () => {
      const html = `<html lang="en"><head></head><body></body></html>`;
      const issues = runDeterministicChecks(html);
      const titled = issues.find((i) => i.criterion === "2.4.2");
      expect(titled!.status).toBe("fail");
    });

    it("fails when <title> is empty", () => {
      const html = `<html lang="en"><head><title></title></head><body></body></html>`;
      const issues = runDeterministicChecks(html);
      const titled = issues.find((i) => i.criterion === "2.4.2");
      expect(titled!.status).toBe("fail");
    });
  });

  // 2.4.6 Headings and Labels
  describe("criterion 2.4.6 – Headings and Labels", () => {
    it("passes when an <h1> exists", () => {
      const html = `<html lang="en"><body><h1>Main Heading</h1></body></html>`;
      const issues = runDeterministicChecks(html);
      const headings = issues.find((i) => i.criterion === "2.4.6");
      expect(headings!.status).toBe("pass");
    });

    it("fails when no <h1> is present", () => {
      const html = `<html lang="en"><body><h2>Sub Heading</h2></body></html>`;
      const issues = runDeterministicChecks(html);
      const headings = issues.find((i) => i.criterion === "2.4.6");
      expect(headings!.status).toBe("fail");
    });

    it("details mention the count of h1 elements", () => {
      const html = `<html lang="en"><body><h1>First</h1><h1>Second</h1></body></html>`;
      const issues = runDeterministicChecks(html);
      const headings = issues.find((i) => i.criterion === "2.4.6");
      expect(headings!.details).toContain("2");
    });

    it("correctly detects a non-empty h1 whose open tag contains an attribute value with '>'", () => {
      const html = `<html lang="en"><body><h1 data-cmp="x>y">Real Heading</h1></body></html>`;
      const issues = runDeterministicChecks(html);
      const headings = issues.find((i) => i.criterion === "2.4.6");
      expect(headings!.status).toBe("pass");
    });
  });

  // 2.4.1 Bypass Blocks
  describe("criterion 2.4.1 – Bypass Blocks", () => {
    it("passes when a <main> landmark is present", () => {
      const html = `<html lang="en"><body><main><h1>Content</h1></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const bypass = issues.find((i) => i.criterion === "2.4.1");
      expect(bypass!.status).toBe("pass");
    });

    it("passes when role='main' is used instead of <main>", () => {
      const html = `<html lang="en"><body><div role="main"><h1>Content</h1></div></body></html>`;
      const issues = runDeterministicChecks(html);
      const bypass = issues.find((i) => i.criterion === "2.4.1");
      expect(bypass!.status).toBe("pass");
    });

    it("warns when no landmark is present", () => {
      const html = `<html lang="en"><body><div><h1>Content</h1></div></body></html>`;
      const issues = runDeterministicChecks(html);
      const bypass = issues.find((i) => i.criterion === "2.4.1");
      expect(bypass!.status).toBe("warning");
    });
  });

  // 1.1.1 Image Descriptions (alt text)
  describe("criterion 1.1.1 – Image Descriptions", () => {
    it("passes when there are no images", () => {
      const html = `<html lang="en"><body><p>No images here</p></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("pass");
      expect(altCheck!.details).toBe("No images were found in the document.");
    });

    it("passes when all images have alt attributes", () => {
      const html = `<html lang="en"><body><img src="photo.jpg" alt="A photo of a cat"></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("pass");
      expect(altCheck!.details).toBe("All 1 image(s) have text descriptions.");
    });

    it("pass details scales with the actual image count", () => {
      const html = `<html lang="en"><body>
        <img src="a.jpg" alt="Image A">
        <img src="b.jpg" alt="Image B">
        <img src="c.jpg" alt="Image C">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("pass");
      expect(altCheck!.details).toBe("All 3 image(s) have text descriptions.");
    });

    it("fails when an image is missing its alt attribute", () => {
      const html = `<html lang="en"><body><img src="photo.jpg"></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
    });

    it("passes when an img has a backtick-quoted attribute before alt", () => {
      const html = `<html lang="en"><body><img class=\`hero\` src="photo.jpg" alt="A cat"></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("pass");
    });

    it("fails when some images are missing alt and reports the count and filenames", () => {
      const html = `<html lang="en"><body>
        <img src="a.jpg" alt="Image A">
        <img src="b.jpg">
        <img src="c.jpg">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.details).toContain("2 of 3");
      expect(altCheck!.details).toContain('"b.jpg"');
      expect(altCheck!.details).toContain('"c.jpg"');
    });

    it("lists only the filename (not full path) for images with path-style src", () => {
      const html = `<html lang="en"><body>
        <img src="/assets/images/hero-banner.png">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.details).toContain('"hero-banner.png"');
    });

    it("falls back to positional label when image has an empty src", () => {
      const html = `<html lang="en"><body>
        <img src="">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.details).toContain("no src");
    });

    it("does not populate imageItems when all images have alt text", () => {
      const html = `<html lang="en"><body><img src="photo.jpg" alt="A cat"></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("pass");
      expect(altCheck!.imageItems).toBeUndefined();
    });

    it("does not populate imageItems when there are no images", () => {
      const html = `<html lang="en"><body><p>No images</p></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("pass");
      expect(altCheck!.imageItems).toBeUndefined();
    });

    it("populates imageItems with correct label and src for missing-alt images", () => {
      const html = `<html lang="en"><body>
        <img src="/assets/logo.png">
        <img src="/assets/hero.jpg">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.imageItems).toHaveLength(2);
      expect(altCheck!.imageItems![0]).toMatchObject({
        label: 'Image 1 ("logo.png")',
        src: "/assets/logo.png",
        originalIndex: 0,
      });
      expect(altCheck!.imageItems![1]).toMatchObject({
        label: 'Image 2 ("hero.jpg")',
        src: "/assets/hero.jpg",
        originalIndex: 1,
      });
    });

    it("sets correct originalIndex when only some images are missing alt text", () => {
      const html = `<html lang="en"><body>
        <img src="a.jpg" alt="Image A">
        <img src="b.jpg">
        <img src="c.jpg">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.imageItems).toHaveLength(2);
      expect(altCheck!.imageItems![0].originalIndex).toBe(1);
      expect(altCheck!.imageItems![1].originalIndex).toBe(2);
    });

    it("omits src from imageItems for data URL images and uses positional label", () => {
      const html = `<html lang="en"><body>
        <img src="data:image/png;base64,abc123">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.imageItems).toHaveLength(1);
      expect(altCheck!.imageItems![0].src).toBeUndefined();
      expect(altCheck!.imageItems![0].label).toBe("Image 1 (no src)");
      expect(altCheck!.imageItems![0].originalIndex).toBe(0);
    });

    it("decodes percent-encoded emoji filename in imageItems label", () => {
      const html = `<html lang="en"><body>
        <img src="/images/%F0%9F%98%80.png">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.imageItems).toHaveLength(1);
      expect(altCheck!.imageItems![0].label).toBe('Image 1 ("😀.png")');
    });

    it("decodes percent-encoded CJK filename in imageItems label", () => {
      const html = `<html lang="en"><body>
        <img src="/images/%E6%96%87%E4%BB%B6.png">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.imageItems).toHaveLength(1);
      expect(altCheck!.imageItems![0].label).toBe('Image 1 ("文件.png")');
    });

    it("leaves undecodable percent-encoded filenames as-is in imageItems label", () => {
      const html = `<html lang="en"><body>
        <img src="/images/%ZZ.png">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.imageItems).toHaveLength(1);
      expect(altCheck!.imageItems![0].label).toBe('Image 1 ("%ZZ.png")');
    });
  });

  // 1.3.1 Document Structure
  describe("criterion 1.3.1 – Document Structure", () => {
    it("passes when semantic elements and headings are both present", () => {
      const html = `<html lang="en"><body><main><h1>Title</h1><section><h2>Section</h2><p>Text</p></section></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const struct = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Document Structure"
      );
      expect(struct!.status).toBe("pass");
    });

    it("warns when semantic elements are absent", () => {
      const html = `<html lang="en"><body><div><h1>Title</h1></div></body></html>`;
      const issues = runDeterministicChecks(html);
      const struct = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Document Structure"
      );
      expect(struct!.status).toBe("warning");
    });

    it("warns when headings are absent even if semantic elements are present", () => {
      const html = `<html lang="en"><body><main><p>No headings here</p></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const struct = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Document Structure"
      );
      expect(struct!.status).toBe("warning");
    });
  });

  // 1.3.2 Reading Order
  describe("criterion 1.3.2 – Reading Order", () => {
    it("passes when no absolutely positioned divs are present", () => {
      const html = `<html lang="en"><body><main><h1>Content</h1></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const order = issues.find((i) => i.criterion === "1.3.2");
      expect(order!.status).toBe("pass");
    });

    it("warns when a div has inline position:absolute style", () => {
      const html = `<html lang="en"><body><div style="position: absolute; top: 0">Floated</div></body></html>`;
      const issues = runDeterministicChecks(html);
      const order = issues.find((i) => i.criterion === "1.3.2");
      expect(order!.status).toBe("warning");
    });

    it("passes when a non-div element uses position:absolute (rule only checks div)", () => {
      const html = `<html lang="en"><body><span style="position: absolute; top: 0">Floated span</span></body></html>`;
      const issues = runDeterministicChecks(html);
      const order = issues.find((i) => i.criterion === "1.3.2");
      expect(order!.status).toBe("pass");
    });
  });

  // 1.3.1 Table Headers
  describe("criterion 1.3.1 – Table Headers", () => {
    it("is not included when no tables exist", () => {
      const html = `<html lang="en"><body><p>No tables</p></body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue).toBeUndefined();
    });

    it("passes when tables have <th> elements", () => {
      const html = `<html lang="en"><body><table><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td>Alice</td></tr></tbody></table></body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue).toBeDefined();
      expect(tableIssue!.status).toBe("pass");
    });

    it("fails when tables lack <th> elements", () => {
      const html = `<html lang="en"><body><table><tr><td>Name</td></tr><tr><td>Alice</td></tr></table></body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue!.status).toBe("fail");
    });

    it("fails when some tables have <th> elements but others do not", () => {
      const html = `<html lang="en"><body>
        <table><thead><tr><th scope="col">Name</th><th scope="col">Score</th></tr></thead><tbody><tr><td>Alice</td><td>95</td></tr></tbody></table>
        <table><tr><td>Item A</td><td>$10</td></tr><tr><td>Item B</td><td>$20</td></tr></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue).toBeDefined();
      expect(tableIssue!.status).toBe("fail");
      expect(tableIssue!.details).toMatch(/Table 2/);
    });

    it("details includes caption text when a failing table has a <caption>", () => {
      const html = `<html lang="en"><body>
        <table>
          <caption>Annual Budget</caption>
          <tr><td>Q1</td><td>100</td></tr>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue!.status).toBe("fail");
      expect(tableIssue!.details).toContain('caption: "Annual Budget"');
    });

    it("details includes id attribute when a failing table has an id but no caption", () => {
      const html = `<html lang="en"><body>
        <table id="pricing-table">
          <tr><td>Basic</td><td>$9</td></tr>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue!.status).toBe("fail");
      expect(tableIssue!.details).toContain('id="pricing-table"');
    });

    it("details includes row×col count when a failing table has no caption or id", () => {
      const html = `<html lang="en"><body>
        <table>
          <tr><td>A</td><td>B</td><td>C</td></tr>
          <tr><td>1</td><td>2</td><td>3</td></tr>
          <tr><td>4</td><td>5</td><td>6</td></tr>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue!.status).toBe("fail");
      expect(tableIssue!.details).toMatch(/3 rows × 3 cols/);
    });

    it("details lists multiple failing tables with individual identifiers", () => {
      const html = `<html lang="en"><body>
        <table id="t1"><tr><td>X</td></tr></table>
        <table><caption>Summary Table</caption><tr><td>Y</td></tr></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue!.status).toBe("fail");
      expect(tableIssue!.details).toContain('id="t1"');
      expect(tableIssue!.details).toContain('caption: "Summary Table"');
    });

    it("evaluates outer and inner tables independently when tables are nested", () => {
      // Outer table has a <th>, inner table does not — should fail because the inner table lacks headers
      const html = `<html lang="en"><body>
        <table>
          <thead><tr><th scope="col">Outer Header</th></tr></thead>
          <tbody>
            <tr><td>
              <table>
                <tr><td>Inner Cell A</td><td>Inner Cell B</td></tr>
              </table>
            </td></tr>
          </tbody>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue).toBeDefined();
      // Inner table has no <th>, so the check must fail
      expect(tableIssue!.status).toBe("fail");
      // 2 tables total: outer + inner
      expect(tableIssue!.details).toMatch(/2 table/);
      // Only the outer table is missing headers; the inner table passes
      expect(tableIssue!.details).toMatch(/^Found 1 of 2/);
    });

    it("fails the outer table when <th> elements exist only inside a nested table", () => {
      // The outer table has NO direct <th> — all <th> elements belong to the inner table.
      // The engine must not count the inner table's <th> as headers for the outer table.
      const html = `<html lang="en"><body>
        <table>
          <tbody>
            <tr><td>
              <table>
                <thead><tr><th scope="col">Inner Header A</th><th scope="col">Inner Header B</th></tr></thead>
                <tbody><tr><td>Cell A</td><td>Cell B</td></tr></tbody>
              </table>
            </td></tr>
          </tbody>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const tableIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableIssue).toBeDefined();
      // Outer table has no direct <th>, so the check must fail even though
      // the nested inner table does have properly marked-up headers.
      expect(tableIssue!.status).toBe("fail");
      // 2 tables total: outer + inner
      expect(tableIssue!.details).toMatch(/2 table/);
      // Only the outer table is missing headers; the inner table passes
      expect(tableIssue!.details).toMatch(/^Found 1 of 2/);
    });

    it("warns when a table's first row uses only <td> stand-in headers instead of <th>", () => {
      const html = `<html lang="en"><body>
        <table>
          <tr><td><strong>Name</strong></td><td><strong>Score</strong></td></tr>
          <tr><td>Alice</td><td>95</td></tr>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const markupIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Header Markup"
      );
      expect(markupIssue).toBeDefined();
      expect(markupIssue!.status).toBe("warning");
      expect(markupIssue!.details).toBe(`Found 1 table(s) whose first row uses only <td> cells. If these cells act as column headers, replace them with <th scope="col"> for proper accessibility.`);
    });

    it("does not warn about Table Header Markup when the first row uses <th> elements", () => {
      const html = `<html lang="en"><body>
        <table><thead><tr><th scope="col">Name</th><th scope="col">Score</th></tr></thead><tbody><tr><td>Alice</td><td>95</td></tr></tbody></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const markupIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Header Markup"
      );
      expect(markupIssue).toBeUndefined();
      const tableHeadersIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableHeadersIssue!.status).toBe("pass");
      expect(tableHeadersIssue!.details).toBe("Found 1 table(s) with properly labeled headers.");
    });

    it("warns when a table uses <td role=\"columnheader\"> instead of <th>", () => {
      const html = `<html lang="en"><body>
        <table>
          <tr>
            <td role="columnheader">Name</td>
            <td role="columnheader">Score</td>
          </tr>
          <tr><td>Alice</td><td>95</td></tr>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const ariaIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell"
      );
      expect(ariaIssue).toBeDefined();
      expect(ariaIssue!.status).toBe("warning");
      expect(ariaIssue!.details).toBe(`Found 1 table(s) with <td> cells using ARIA header roles. Replace these cells with <th scope="col"> or <th scope="row"> for proper semantic markup.`);
    });

    it("warns when a table uses <td role=\"rowheader\"> instead of <th>", () => {
      const html = `<html lang="en"><body>
        <table>
          <tr><td role="rowheader">Alice</td><td>95</td></tr>
          <tr><td role="rowheader">Bob</td><td>88</td></tr>
        </table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const ariaIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell"
      );
      expect(ariaIssue).toBeDefined();
      expect(ariaIssue!.status).toBe("warning");
    });

    it("does not warn about ARIA Role on Table Data Cell when proper <th> elements are used", () => {
      const html = `<html lang="en"><body>
        <table><thead><tr><th scope="col">Name</th><th scope="col">Score</th></tr></thead><tbody><tr><td>Alice</td><td>95</td></tr></tbody></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const ariaIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell"
      );
      expect(ariaIssue).toBeUndefined();
      const tableHeadersIssue = issues.find(
        (i) => i.criterion === "1.3.1" && i.title === "Table Headers"
      );
      expect(tableHeadersIssue!.status).toBe("pass");
      expect(tableHeadersIssue!.details).toBe("Found 1 table(s) with properly labeled headers.");
    });
  });

  // 1.3.1 Duplicate Table Captions
  describe("criterion 1.3.1 – Duplicate Table Captions", () => {
    it("warns when two tables share the same caption text", () => {
      const html = `<html lang="en"><body>
        <table><caption>Student Grades</caption><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Alice</td></tr></tbody></table>
        <table><caption>Student Grades</caption><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Bob</td></tr></tbody></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("Table 1");
      expect(issue!.details).toContain("Table 2");
      expect(issue!.details).toContain("student grades");
    });

    it("treats duplicate detection as case-insensitive", () => {
      const html = `<html lang="en"><body>
        <table><caption>Summary</caption><thead><tr><th>Col</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table>
        <table><caption>SUMMARY</caption><thead><tr><th>Col</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
    });

    it("does not warn when all captions are unique", () => {
      const html = `<html lang="en"><body>
        <table><caption>Table One</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
        <table><caption>Table Two</caption><thead><tr><th>B</th></tr></thead><tbody><tr><td>2</td></tr></tbody></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions");
      expect(issue).toBeUndefined();
    });

    it("does not warn when there are no tables with captions", () => {
      const html = `<html lang="en"><body><p>No tables here.</p></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions");
      expect(issue).toBeUndefined();
    });

    it("reports multiple duplicate groups when more than one caption is shared", () => {
      const html = `<html lang="en"><body>
        <table><caption>Grades</caption><thead><tr><th>N</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table>
        <table><caption>Grades</caption><thead><tr><th>N</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>
        <table><caption>Schedule</caption><thead><tr><th>D</th></tr></thead><tbody><tr><td>Mon</td></tr></tbody></table>
        <table><caption>Schedule</caption><thead><tr><th>D</th></tr></thead><tbody><tr><td>Tue</td></tr></tbody></table>
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions");
      expect(issue).toBeDefined();
      expect(issue!.details).toContain("2 group(s)");
    });
  });

  // 4.1.2 ARIA Button Role on Non-Button Element
  describe("criterion 4.1.2 – ARIA Button Role on Non-Button Element", () => {
    it("warns when a <div> uses role=\"button\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="button">Click me</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("4.1.2");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when a <span> uses role=\"button\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><span role="button">Submit</span></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("<span>");
    });

    it("warns and counts multiple non-button elements with role=\"button\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1>
        <div role="button">A</div>
        <span role="button">B</span>
        <a role="button" href="#">C</a>
      </main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeDefined();
      expect(issue!.details).toContain("3 element(s)");
    });

    it("does not warn when a native <button> element is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><button type="button">Click me</button></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <button role=\"button\"> is used (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><button role="button">OK</button></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeUndefined();
    });

    it("does not emit the issue when no role=\"button\" is present at all", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><p>No buttons here</p></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <input type=\"submit\" role=\"button\"> is used (button-capable input)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="submit" role="button" value="Save"></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <input type=\"reset\" role=\"button\"> is used (button-capable input)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="reset" role="button" value="Clear"></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeUndefined();
    });

    it("warns when <input type=\"text\" role=\"button\"> is used (text input is not button-capable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="text" role="button"></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
    });
  });

  // 1.3.1 ARIA Heading Role on Non-Heading Element
  describe("criterion 1.3.1 – ARIA Heading Role on Non-Heading Element", () => {
    it("warns when a <div> uses role=\"heading\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="heading" aria-level="2">Section Title</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("1.3.1");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when a <span> uses role=\"heading\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><span role="heading">Title</span></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("<span>");
    });

    it("warns and counts multiple non-heading elements with role=\"heading\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1>
        <div role="heading" aria-level="2">Section A</div>
        <p role="heading" aria-level="3">Section B</p>
      </main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeDefined();
      expect(issue!.details).toContain("2 element(s)");
    });

    it("does not warn when native <h1>–<h6> elements are used", () => {
      const html = `<html lang="en"><body><main><h1>Title</h1><h2>Section</h2></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when role=\"heading\" is placed on an <h2> (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Title</h1><h2 role="heading">Section</h2></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeUndefined();
    });

    it("does not emit the issue when no role=\"heading\" is present at all", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><p>Content</p></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeUndefined();
    });
  });

  // 4.1.2 ARIA Link Role on Non-Anchor Element
  describe("criterion 4.1.2 – ARIA Link Role on Non-Anchor Element", () => {
    it("warns when a <div> uses role=\"link\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="link" tabindex="0">Go somewhere</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("4.1.2");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when a <span> uses role=\"link\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><span role="link">Click me</span></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("<span>");
    });

    it("does not warn when a native <a> uses role=\"link\" (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><a href="#" role="link">Link</a></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when no role=\"link\" is present", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><a href="#">Native link</a></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
      expect(issue).toBeUndefined();
    });
  });

  // 4.1.2 ARIA Checkbox Role on Non-Input Element
  describe("criterion 4.1.2 – ARIA Checkbox Role on Non-Input Element", () => {
    it("warns when a <div> uses role=\"checkbox\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="checkbox" aria-checked="false">Option</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("4.1.2");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when an <input type=\"radio\"> uses role=\"checkbox\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="radio" role="checkbox"/></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
    });

    it("does not warn when a native <input type=\"checkbox\"> is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="checkbox"/></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <input type=\"checkbox\"> also carries role=\"checkbox\" (redundant)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="checkbox" role="checkbox"/></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
      expect(issue).toBeUndefined();
    });
  });

  // 4.1.2 ARIA Radio Role on Non-Input Element
  describe("criterion 4.1.2 – ARIA Radio Role on Non-Input Element", () => {
    it("warns when a <span> uses role=\"radio\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><span role="radio" aria-checked="false">Choice</span></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("4.1.2");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<span>");
    });

    it("warns when an <input type=\"checkbox\"> uses role=\"radio\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="checkbox" role="radio"/></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
    });

    it("does not warn when a native <input type=\"radio\"> is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="radio"/></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <input type=\"radio\"> also carries role=\"radio\" (redundant)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input type="radio" role="radio"/></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
      expect(issue).toBeUndefined();
    });
  });

  // 1.3.1 ARIA List Role on Non-List Element
  describe("criterion 1.3.1 – ARIA List Role on Non-List Element", () => {
    it("warns when a <div> uses role=\"list\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="list"><div role="listitem">Item</div></div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("1.3.1");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("does not warn when a native <ul> is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><ul><li>Item</li></ul></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when a native <ol> is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><ol><li>Item</li></ol></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <ul> also carries role=\"list\" (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><ul role="list"><li>Item</li></ul></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
      expect(issue).toBeUndefined();
    });
  });

  // 1.3.1 ARIA Listitem Role on Non-Listitem Element
  describe("criterion 1.3.1 – ARIA Listitem Role on Non-Listitem Element", () => {
    it("warns when a <div> uses role=\"listitem\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><ul><div role="listitem">Item</div></ul></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("1.3.1");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when a <span> uses role=\"listitem\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><ul><span role="listitem">Item</span></ul></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("<span>");
    });

    it("does not warn when a native <li> is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><ul><li>Item</li></ul></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <li> also carries role=\"listitem\" (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><ul><li role="listitem">Item</li></ul></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
      expect(issue).toBeUndefined();
    });
  });

  // 1.3.1 ARIA Combobox Role on Non-Combobox Element
  describe("criterion 1.3.1 – ARIA Combobox Role on Non-Combobox Element", () => {
    it("warns when a <div> uses role=\"combobox\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="combobox">Choose</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("1.3.1");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when a <span> uses role=\"combobox\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><span role="combobox">Choose</span></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("<span>");
    });

    it("does not warn when a native <select> is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><select><option>A</option></select></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <input> carries role=\"combobox\" (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><input role="combobox" /></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <select> carries role=\"combobox\" (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><select role="combobox"><option>A</option></select></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
      expect(issue).toBeUndefined();
    });
  });

  // 1.3.1 ARIA Grid Role on Non-Table Element
  describe("criterion 1.3.1 – ARIA Grid Role on Non-Table Element", () => {
    it("warns when a <div> uses role=\"grid\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="grid"><div>Cell</div></div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("1.3.1");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when a <section> uses role=\"grid\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><section role="grid"></section></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("<section>");
    });

    it("does not warn when a native <table> is used", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><table><tr><td>Cell</td></tr></table></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when <table> carries role=\"grid\" (redundant but acceptable)", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><table role="grid"><tr><td>Cell</td></tr></table></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
      expect(issue).toBeUndefined();
    });
  });

  // 1.3.1 ARIA Tab Role on Non-Interactive Element
  describe("criterion 1.3.1 – ARIA Tab Role on Non-Interactive Element", () => {
    it("warns when a <div> uses role=\"tab\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="tab">Tab</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
      expect(issue).toBeDefined();
      expect(issue!.criterion).toBe("1.3.1");
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("1 element(s)");
      expect(issue!.details).toContain("<div>");
    });

    it("warns when a <span> uses role=\"tab\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><span role="tab">Tab</span></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
      expect(issue).toBeDefined();
      expect(issue!.status).toBe("warning");
      expect(issue!.details).toContain("<span>");
    });

    it("does not warn when a native <button> carries role=\"tab\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><button role="tab">Tab</button></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
      expect(issue).toBeUndefined();
    });

    it("does not warn when a native <a> carries role=\"tab\"", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><a href="#" role="tab">Tab</a></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
      expect(issue).toBeUndefined();
    });
  });

  // Details string format — must be parseable by the frontend diff-preview regexes
  describe("ARIA misuse details string parseability", () => {
    const COUNT_RE = /Found (\d+) element/;
    const TAGS_RE = /\(e\.g\. ([^)]+)\)/;

    it("button: details contains the count pattern and the (e.g. …) tag list", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="button">Click</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue).toBeDefined();
      expect(issue!.details).toMatch(COUNT_RE);
      expect(issue!.details).toMatch(TAGS_RE);
      const count = parseInt(issue!.details!.match(COUNT_RE)![1], 10);
      expect(count).toBeGreaterThan(0);
      const tags = issue!.details!.match(TAGS_RE)![1].split(", ").map((t) => t.trim());
      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toBe("<div>");
    });

    it("heading: details contains the count pattern and the (e.g. …) tag list", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="heading" aria-level="2">Heading</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeDefined();
      expect(issue!.details).toMatch(COUNT_RE);
      expect(issue!.details).toMatch(TAGS_RE);
      const count = parseInt(issue!.details!.match(COUNT_RE)![1], 10);
      expect(count).toBeGreaterThan(0);
      const tags = issue!.details!.match(TAGS_RE)![1].split(", ").map((t) => t.trim());
      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toBe("<div>");
    });

    it("combobox: details contains the count pattern and the (e.g. …) tag list", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="combobox">Choose</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
      expect(issue).toBeDefined();
      expect(issue!.details).toMatch(COUNT_RE);
      expect(issue!.details).toMatch(TAGS_RE);
      const count = parseInt(issue!.details!.match(COUNT_RE)![1], 10);
      expect(count).toBeGreaterThan(0);
      const tags = issue!.details!.match(TAGS_RE)![1].split(", ").map((t) => t.trim());
      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toBe("<div>");
    });

    it("grid: details contains the count pattern and the (e.g. …) tag list", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="grid"><div>Cell</div></div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
      expect(issue).toBeDefined();
      expect(issue!.details).toMatch(COUNT_RE);
      expect(issue!.details).toMatch(TAGS_RE);
      const count = parseInt(issue!.details!.match(COUNT_RE)![1], 10);
      expect(count).toBeGreaterThan(0);
      const tags = issue!.details!.match(TAGS_RE)![1].split(", ").map((t) => t.trim());
      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toBe("<div>");
    });

    it("tab: details contains the count pattern and the (e.g. …) tag list", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="tab">Tab</div></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
      expect(issue).toBeDefined();
      expect(issue!.details).toMatch(COUNT_RE);
      expect(issue!.details).toMatch(TAGS_RE);
      const count = parseInt(issue!.details!.match(COUNT_RE)![1], 10);
      expect(count).toBeGreaterThan(0);
      const tags = issue!.details!.match(TAGS_RE)![1].split(", ").map((t) => t.trim());
      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0]).toBe("<div>");
    });

    it("multiple elements of different tags are all listed in the (e.g. …) portion", () => {
      const html = `<html lang="en"><body><main><h1>Page</h1><div role="tab">Tab1</div><span role="tab">Tab2</span></main></body></html>`;
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
      expect(issue).toBeDefined();
      const count = parseInt(issue!.details!.match(COUNT_RE)![1], 10);
      expect(count).toBe(2);
      const tagsRaw = issue!.details!.match(TAGS_RE)![1];
      const tags = tagsRaw.split(", ").map((t) => t.trim());
      expect(tags).toContain("<div>");
      expect(tags).toContain("<span>");
    });
  });

  // tagCounts field — per-tag breakdown on ARIA misuse issues
  describe("tagCounts on ARIA misuse issues", () => {
    describe("role=\"button\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="button">A</div>
          <div role="button">B</div>
          <div role="button">C</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(3);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="button">A</div>
          <div role="button">B</div>
          <span role="button">C</span>
          <p role="button">D</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<span>"]).toBe(1);
        expect(issue!.tagCounts!["<p>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="button">A</div>
          <span role="button">B</span>
          <a role="button" href="#">C</a>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not set tagCounts when no ARIA button misuse is found", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><button>OK</button></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"heading\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <p role="heading" aria-level="2">Section A</p>
          <p role="heading" aria-level="3">Section B</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<p>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="heading" aria-level="2">Section A</div>
          <div role="heading" aria-level="3">Section B</div>
          <span role="heading">Section C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<span>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="heading" aria-level="2">A</div>
          <p role="heading" aria-level="3">B</p>
          <span role="heading">C</span>
          <span role="heading">D</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(4);
        expect(issue!.details).toContain("4 element(s)");
      });
    });

    describe("role=\"tab\" tagCounts", () => {
      it("populates tagCounts for multiple distinct non-interactive tags carrying role=\"tab\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="tab">Tab 1</div>
          <div role="tab">Tab 2</div>
          <span role="tab">Tab 3</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<span>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details for role=\"tab\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="tab">Tab 1</div>
          <p role="tab">Tab 2</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(2);
        expect(issue!.details).toContain("2 element(s)");
      });
    });

    describe("role=\"link\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="link">Link A</div>
          <div role="link">Link B</div>
          <div role="link">Link C</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(3);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="link">Link A</div>
          <div role="link">Link B</div>
          <span role="link">Link C</span>
          <p role="link">Link D</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<span>"]).toBe(1);
        expect(issue!.tagCounts!["<p>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="link">Link A</div>
          <span role="link">Link B</span>
          <p role="link">Link C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native anchor elements with role=\"link\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><a href="#" role="link">Native</a></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"combobox\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="combobox">A</div>
          <div role="combobox">B</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="combobox">A</div>
          <span role="combobox">B</span>
          <span role="combobox">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(1);
        expect(issue!.tagCounts!["<span>"]).toBe(2);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="combobox">A</div>
          <span role="combobox">B</span>
          <p role="combobox">C</p>
          <p role="combobox">D</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(4);
        expect(issue!.details).toContain("4 element(s)");
      });

      it("does not flag native select or input elements with role=\"combobox\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <select role="combobox"><option>A</option></select>
          <input role="combobox" type="text" />
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"grid\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="grid">Grid A</div>
          <div role="grid">Grid B</div>
          <div role="grid">Grid C</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(3);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="grid">Grid A</div>
          <div role="grid">Grid B</div>
          <section role="grid">Grid C</section>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<section>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="grid">Grid A</div>
          <span role="grid">Grid B</span>
          <p role="grid">Grid C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native table elements with role=\"grid\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><table role="grid"><tr><td>Cell</td></tr></table></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"checkbox\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="checkbox">A</div>
          <div role="checkbox">B</div>
          <div role="checkbox">C</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(3);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="checkbox">A</div>
          <div role="checkbox">B</div>
          <span role="checkbox">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<span>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="checkbox">A</div>
          <span role="checkbox">B</span>
          <p role="checkbox">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native checkbox inputs with role=\"checkbox\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><input type="checkbox" role="checkbox" /></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"list\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="list">A</div>
          <div role="list">B</div>
          <div role="list">C</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(3);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="list">A</div>
          <div role="list">B</div>
          <span role="list">C</span>
          <p role="list">D</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<span>"]).toBe(1);
        expect(issue!.tagCounts!["<p>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="list">A</div>
          <span role="list">B</span>
          <p role="list">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native ul or ol elements with role=\"list\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <ul role="list"><li>Item A</li></ul>
          <ol role="list"><li>Item B</li></ol>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"listitem\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="listitem">A</div>
          <div role="listitem">B</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="listitem">A</div>
          <span role="listitem">B</span>
          <span role="listitem">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(1);
        expect(issue!.tagCounts!["<span>"]).toBe(2);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="listitem">A</div>
          <span role="listitem">B</span>
          <p role="listitem">C</p>
          <p role="listitem">D</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(4);
        expect(issue!.details).toContain("4 element(s)");
      });

      it("does not flag native li elements with role=\"listitem\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><ul><li role="listitem">Item</li></ul></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"listbox\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="listbox">A</div>
          <div role="listbox">B</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listbox Role on Non-Select Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="listbox">A</div>
          <ul role="listbox">B</ul>
          <ul role="listbox">C</ul>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listbox Role on Non-Select Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(1);
        expect(issue!.tagCounts!["<ul>"]).toBe(2);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="listbox">A</div>
          <span role="listbox">B</span>
          <p role="listbox">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listbox Role on Non-Select Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native select elements with role=\"listbox\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><select role="listbox"><option>A</option></select></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Listbox Role on Non-Select Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"radio\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="radio">A</div>
          <div role="radio">B</div>
          <div role="radio">C</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(3);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="radio">A</div>
          <div role="radio">B</div>
          <span role="radio">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(2);
        expect(issue!.tagCounts!["<span>"]).toBe(1);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="radio">A</div>
          <span role="radio">B</span>
          <p role="radio">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native radio inputs with role=\"radio\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><input type="radio" role="radio" /></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"slider\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="slider">A</div>
          <div role="slider">B</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Slider Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="slider">A</div>
          <span role="slider">B</span>
          <span role="slider">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Slider Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(1);
        expect(issue!.tagCounts!["<span>"]).toBe(2);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="slider">A</div>
          <span role="slider">B</span>
          <p role="slider">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Slider Role on Non-Input Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native range inputs with role=\"slider\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><input type="range" role="slider" /></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Slider Role on Non-Input Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"spinbutton\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="spinbutton">A</div>
          <div role="spinbutton">B</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Spinbutton Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="spinbutton">A</div>
          <span role="spinbutton">B</span>
          <span role="spinbutton">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Spinbutton Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(1);
        expect(issue!.tagCounts!["<span>"]).toBe(2);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="spinbutton">A</div>
          <span role="spinbutton">B</span>
          <p role="spinbutton">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Spinbutton Role on Non-Input Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native number inputs with role=\"spinbutton\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><input type="number" role="spinbutton" /></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Spinbutton Role on Non-Input Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"switch\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="switch">A</div>
          <div role="switch">B</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Switch Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="switch">A</div>
          <span role="switch">B</span>
          <span role="switch">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Switch Role on Non-Input Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(1);
        expect(issue!.tagCounts!["<span>"]).toBe(2);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="switch">A</div>
          <span role="switch">B</span>
          <p role="switch">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Switch Role on Non-Input Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native checkbox inputs with role=\"switch\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1><input type="checkbox" role="switch" /></main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Switch Role on Non-Input Element");
        expect(issue).toBeUndefined();
      });
    });

    describe("role=\"treeitem\" tagCounts", () => {
      it("populates tagCounts with a single key when all offending elements share the same tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="treeitem">A</div>
          <div role="treeitem">B</div>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Treeitem Role on Non-List/Anchor Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(Object.keys(issue!.tagCounts!)).toHaveLength(1);
        expect(issue!.tagCounts!["<div>"]).toBe(2);
      });

      it("populates tagCounts with one key per distinct offending tag", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="treeitem">A</div>
          <span role="treeitem">B</span>
          <span role="treeitem">C</span>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Treeitem Role on Non-List/Anchor Element");
        expect(issue).toBeDefined();
        expect(issue!.tagCounts).toBeDefined();
        expect(issue!.tagCounts!["<div>"]).toBe(1);
        expect(issue!.tagCounts!["<span>"]).toBe(2);
      });

      it("tagCounts sum equals the total count reported in details", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <div role="treeitem">A</div>
          <span role="treeitem">B</span>
          <p role="treeitem">C</p>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Treeitem Role on Non-List/Anchor Element");
        expect(issue).toBeDefined();
        const total = Object.values(issue!.tagCounts!).reduce((s, n) => s + n, 0);
        expect(total).toBe(3);
        expect(issue!.details).toContain("3 element(s)");
      });

      it("does not flag native li or anchor elements with role=\"treeitem\"", () => {
        const html = `<html lang="en"><body><main><h1>Page</h1>
          <ul><li role="treeitem">Item</li></ul>
          <a href="#" role="treeitem">Link</a>
        </main></body></html>`;
        const issues = runDeterministicChecks(html);
        const issue = issues.find((i) => i.title === "ARIA Treeitem Role on Non-List/Anchor Element");
        expect(issue).toBeUndefined();
      });
    });
  });

  // All issues have required fields
  describe("issue shape", () => {
    it("every issue has criterion, title, level, status, description, and details", () => {
      const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Hello</h1><p>World</p></main></body></html>`;
      const issues = runDeterministicChecks(html);
      for (const issue of issues) {
        expect(issue.criterion).toBeTruthy();
        expect(issue.title).toBeTruthy();
        expect(["A", "AA", "AAA"]).toContain(issue.level);
        expect(["pass", "fail", "warning", "fixed", "accepted"]).toContain(issue.status);
        expect(issue.description).toBeTruthy();
        expect(issue.details).toBeTruthy();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// buildComplianceReport
// ---------------------------------------------------------------------------

describe("buildComplianceReport", () => {
  const makeIssue = (status: ComplianceIssue["status"]): ComplianceIssue => ({
    criterion: "1.1.1",
    title: "Test",
    level: "A",
    status,
    description: "desc",
    details: "details",
  });

  it("counts pass, fail, warning, fixed, and accepted correctly", () => {
    const issues: ComplianceIssue[] = [
      makeIssue("pass"),
      makeIssue("pass"),
      makeIssue("fail"),
      makeIssue("warning"),
      makeIssue("fixed"),
      makeIssue("accepted"),
    ];
    const report = buildComplianceReport(issues);
    expect(report.totalIssues).toBe(6);
    expect(report.passCount).toBe(2);
    expect(report.failCount).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(report.fixedCount).toBe(1);
    expect(report.acceptedCount).toBe(1);
  });

  it("calculates overall score as (pass + fixed + accepted) / total * 100", () => {
    const issues: ComplianceIssue[] = [
      makeIssue("pass"),
      makeIssue("fixed"),
      makeIssue("accepted"),
      makeIssue("fail"),
    ];
    const report = buildComplianceReport(issues);
    expect(report.overallScore).toBe(75);
  });

  it("returns score of 0 when there are no issues", () => {
    const report = buildComplianceReport([]);
    expect(report.overallScore).toBe(0);
    expect(report.totalIssues).toBe(0);
  });

  it("returns score of 100 when all issues pass", () => {
    const issues = [makeIssue("pass"), makeIssue("pass"), makeIssue("pass")];
    const report = buildComplianceReport(issues);
    expect(report.overallScore).toBe(100);
  });

  it("returns score of 0 when all issues fail", () => {
    const issues = [makeIssue("fail"), makeIssue("fail")];
    const report = buildComplianceReport(issues);
    expect(report.overallScore).toBe(0);
  });

  it("preserves the original issues array in the report", () => {
    const issues = [makeIssue("pass"), makeIssue("fail")];
    const report = buildComplianceReport(issues);
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0].status).toBe("pass");
    expect(report.issues[1].status).toBe("fail");
  });

  it("counts only warnings correctly — score is 0 since warnings are not positive", () => {
    const issues = [makeIssue("warning"), makeIssue("warning"), makeIssue("warning")];
    const report = buildComplianceReport(issues);
    expect(report.warningCount).toBe(3);
    expect(report.passCount).toBe(0);
    expect(report.failCount).toBe(0);
    expect(report.overallScore).toBe(0);
  });

  it("score rounds correctly for non-integer percentages", () => {
    const issues = [makeIssue("pass"), makeIssue("fail"), makeIssue("fail")];
    const report = buildComplianceReport(issues);
    expect(report.overallScore).toBe(33);
  });

  it("totalIssues equals the length of the supplied array", () => {
    const issues = Array.from({ length: 10 }, () => makeIssue("pass"));
    const report = buildComplianceReport(issues);
    expect(report.totalIssues).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// parseHexColor
// ---------------------------------------------------------------------------

describe("parseHexColor", () => {
  it("parses a 6-digit hex colour", () => {
    expect(parseHexColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseHexColor("#000000")).toEqual([0, 0, 0]);
    expect(parseHexColor("#ff0000")).toEqual([255, 0, 0]);
  });

  it("parses a 3-digit hex colour by expanding each digit", () => {
    expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
    expect(parseHexColor("#000")).toEqual([0, 0, 0]);
    expect(parseHexColor("#f00")).toEqual([255, 0, 0]);
  });

  it("strips a leading # before parsing", () => {
    expect(parseHexColor("ffffff")).toEqual([255, 255, 255]);
  });

  it("returns null for invalid or unsupported formats", () => {
    expect(parseHexColor("not-a-color")).toBeNull();
    expect(parseHexColor("#gggggg")).toBeNull();
    expect(parseHexColor("")).toBeNull();
  });

  it("parses uppercase hex letters correctly", () => {
    expect(parseHexColor("#FFFFFF")).toEqual([255, 255, 255]);
    expect(parseHexColor("#FF0000")).toEqual([255, 0, 0]);
    expect(parseHexColor("#FFF")).toEqual([255, 255, 255]);
  });

  it("returns null for 4-digit and 8-digit hex (unsupported lengths)", () => {
    expect(parseHexColor("#ffff")).toBeNull();
    expect(parseHexColor("#ffffffff")).toBeNull();
  });

  it("parses a mid-range 6-digit hex correctly", () => {
    expect(parseHexColor("#804020")).toEqual([128, 64, 32]);
  });
});

// ---------------------------------------------------------------------------
// relativeLuminance
// ---------------------------------------------------------------------------

describe("relativeLuminance", () => {
  it("returns 1 for pure white", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it("returns 0 for pure black", () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
  });

  it("returns a value between 0 and 1 for mid-tones", () => {
    const l = relativeLuminance(128, 128, 128);
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(1);
  });

  it("returns the WCAG-specified luminance for pure red (≈ 0.2126)", () => {
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 3);
  });

  it("returns a higher luminance for a lighter colour than a darker one", () => {
    const light = relativeLuminance(200, 200, 200);
    const dark = relativeLuminance(50, 50, 50);
    expect(light).toBeGreaterThan(dark);
  });

  it("treats each channel independently — pure green has higher luminance than pure blue", () => {
    const green = relativeLuminance(0, 255, 0);
    const blue = relativeLuminance(0, 0, 255);
    expect(green).toBeGreaterThan(blue);
  });
});

// ---------------------------------------------------------------------------
// contrastRatio
// ---------------------------------------------------------------------------

describe("contrastRatio", () => {
  it("returns 21 for black text on white background (maximum contrast)", () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
  });

  it("returns 1 for identical colours (no contrast)", () => {
    const l = relativeLuminance(128, 128, 128);
    expect(contrastRatio(l, l)).toBeCloseTo(1, 5);
  });

  it("is commutative — order of arguments does not matter", () => {
    const l1 = relativeLuminance(255, 0, 0);
    const l2 = relativeLuminance(0, 0, 255);
    expect(contrastRatio(l1, l2)).toBeCloseTo(contrastRatio(l2, l1), 10);
  });

  it("black-on-white exceeds WCAG AA threshold of 4.5:1", () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    expect(contrastRatio(white, black)).toBeGreaterThanOrEqual(4.5);
  });

  it("light-grey on white fails WCAG AA threshold", () => {
    const white = relativeLuminance(255, 255, 255);
    const lightGrey = relativeLuminance(200, 200, 200);
    expect(contrastRatio(white, lightGrey)).toBeLessThan(4.5);
  });

  it("black-on-white exceeds WCAG AAA threshold of 7:1", () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    expect(contrastRatio(white, black)).toBeGreaterThanOrEqual(7);
  });

  it("always returns a ratio of at least 1 (no negative contrast)", () => {
    const a = relativeLuminance(10, 10, 10);
    const b = relativeLuminance(240, 240, 240);
    expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(1);
    expect(contrastRatio(b, a)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// checkHeadingOrder
// ---------------------------------------------------------------------------

describe("checkHeadingOrder", () => {
  it("returns empty levels for a document with no headings", () => {
    const result = checkHeadingOrder("<html><body><p>No headings</p></body></html>");
    expect(result.levels).toHaveLength(0);
    expect(result.hasSkippedLevels).toBe(false);
    expect(result.skips).toHaveLength(0);
  });

  it("detects a correctly ordered h1 → h2 → h3 sequence", () => {
    const html = "<h1>Title</h1><h2>Section</h2><h3>Sub</h3>";
    const result = checkHeadingOrder(html);
    expect(result.levels).toEqual([1, 2, 3]);
    expect(result.hasSkippedLevels).toBe(false);
  });

  it("detects a skipped level from h1 directly to h3", () => {
    const html = "<h1>Title</h1><h3>Subsection</h3>";
    const result = checkHeadingOrder(html);
    expect(result.hasSkippedLevels).toBe(true);
    expect(result.skips).toEqual([{ from: 1, to: 3 }]);
  });

  it("detects multiple skipped levels in one document", () => {
    const html = "<h1>A</h1><h3>B</h3><h5>C</h5>";
    const result = checkHeadingOrder(html);
    expect(result.hasSkippedLevels).toBe(true);
    expect(result.skips).toHaveLength(2);
  });

  it("does not flag going up (back to a higher level) as a skip", () => {
    const html = "<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h3>E</h3>";
    const result = checkHeadingOrder(html);
    expect(result.hasSkippedLevels).toBe(false);
  });

  it("captures all heading levels in document order", () => {
    const html = "<h2>First</h2><h1>Second</h1>";
    const result = checkHeadingOrder(html);
    expect(result.levels).toEqual([2, 1]);
  });

  it("does not flag h1 after h2 as a skip (going up to a higher level is allowed)", () => {
    const html = "<h2>Intro</h2><h1>Main</h1>";
    const result = checkHeadingOrder(html);
    expect(result.hasSkippedLevels).toBe(false);
  });

  it("handles a document with a single heading with no skips", () => {
    const html = "<h1>Only heading</h1>";
    const result = checkHeadingOrder(html);
    expect(result.levels).toEqual([1]);
    expect(result.hasSkippedLevels).toBe(false);
    expect(result.skips).toHaveLength(0);
  });

  it("reports the correct skip pair when h1 jumps to h4", () => {
    const html = "<h1>Title</h1><h4>Deep</h4>";
    const result = checkHeadingOrder(html);
    expect(result.skips).toEqual([{ from: 1, to: 4 }]);
  });
});

// ---------------------------------------------------------------------------
// runDeterministicChecks — heading order and contrast checks
// ---------------------------------------------------------------------------

describe("runDeterministicChecks – heading order check (1.3.1)", () => {
  it("is not included when there are no headings", () => {
    const html = `<html lang="en"><body><p>No headings</p></body></html>`;
    const issues = runDeterministicChecks(html);
    const orderIssue = issues.find(
      (i) => i.criterion === "1.3.1" && i.title === "Heading Order"
    );
    expect(orderIssue).toBeUndefined();
  });

  it("passes for a correctly ordered heading sequence", () => {
    const html = `<html lang="en"><body><h1>Title</h1><h2>Section</h2><h3>Sub</h3></body></html>`;
    const issues = runDeterministicChecks(html);
    const orderIssue = issues.find(
      (i) => i.criterion === "1.3.1" && i.title === "Heading Order"
    );
    expect(orderIssue).toBeDefined();
    expect(orderIssue!.status).toBe("pass");
    expect(orderIssue!.details).toBe("Headings follow a logical order (h1, h2, h3).");
  });

  it("warns when heading levels are skipped", () => {
    const html = `<html lang="en"><body><h1>Title</h1><h3>Jumped</h3></body></html>`;
    const issues = runDeterministicChecks(html);
    const orderIssue = issues.find(
      (i) => i.criterion === "1.3.1" && i.title === "Heading Order"
    );
    expect(orderIssue!.status).toBe("warning");
    expect(orderIssue!.details).toBe("Heading levels appear to skip: h1 → h3. This may confuse screen reader users.");
  });
});

describe("runDeterministicChecks – contrast check (1.4.3)", () => {
  it("is not included when no inline colour pairs are present", () => {
    const html = `<html lang="en"><body><h1>No styles</h1></body></html>`;
    const issues = runDeterministicChecks(html);
    const contrastIssue = issues.find((i) => i.criterion === "1.4.3");
    expect(contrastIssue).toBeUndefined();
  });

  it("passes when inline colour pair meets WCAG AA (black on white)", () => {
    const html = `<html lang="en"><body><p style="color: #000000; background-color: #ffffff">Text</p></body></html>`;
    const issues = runDeterministicChecks(html);
    const contrastIssue = issues.find((i) => i.criterion === "1.4.3");
    expect(contrastIssue).toBeDefined();
    expect(contrastIssue!.status).toBe("pass");
  });

  it("fails when inline colour pair does not meet WCAG AA (light grey on white)", () => {
    const html = `<html lang="en"><body><p style="color: #cccccc; background-color: #ffffff">Low contrast</p></body></html>`;
    const issues = runDeterministicChecks(html);
    const contrastIssue = issues.find((i) => i.criterion === "1.4.3");
    expect(contrastIssue).toBeDefined();
    expect(contrastIssue!.status).toBe("fail");
  });

  it("parses 3-digit hex colour pairs correctly and passes for high-contrast pair", () => {
    const html = `<html lang="en"><body><p style="color: #000; background-color: #fff">Text</p></body></html>`;
    const issues = runDeterministicChecks(html);
    const contrastIssue = issues.find((i) => i.criterion === "1.4.3");
    expect(contrastIssue).toBeDefined();
    expect(contrastIssue!.status).toBe("pass");
  });

  it("fails when one of multiple inline colour pairs has insufficient contrast", () => {
    const html = `<html lang="en"><body>
      <p style="color: #000000; background-color: #ffffff">Good contrast</p>
      <p style="color: #cccccc; background-color: #ffffff">Bad contrast</p>
    </body></html>`;
    const issues = runDeterministicChecks(html);
    const contrastIssue = issues.find((i) => i.criterion === "1.4.3");
    expect(contrastIssue).toBeDefined();
    expect(contrastIssue!.status).toBe("fail");
    expect(contrastIssue!.details).toContain("1 of 2");
  });

  it("is not included when inline styles exist but provide no colour-background pair", () => {
    const html = `<html lang="en"><body><p style="font-size: 16px; margin: 0">Styled</p></body></html>`;
    const issues = runDeterministicChecks(html);
    const contrastIssue = issues.find((i) => i.criterion === "1.4.3");
    expect(contrastIssue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HTML Fixture tests — realistic documents
// ---------------------------------------------------------------------------

describe("fixture: corporate-report.html — well-structured accessible document", () => {
  it("passes language check (3.1.1)", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "3.1.1")!.status).toBe("pass");
  });

  it("passes page title check (2.4.2)", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "2.4.2")!.status).toBe("pass");
  });

  it("passes heading check (2.4.6) — has an h1", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "2.4.6")!.status).toBe("pass");
  });

  it("passes landmark check (2.4.1) — has a <main> element", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "2.4.1")!.status).toBe("pass");
  });

  it("passes image alt check (1.1.1) — all images have alt text", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "1.1.1")!.status).toBe("pass");
  });

  it("passes table headers check (1.3.1 Table Headers) — all tables use <th>", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    const tableIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Table Headers");
    expect(tableIssue).toBeDefined();
    expect(tableIssue!.status).toBe("pass");
  });

  it("passes heading order check (1.3.1 Heading Order) — no skipped levels", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    const orderIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Heading Order");
    expect(orderIssue).toBeDefined();
    expect(orderIssue!.status).toBe("pass");
  });

  it("passes reading order check (1.3.2) — no position:absolute divs", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "1.3.2")!.status).toBe("pass");
  });

  it("evaluateOriginalDocument returns a high overall score (>=80)", () => {
    const html = loadFixture("corporate-report.html");
    const report = evaluateOriginalDocument(html);
    expect(report.overallScore).toBeGreaterThanOrEqual(80);
    expect(report.failCount).toBe(0);
  });

  it("returns exactly 9 issues — one per deterministic check triggered", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    expect(issues.length).toBe(9);
  });

  it("evaluateOriginalDocument reports 9 issues all passing (0 fail, 0 warning)", () => {
    const html = loadFixture("corporate-report.html");
    const report = evaluateOriginalDocument(html);
    expect(report.totalIssues).toBe(9);
    expect(report.passCount).toBe(9);
    expect(report.failCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.overallScore).toBe(100);
  });

  it("every deterministic issue has all required fields", () => {
    const html = loadFixture("corporate-report.html");
    const issues = runDeterministicChecks(html);
    for (const issue of issues) {
      expect(issue.criterion).toBeTruthy();
      expect(issue.title).toBeTruthy();
      expect(["A", "AA", "AAA"]).toContain(issue.level);
      expect(["pass", "fail", "warning", "fixed", "accepted"]).toContain(issue.status);
      expect(issue.description).toBeTruthy();
      expect(issue.details).toBeTruthy();
    }
  });
});

describe("fixture: healthcare-brochure.html — mixed accessibility with some issues", () => {
  it("passes language check (3.1.1)", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "3.1.1")!.status).toBe("pass");
  });

  it("passes landmark check (2.4.1) — uses role=main", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "2.4.1")!.status).toBe("pass");
  });

  it("fails image alt check (1.1.1) — multiple images missing alt text", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    const altIssue = issues.find((i) => i.criterion === "1.1.1")!;
    expect(altIssue.status).toBe("fail");
    expect(altIssue.details).toMatch(/3 of 5/);
  });

  it("warns on reading order (1.3.2) — has a position:absolute div", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "1.3.2")!.status).toBe("warning");
  });

  it("has at least one fail and at least one warning", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    expect(issues.filter((i) => i.status === "fail").length).toBeGreaterThanOrEqual(1);
    expect(issues.filter((i) => i.status === "warning").length).toBeGreaterThanOrEqual(1);
  });

  it("evaluateOriginalDocument score is between 50 and 99 (partially accessible)", () => {
    const html = loadFixture("healthcare-brochure.html");
    const report = evaluateOriginalDocument(html);
    expect(report.overallScore).toBeGreaterThanOrEqual(50);
    expect(report.overallScore).toBeLessThan(100);
    expect(report.failCount).toBeGreaterThan(0);
  });

  it("returns exactly 10 issues total", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    expect(issues.length).toBe(10);
  });

  it("fails table headers check (1.3.1 Table Headers) — second table has no <th>", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    const tableIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Table Headers");
    expect(tableIssue).toBeDefined();
    expect(tableIssue!.status).toBe("fail");
  });

  it("evaluateOriginalDocument reports exact counts: 6 pass, 2 fail, 2 warning, score 60", () => {
    const html = loadFixture("healthcare-brochure.html");
    const report = evaluateOriginalDocument(html);
    expect(report.totalIssues).toBe(10);
    expect(report.passCount).toBe(6);
    expect(report.failCount).toBe(2);
    expect(report.warningCount).toBe(2);
    expect(report.overallScore).toBe(60);
  });

  it("every deterministic issue has all required fields", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    for (const issue of issues) {
      expect(issue.criterion).toBeTruthy();
      expect(issue.title).toBeTruthy();
      expect(["A", "AA", "AAA"]).toContain(issue.level);
      expect(["pass", "fail", "warning", "fixed", "accepted"]).toContain(issue.status);
      expect(issue.description).toBeTruthy();
      expect(issue.details).toBeTruthy();
    }
  });
});

describe("fixture: government-form.html — document with multiple accessibility failures", () => {
  it("fails language check (3.1.1) — no lang attribute", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "3.1.1")!.status).toBe("fail");
  });

  it("fails page title check (2.4.2) — empty <title>", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "2.4.2")!.status).toBe("fail");
  });

  it("fails heading check (2.4.6) — no h1 present", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "2.4.6")!.status).toBe("fail");
  });

  it("warns on bypass blocks (2.4.1) — no main landmark", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    expect(issues.find((i) => i.criterion === "2.4.1")!.status).toBe("warning");
  });

  it("fails image alt check (1.1.1) — all images missing alt text", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    const altIssue = issues.find((i) => i.criterion === "1.1.1")!;
    expect(altIssue.status).toBe("fail");
    expect(altIssue.details).toMatch(/2 of 2/);
  });

  it("fails table headers check (1.3.1 Table Headers) — no <th> in any table", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    const tableIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Table Headers");
    expect(tableIssue).toBeDefined();
    expect(tableIssue!.status).toBe("fail");
  });

  it("warns on heading order (1.3.1 Heading Order) — jumps from h3 to h5", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    const orderIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Heading Order");
    expect(orderIssue).toBeDefined();
    expect(orderIssue!.status).toBe("warning");
    expect(orderIssue!.details).toBe("Heading levels appear to skip: h3 → h5. This may confuse screen reader users.");
  });

  it("has multiple failures — at least 4 fail statuses", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    expect(issues.filter((i) => i.status === "fail").length).toBeGreaterThanOrEqual(4);
  });

  it("returns exactly 10 issues total", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    expect(issues.length).toBe(10);
  });

  it("evaluateOriginalDocument reports exact counts: 1 pass, 5 fail, 4 warning, score 10", () => {
    const html = loadFixture("government-form.html");
    const report = evaluateOriginalDocument(html);
    expect(report.totalIssues).toBe(10);
    expect(report.passCount).toBe(1);
    expect(report.failCount).toBe(5);
    expect(report.warningCount).toBe(4);
    expect(report.overallScore).toBe(10);
  });

  it("evaluateOriginalDocument returns a low overall score (<50)", () => {
    const html = loadFixture("government-form.html");
    const report = evaluateOriginalDocument(html);
    expect(report.overallScore).toBeLessThan(50);
    expect(report.failCount).toBeGreaterThanOrEqual(4);
  });

  it("every deterministic issue has all required fields", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    for (const issue of issues) {
      expect(issue.criterion).toBeTruthy();
      expect(issue.title).toBeTruthy();
      expect(["A", "AA", "AAA"]).toContain(issue.level);
      expect(["pass", "fail", "warning", "fixed", "accepted"]).toContain(issue.status);
      expect(issue.description).toBeTruthy();
      expect(issue.details).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateOriginalDocument
// ---------------------------------------------------------------------------

describe("evaluateOriginalDocument", () => {
  it("returns a ComplianceReport with issues", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Report Test</title></head><body><main><h1>Title</h1></body></html>`;
    const report = evaluateOriginalDocument(html);
    expect(report.totalIssues).toBeGreaterThan(0);
    expect(Array.isArray(report.issues)).toBe(true);
  });

  it("overallScore is between 0 and 100", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Report Test</title></head><body><main><h1>Title</h1><section><h2>Sub</h2></section></main></body></html>`;
    const report = evaluateOriginalDocument(html);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it("returns a higher score for a well-formed document than a bare one", () => {
    const good = `<!DOCTYPE html><html lang="en"><head><title>Good Doc</title></head><body><main><h1>Main</h1><section><h2>Sub</h2><p>Content</p></section></main></body></html>`;
    const bad = `<html><body><div>text</div></body></html>`;
    const goodReport = evaluateOriginalDocument(good);
    const badReport = evaluateOriginalDocument(bad);
    expect(goodReport.overallScore).toBeGreaterThan(badReport.overallScore);
  });

  it("report has a failCount greater than 0 for a document missing lang, title, and h1", () => {
    const html = `<html><body><div>Just some text</div></body></html>`;
    const report = evaluateOriginalDocument(html);
    expect(report.failCount).toBeGreaterThan(0);
  });

  it("report contains all required top-level fields", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>H</h1></main></body></html>`;
    const report = evaluateOriginalDocument(html);
    expect(typeof report.totalIssues).toBe("number");
    expect(typeof report.passCount).toBe("number");
    expect(typeof report.failCount).toBe("number");
    expect(typeof report.warningCount).toBe("number");
    expect(typeof report.fixedCount).toBe("number");
    expect(typeof report.acceptedCount).toBe("number");
    expect(typeof report.overallScore).toBe("number");
    expect(Array.isArray(report.issues)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureAltText
// ---------------------------------------------------------------------------

describe("ensureAltText", () => {
  it("adds a generated alt attribute to an image with no alt at all", () => {
    const img = makeImage("diagram.png");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    expect(result).toContain('alt="');
    expect(result).not.toContain('alt=""');
  });

  it("replaces a weak alt ('image') with a generated description", () => {
    const img = makeImage("chart.png");
    const html = `<img src="${img.dataUrl}" alt="image">`;
    const result = ensureAltText(html, [img]);
    expect(result).not.toContain('alt="image"');
    expect(result).toContain('alt="');
  });

  it("replaces other weak patterns such as 'photo', 'icon', and 'graphic'", () => {
    for (const weak of ["photo", "icon", "graphic", "figure", "picture"]) {
      const img = makeImage("test.png");
      const html = `<img src="${img.dataUrl}" alt="${weak}">`;
      const result = ensureAltText(html, [img]);
      expect(result).not.toContain(`alt="${weak}"`);
    }
  });

  it("leaves a meaningful alt unchanged", () => {
    const img = makeImage("logo.png");
    const html = `<img src="${img.dataUrl}" alt="Company logo showing a blue mountain">`;
    const result = ensureAltText(html, [img]);
    expect(result).toContain('alt="Company logo showing a blue mountain"');
  });

  it("uses the image name from the ExtractedImage metadata when src is a data URI", () => {
    const img = makeImage("quarterly-report.png");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    expect(result).toContain("quarterly");
    expect(result).toContain("report");
  });

  it("derives alt text from the non-data src attribute when no metadata matches", () => {
    const html = `<img src="some_figure.png">`;
    const result = ensureAltText(html, []);
    expect(result).toContain("some");
    expect(result).toContain("figure");
  });

  it("handles multiple images in one HTML string independently", () => {
    const img1 = makeImage("chart.png");
    const img2 = makeImage("table.png");
    const html = `<img src="${img1.dataUrl}" alt="image"><img src="${img2.dataUrl}" alt="A meaningful description">`;
    const result = ensureAltText(html, [img1, img2]);
    expect(result).not.toContain('alt="image"');
    expect(result).toContain('alt="A meaningful description"');
  });

  it("escapes & in the image name when building fallback alt text from a data URI", () => {
    const img = makeImage("sales&marketing.png");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    expect(result).toContain("&amp;");
    expect(result).not.toMatch(/alt="[^"]*&[^a-z#][^"]*"/);
  });

  it('escapes " in the image name when building fallback alt text from a non-data src', () => {
    const html = `<img src='say"cheese".png'>`;
    const result = ensureAltText(html, []);
    expect(result).toContain("&quot;");
    expect(result).not.toContain('alt="Image: say"');
  });

  it("escapes < and > in the image name when building fallback alt text from a data URI", () => {
    const img = makeImage("before<arrow>after.png", "data:image/png;base64,cleandata");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).not.toContain("<arrow>");
  });

  it("escapes & in the image name when the src attribute is single-quoted", () => {
    const html = `<img src='sales&marketing.png'>`;
    const result = ensureAltText(html, []);
    expect(result).toContain("&amp;");
    expect(result).not.toMatch(/alt="[^"]*&[^a-z#][^"]*"/);
    expect(result).toContain('alt="Image: sales&amp;marketing"');
  });

  it('escapes all four special characters when src uses single quotes and filename contains &, ", <, and >', () => {
    const html = `<img src='a&b<"c">d.png'>`;
    const result = ensureAltText(html, []);
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain('alt="Image: a&amp;b&lt;&quot;c&quot;&gt;d"');
  });

  it("escapes a single quote in the filename as &#39; inside a double-quoted alt attribute", () => {
    const html = `<img src="o'clock.png">`;
    const result = ensureAltText(html, []);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    const altValue = altMatch![1];
    expect(altValue).toContain("o&#39;clock");
    expect(result).not.toMatch(/alt="[^"]*"[^"]*"/);
  });

  it("escapes a single quote in a data URI image name as &#39; inside a double-quoted alt attribute", () => {
    const img = makeImage("o'clock.png", "data:image/png;base64,clockdata");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    const altValue = altMatch![1];
    expect(altValue).toContain("o&#39;clock");
    expect(result).not.toMatch(/alt="[^"]*"[^"]*"/);
  });

  it("decodes a percent-encoded emoji filename in a non-data src into readable alt text", () => {
    const html = `<img src="%F0%9F%98%80.png">`;
    const result = ensureAltText(html, []);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    expect(altMatch![1]).toContain("😀");
    expect(altMatch![1]).not.toContain("%F0%9F%98%80");
  });

  it("decodes a percent-encoded CJK filename in a non-data src into readable alt text", () => {
    const html = `<img src="%E5%9B%BE%E8%A1%A8.png">`;
    const result = ensureAltText(html, []);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    expect(altMatch![1]).toContain("图表");
    expect(altMatch![1]).not.toContain("%E5%9B%BE%E8%A1%A8");
  });

  it("decodes a percent-encoded emoji in a data URI image name into readable alt text", () => {
    const img = makeImage("%F0%9F%8E%89.png", "data:image/png;base64,emojidata");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    expect(altMatch![1]).toContain("🎉");
    expect(altMatch![1]).not.toContain("%F0%9F%8E%89");
  });

  it("decodes a percent-encoded CJK name in a data URI image into readable alt text", () => {
    const img = makeImage("%E5%9B%BE%E8%A1%A8.png", "data:image/png;base64,cjkdata");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    expect(altMatch![1]).toContain("图表");
    expect(altMatch![1]).not.toContain("%E5%9B%BE%E8%A1%A8");
  });

  it("leaves an invalid percent-encoded src unchanged rather than throwing", () => {
    const html = `<img src="broken%GGimage.png">`;
    const result = ensureAltText(html, []);
    expect(result).toContain('alt="');
  });
});

// ---------------------------------------------------------------------------
// injectImageData
// ---------------------------------------------------------------------------

describe("injectImageData", () => {
  it("returns the html unchanged when the images array is empty", () => {
    const html = `<img src="photo.png" alt="A photo">`;
    expect(injectImageData(html, [])).toBe(html);
  });

  it("replaces src with the dataUrl on an exact name match (case-insensitive)", () => {
    const img = makeImage("Logo.png", "data:image/png;base64,abc123");
    const html = `<img src="logo.png" alt="Logo">`;
    const result = injectImageData(html, [img]);
    expect(result).toContain('src="data:image/png;base64,abc123"');
  });

  it("replaces src on a partial name match (src contains image name)", () => {
    const img = makeImage("chart", "data:image/png;base64,chartdata");
    const html = `<img src="monthly-chart-2024" alt="Chart">`;
    const result = injectImageData(html, [img]);
    expect(result).toContain('src="data:image/png;base64,chartdata"');
  });

  it("replaces src on a partial name match (image name contains src)", () => {
    const img = makeImage("full-report-chart.png", "data:image/png;base64,fullchartdata");
    const html = `<img src="chart" alt="Chart">`;
    const result = injectImageData(html, [img]);
    expect(result).toContain('src="data:image/png;base64,fullchartdata"');
  });

  it("falls back to the transparent pixel when no match is found", () => {
    const img = makeImage("diagram.png", "data:image/png;base64,diagramdata");
    const html = `<img src="completely-unrelated-name" alt="Unknown">`;
    const result = injectImageData(html, [img]);
    expect(result).toContain(`src="${TRANSPARENT_PIXEL}"`);
  });

  it("leaves an existing data URI src unchanged (does not double-encode)", () => {
    const existingUri = "data:image/png;base64,alreadyembedded";
    const html = `<img src="${existingUri}" alt="Already embedded">`;
    const result = injectImageData(html, [makeImage("other.png")]);
    expect(result).toContain(`src="${existingUri}"`);
  });

  it("replaces multiple img tags in a single pass", () => {
    const img1 = makeImage("photo.png", "data:image/png;base64,photo");
    const img2 = makeImage("icon.png", "data:image/png;base64,icon");
    const html = `<img src="photo.png" alt="Photo"><img src="icon.png" alt="Icon">`;
    const result = injectImageData(html, [img1, img2]);
    expect(result).toContain('src="data:image/png;base64,photo"');
    expect(result).toContain('src="data:image/png;base64,icon"');
  });

  describe("special characters in filenames", () => {
    it("matches exactly when filename contains dots (e.g. report.v2.0.png)", () => {
      const img = makeImage("report.v2.0.png", "data:image/png;base64,dotdata");
      const html = `<img src="report.v2.0.png" alt="Report">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,dotdata"');
    });

    it("matches exactly when filename contains plus signs (e.g. photo+caption.png)", () => {
      const img = makeImage("photo+caption.png", "data:image/png;base64,plusdata");
      const html = `<img src="photo+caption.png" alt="Photo">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,plusdata"');
    });

    it("matches exactly when filename contains parentheses (e.g. image(1).png)", () => {
      const img = makeImage("image(1).png", "data:image/png;base64,parendata");
      const html = `<img src="image(1).png" alt="Image">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,parendata"');
    });

    it("matches exactly when filename contains all four special chars (e.g. chart(v2.0+final).png)", () => {
      const img = makeImage("chart(v2.0+final).png", "data:image/png;base64,allspecial");
      const html = `<img src="chart(v2.0+final).png" alt="Chart">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,allspecial"');
    });

    it("case-insensitive exact match works with parentheses (Chart(1).PNG vs chart(1).png)", () => {
      const img = makeImage("Chart(1).PNG", "data:image/png;base64,casedata");
      const html = `<img src="chart(1).png" alt="Chart">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,casedata"');
    });

    it("partial match works when src contains a filename with dots and plus signs", () => {
      const img = makeImage("v2.0+final", "data:image/png;base64,partialdata");
      const html = `<img src="report-v2.0+final-2024" alt="Report">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,partialdata"');
    });

    it("partial match works when image name contains src with parentheses", () => {
      const img = makeImage("full-image(1).png", "data:image/png;base64,fullparendata");
      const html = `<img src="image(1)" alt="Image">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,fullparendata"');
    });

    it("falls back to transparent pixel when special-char filename has no match", () => {
      const img = makeImage("image(1).png", "data:image/png;base64,parendata");
      const html = `<img src="image(2).png" alt="Other">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain(`src="${TRANSPARENT_PIXEL}"`);
    });
  });

  describe("URL-encoded filenames", () => {
    it("matches when src uses %28 and %29 for parentheses (e.g. image%281%29.png vs image(1).png)", () => {
      const img = makeImage("image(1).png", "data:image/png;base64,encodedparen");
      const html = `<img src="image%281%29.png" alt="Image">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,encodedparen"');
    });

    it("matches when src uses %2B for plus sign (e.g. photo%2Bcaption.png vs photo+caption.png)", () => {
      const img = makeImage("photo+caption.png", "data:image/png;base64,encodedplus");
      const html = `<img src="photo%2Bcaption.png" alt="Photo">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,encodedplus"');
    });

    it("matches when src mixes encoded and unencoded special chars (e.g. chart%28v2.0%2Bfinal%29.png)", () => {
      const img = makeImage("chart(v2.0+final).png", "data:image/png;base64,mixedencoded");
      const html = `<img src="chart%28v2.0%2Bfinal%29.png" alt="Chart">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,mixedencoded"');
    });

    it("partial match works when encoded src contains the decoded image name", () => {
      const img = makeImage("image(1)", "data:image/png;base64,partialencoded");
      const html = `<img src="report-image%281%29-2024" alt="Report">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,partialencoded"');
    });

    it("case-insensitive match works with URL-encoded filenames", () => {
      const img = makeImage("Chart(1).PNG", "data:image/png;base64,caseencoded");
      const html = `<img src="chart%281%29.png" alt="Chart">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,caseencoded"');
    });

    it("falls back to transparent pixel when encoded src decodes to a non-matching name", () => {
      const img = makeImage("image(1).png", "data:image/png;base64,parendata");
      const html = `<img src="image%282%29.png" alt="Other">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain(`src="${TRANSPARENT_PIXEL}"`);
    });
  });

  describe("space-encoded and Unicode filenames", () => {
    it("matches when src uses %20 for spaces (e.g. my%20image.png vs my image.png)", () => {
      const img = makeImage("my image.png", "data:image/png;base64,spacedata");
      const html = `<img src="my%20image.png" alt="My image">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,spacedata"');
    });

    it("matches when src uses + for spaces (e.g. my+image.png vs my image.png)", () => {
      const img = makeImage("my image.png", "data:image/png;base64,plusspacedata");
      const html = `<img src="my+image.png" alt="My image">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,plusspacedata"');
    });

    it("matches when src has multiple spaces encoded as %20", () => {
      const img = makeImage("annual report 2024.png", "data:image/png;base64,multispace");
      const html = `<img src="annual%20report%202024.png" alt="Annual report">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,multispace"');
    });

    it("matches NFC src against NFD image name (accented characters)", () => {
      const nfdName = "re\u0301sume\u0301.png";
      const nfcSrc = "r\u00e9sum\u00e9.png";
      const img = makeImage(nfdName, "data:image/png;base64,accentnfd");
      const html = `<img src="${nfcSrc}" alt="Resume">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,accentnfd"');
    });

    it("matches NFD src against NFC image name (accented characters)", () => {
      const nfcName = "r\u00e9sum\u00e9.png";
      const nfdSrc = "re\u0301sume\u0301.png";
      const img = makeImage(nfcName, "data:image/png;base64,accentnfc");
      const html = `<img src="${nfdSrc}" alt="Resume">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,accentnfc"');
    });

    it("matches when space-encoded src also contains percent-encoded special chars", () => {
      const img = makeImage("file (1) copy.png", "data:image/png;base64,spaceparen");
      const html = `<img src="file%20%281%29%20copy.png" alt="File">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,spaceparen"');
    });

    it("matches percent-encoded emoji src against literal emoji image name (%F0%9F%98%80.png vs 😀.png)", () => {
      const img = makeImage("😀.png", "data:image/png;base64,emojidata");
      const html = `<img src="%F0%9F%98%80.png" alt="Smile">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,emojidata"');
    });

    it("matches literal emoji src against literal emoji image name (😀.png vs 😀.png)", () => {
      const img = makeImage("😀.png", "data:image/png;base64,emojidirect");
      const html = `<img src="😀.png" alt="Smile">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,emojidirect"');
    });

    it("matches percent-encoded CJK src against literal CJK image name (%E6%96%87%E4%BB%B6.png vs 文件.png)", () => {
      const img = makeImage("文件.png", "data:image/png;base64,cjkdata");
      const html = `<img src="%E6%96%87%E4%BB%B6.png" alt="File">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,cjkdata"');
    });

    it("matches literal CJK src against literal CJK image name (文件.png vs 文件.png)", () => {
      const img = makeImage("文件.png", "data:image/png;base64,cjkdirect");
      const html = `<img src="文件.png" alt="File">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,cjkdirect"');
    });

    it("matches multi-emoji percent-encoded src against stored emoji filename", () => {
      const img = makeImage("🎉🎊.png", "data:image/png;base64,multiemojidata");
      const html = `<img src="%F0%9F%8E%89%F0%9F%8E%8A.png" alt="Party">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,multiemojidata"');
    });

    it("matches mixed CJK and emoji percent-encoded src against stored filename", () => {
      const img = makeImage("图片😀.png", "data:image/png;base64,mixedcjkemoji");
      const html = `<img src="%E5%9B%BE%E7%89%87%F0%9F%98%80.png" alt="Image">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,mixedcjkemoji"');
    });
  });

  describe("angle brackets in attribute values", () => {
    it("matches src when a preceding attribute contains > inside double quotes", () => {
      const img = makeImage("photo.png", "data:image/png;base64,angledata");
      const html = `<img data-info="a>b" src="photo.png" alt="Photo">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,angledata"');
    });

    it("matches src when a trailing attribute contains > inside single quotes", () => {
      const img = makeImage("shot.png", "data:image/png;base64,angledatatrail");
      const html = `<img src="shot.png" data-label='x>y' alt="Shot">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,angledatatrail"');
    });

    it("matches src when the filename itself contains > inside a double-quoted attribute", () => {
      const img = makeImage("a>b.png", "data:image/png;base64,anglename");
      const html = `<img src="a>b.png" alt="Arrow">`;
      const result = injectImageData(html, [img]);
      expect(result).toContain('src="data:image/png;base64,anglename"');
    });
  });
});

// ensureMissingImages
// ---------------------------------------------------------------------------

describe("ensureMissingImages", () => {
  it("returns the HTML unchanged when the images array is empty", () => {
    const html = `<html><body><p>No images expected</p></body></html>`;
    expect(ensureMissingImages(html, [])).toBe(html);
  });

  it("is a no-op when all images are already present by data URL", () => {
    const imgA = makeImage("figure-1.png", "data:image/png;base64,AAA");
    const imgB = makeImage("figure-2.png", "data:image/png;base64,BBB");
    const html = `<html><body>
      <img src="data:image/png;base64,AAA" alt="Figure 1">
      <img src="data:image/png;base64,BBB" alt="Figure 2">
    </body></html>`;
    expect(ensureMissingImages(html, [imgA, imgB])).toBe(html);
  });

  it("is a no-op when all images are already present by name", () => {
    const imgA = makeImage("diagram.png", "data:image/png;base64,CCC");
    const html = `<html><body><img src="diagram.png" alt="A diagram"></body></html>`;
    expect(ensureMissingImages(html, [imgA])).toBe(html);
  });

  it("injects a single missing image with figure/figcaption markup and correct alt", () => {
    const img = { ...makeImage("chart-revenue.png", "data:image/png;base64,REV"), pageNumber: 5 };
    const html = `<html><body><p>Content</p></body></html>`;
    const result = ensureMissingImages(html, [img]);
    expect(result).toContain(`src="data:image/png;base64,REV"`);
    expect(result).toContain(`alt="Image: chart revenue (page 5)"`);
    expect(result).toContain("<figure>");
    expect(result).toContain("<figcaption>chart revenue</figcaption>");
    expect(result).toContain(`aria-label="Additional document images"`);
    expect(result).toContain("<h2>Additional Images</h2>");
  });

  it("injects multiple missing images each with correct alt text and figure/figcaption", () => {
    const imgA = { ...makeImage("photo_one.jpg", "data:image/png;base64,ONE"), pageNumber: 1 };
    const imgB = { ...makeImage("photo_two.jpg", "data:image/png;base64,TWO"), pageNumber: 2 };
    const imgC = { ...makeImage("photo_three.jpg", "data:image/png;base64,THREE"), pageNumber: 3 };
    const html = `<html><body><p>No images yet</p></body></html>`;
    const result = ensureMissingImages(html, [imgA, imgB, imgC]);
    expect(result).toContain(`src="data:image/png;base64,ONE"`);
    expect(result).toContain(`alt="Image: photo one (page 1)"`);
    expect(result).toContain("<figcaption>photo one</figcaption>");
    expect(result).toContain(`src="data:image/png;base64,TWO"`);
    expect(result).toContain(`alt="Image: photo two (page 2)"`);
    expect(result).toContain("<figcaption>photo two</figcaption>");
    expect(result).toContain(`src="data:image/png;base64,THREE"`);
    expect(result).toContain(`alt="Image: photo three (page 3)"`);
    expect(result).toContain("<figcaption>photo three</figcaption>");
    const figureCount = (result.match(/<figure>/g) ?? []).length;
    expect(figureCount).toBe(3);
  });

  it("only injects the images that are missing, leaving already-present ones untouched", () => {
    const imgA = makeImage("present.png", "data:image/png;base64,PRES");
    const imgB = makeImage("missing.png", "data:image/png;base64,MISS");
    const html = `<html><body><img src="data:image/png;base64,PRES" alt="Already here"></body></html>`;
    const result = ensureMissingImages(html, [imgA, imgB]);
    expect(result).toContain(`src="data:image/png;base64,MISS"`);
    const presCount = (result.match(/base64,PRES/g) ?? []).length;
    expect(presCount).toBe(1);
  });

  it("inserts the section before </body> when that tag is present", () => {
    const img = makeImage("photo.png", "data:image/png;base64,XYZ");
    const html = `<html><body><p>Content</p></body></html>`;
    const result = ensureMissingImages(html, [img]);
    const sectionIdx = result.indexOf(`aria-label="Additional document images"`);
    const bodyCloseIdx = result.indexOf("</body>");
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(sectionIdx).toBeLessThan(bodyCloseIdx);
  });

  it("inserts the section before </main> when there is no </body>", () => {
    const img = makeImage("photo.png", "data:image/png;base64,XYZ");
    const html = `<main><p>Content</p></main>`;
    const result = ensureMissingImages(html, [img]);
    const sectionIdx = result.indexOf(`aria-label="Additional document images"`);
    const mainCloseIdx = result.indexOf("</main>");
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(sectionIdx).toBeLessThan(mainCloseIdx);
  });

  it("appends the section at the very end when neither </body> nor </main> is present", () => {
    const img = makeImage("photo.png", "data:image/png;base64,XYZ");
    const html = `<div><p>Content</p></div>`;
    const result = ensureMissingImages(html, [img]);
    expect(result.endsWith("</section>")).toBe(true);
  });

  it("escapes & in image name so alt and figcaption contain &amp; not raw ampersand", () => {
    const img = { ...makeImage("cats & dogs.png", "data:image/png;base64,AMPTEST"), pageNumber: 2 };
    const html = `<html><body><p>Content</p></body></html>`;
    const result = ensureMissingImages(html, [img]);
    expect(result).toContain(`alt="Image: cats &amp; dogs (page 2)"`);
    expect(result).toContain("<figcaption>cats &amp; dogs</figcaption>");
    expect(result).not.toContain(`alt="Image: cats & dogs`);
  });

  it("escapes \" in image name so the alt attribute value does not break the HTML", () => {
    const img = { ...makeImage('report "final".png', "data:image/png;base64,QUOTETEST"), pageNumber: 1 };
    const html = `<html><body><p>Content</p></body></html>`;
    const result = ensureMissingImages(html, [img]);
    expect(result).toContain(`alt="Image: report &quot;final&quot; (page 1)"`);
    expect(result).not.toMatch(/alt="Image: report "final"/);
  });

  it("escapes < and > in image name so injected markup is not broken by angle brackets", () => {
    const img = { ...makeImage("<figure>.png", "data:image/png;base64,ANGLETEST"), pageNumber: 3 };
    const html = `<html><body><p>Content</p></body></html>`;
    const result = ensureMissingImages(html, [img]);
    expect(result).toContain(`alt="Image: &lt;figure&gt; (page 3)"`);
    expect(result).toContain("<figcaption>&lt;figure&gt;</figcaption>");
    expect(result).not.toMatch(/alt="Image: <figure>/);
  });

  it("escapes all special characters in a single image name containing &, \", <, and >", () => {
    const img = { ...makeImage('A & B <"quoted">.png', "data:image/png;base64,ALLTEST"), pageNumber: 4 };
    const html = `<html><body><p>Content</p></body></html>`;
    const result = ensureMissingImages(html, [img]);
    expect(result).toContain(`alt="Image: A &amp; B &lt;&quot;quoted&quot;&gt; (page 4)"`);
    expect(result).toContain(`<figcaption>A &amp; B &lt;"quoted"&gt;</figcaption>`);
  });

  describe("special characters in filenames – already-present detection", () => {
    it("does not re-inject an image whose name contains dots when already matched by name", () => {
      const img = makeImage("report.v2.0.png", "data:image/png;base64,DOTURL");
      const html = `<html><body><img src="report.v2.0.png" alt="Report"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).not.toContain("Additional document images");
      expect(result).toBe(html);
    });

    it("does not re-inject an image whose name contains plus signs when already matched by name", () => {
      const img = makeImage("photo+caption.png", "data:image/png;base64,PLUSURL");
      const html = `<html><body><img src="photo+caption.png" alt="Photo"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject an image whose name contains parentheses when already matched by name", () => {
      const img = makeImage("image(1).png", "data:image/png;base64,PARENURL");
      const html = `<html><body><img src="image(1).png" alt="Image 1"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when name contains all four special chars and is matched by name", () => {
      const img = makeImage("chart(v2.0+final).png", "data:image/png;base64,ALLURL");
      const html = `<html><body><img src="chart(v2.0+final).png" alt="Chart"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("case-insensitive name match prevents re-injection for names with parentheses and dots", () => {
      const img = makeImage("Chart(V2.0).PNG", "data:image/png;base64,CASEURL");
      const html = `<html><body><img src="chart(v2.0).png" alt="Chart"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("injects image with parentheses in name when absent from HTML", () => {
      const img = { ...makeImage("figure(a).png", "data:image/png;base64,FIGURL"), pageNumber: 2 };
      const html = `<html><body><p>No images</p></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,FIGURL"`);
      expect(result).toContain("Additional document images");
    });

    it("injects image with plus signs in name when absent from HTML", () => {
      const img = { ...makeImage("a+b.png", "data:image/png;base64,PLUSMISSURL"), pageNumber: 1 };
      const html = `<html><body><p>No images</p></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,PLUSMISSURL"`);
    });

    it("injects image with multi-dot name when absent from HTML", () => {
      const img = { ...makeImage("v1.2.3.png", "data:image/png;base64,DOTMISSURL"), pageNumber: 3 };
      const html = `<html><body><p>No images</p></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,DOTMISSURL"`);
    });
  });

  describe("URL-encoded filenames – already-present detection", () => {
    it("does not re-inject when src is %28/%29-encoded and matches image name with parentheses", () => {
      const img = makeImage("image(1).png", "data:image/png;base64,ENCPAREN");
      const html = `<html><body><img src="image%281%29.png" alt="Image 1"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when src uses %2B and matches image name with plus sign", () => {
      const img = makeImage("photo+caption.png", "data:image/png;base64,ENCPLUS");
      const html = `<html><body><img src="photo%2Bcaption.png" alt="Photo"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when src mixes encoded and literal special chars", () => {
      const img = makeImage("chart(v2.0+final).png", "data:image/png;base64,ENCMIXED");
      const html = `<html><body><img src="chart%28v2.0%2Bfinal%29.png" alt="Chart"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("case-insensitive match still works when src is URL-encoded", () => {
      const img = makeImage("Report(Final).PNG", "data:image/png;base64,ENCCASE");
      const html = `<html><body><img src="report%28final%29.png" alt="Report"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("still injects when the encoded src decodes to a different name than the image", () => {
      const img = { ...makeImage("image(1).png", "data:image/png;base64,ENCMISS"), pageNumber: 1 };
      const html = `<html><body><img src="image%282%29.png" alt="Image 2"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,ENCMISS"`);
      expect(result).toContain("Additional document images");
    });
  });

  describe("space-encoded and Unicode filenames – already-present detection", () => {
    it("does not re-inject when src uses %20 for spaces and matches image name with spaces", () => {
      const img = makeImage("my image.png", "data:image/png;base64,SPACEENC");
      const html = `<html><body><img src="my%20image.png" alt="My image"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when src uses + for spaces and matches image name with spaces", () => {
      const img = makeImage("my image.png", "data:image/png;base64,PLUSSPACEENC");
      const html = `<html><body><img src="my+image.png" alt="My image"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when NFC-encoded src matches NFD image name", () => {
      const nfdName = "re\u0301sume\u0301.png";
      const nfcSrc = "r\u00e9sum\u00e9.png";
      const img = makeImage(nfdName, "data:image/png;base64,NFCNFDENC");
      const html = `<html><body><img src="${nfcSrc}" alt="Resume"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when NFD src matches NFC image name", () => {
      const nfcName = "r\u00e9sum\u00e9.png";
      const nfdSrc = "re\u0301sume\u0301.png";
      const img = makeImage(nfcName, "data:image/png;base64,NFDNFCENC");
      const html = `<html><body><img src="${nfdSrc}" alt="Resume"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("still injects accented image when src is a completely different name", () => {
      const img = { ...makeImage("r\u00e9sum\u00e9.png", "data:image/png;base64,ACCENTMISS"), pageNumber: 2 };
      const html = `<html><body><img src="other.png" alt="Other"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,ACCENTMISS"`);
      expect(result).toContain("Additional document images");
    });

    it("does not re-inject when src uses percent-encoded emoji and matches literal emoji image name", () => {
      const img = makeImage("😀.png", "data:image/png;base64,EMOJIENC");
      const html = `<html><body><img src="%F0%9F%98%80.png" alt="Smile"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when src uses literal emoji and matches literal emoji image name", () => {
      const img = makeImage("😀.png", "data:image/png;base64,EMOJIDIRECT");
      const html = `<html><body><img src="😀.png" alt="Smile"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when src uses percent-encoded CJK and matches literal CJK image name", () => {
      const img = makeImage("文件.png", "data:image/png;base64,CJKENC");
      const html = `<html><body><img src="%E6%96%87%E4%BB%B6.png" alt="File"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when src uses literal CJK and matches literal CJK image name", () => {
      const img = makeImage("文件.png", "data:image/png;base64,CJKDIRECT");
      const html = `<html><body><img src="文件.png" alt="File"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("still injects emoji image when src is a completely different name", () => {
      const img = { ...makeImage("😀.png", "data:image/png;base64,EMOJIMISS"), pageNumber: 3 };
      const html = `<html><body><img src="other.png" alt="Other"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,EMOJIMISS"`);
      expect(result).toContain("Additional document images");
    });

    it("still injects CJK image when src is a completely different name", () => {
      const img = { ...makeImage("文件.png", "data:image/png;base64,CJKMISS"), pageNumber: 4 };
      const html = `<html><body><img src="other.png" alt="Other"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,CJKMISS"`);
      expect(result).toContain("Additional document images");
    });
  });

  describe("angle brackets in attribute values – already-present detection", () => {
    it("does not re-inject when a preceding attribute contains > inside double quotes", () => {
      const img = makeImage("photo.png", "data:image/png;base64,ANGLEPRE");
      const html = `<html><body><img data-info="a>b" src="photo.png" alt="Photo"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when a trailing attribute contains > inside single quotes", () => {
      const img = makeImage("shot.png", "data:image/png;base64,ANGLEPOST");
      const html = `<html><body><img src="shot.png" data-label='x>y' alt="Shot"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("does not re-inject when src itself contains > and filename matches", () => {
      const img = makeImage("a>b.png", "data:image/png;base64,ANGLESRC");
      const html = `<html><body><img src="a>b.png" alt="Arrow"></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toBe(html);
    });

    it("injects when the image name contains > but the src attribute does not match", () => {
      const img = { ...makeImage("a>b.png", "data:image/png;base64,ANGLEMISS"), pageNumber: 2 };
      const html = `<html><body><p>No images</p></body></html>`;
      const result = ensureMissingImages(html, [img]);
      expect(result).toContain(`src="data:image/png;base64,ANGLEMISS"`);
      expect(result).toContain("Additional document images");
    });
  });
});

// ---------------------------------------------------------------------------
// fixComplianceIssue — fixture-based regression tests with mocked AI
// ---------------------------------------------------------------------------

function makeReport(issues: ComplianceIssue[]): ComplianceReport {
  return buildComplianceReport(issues);
}

function mockAiResponse(html: string): void {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: html }],
  });
}

describe("fixComplianceIssue – fixture-based regression tests", () => {
  const fixtureHtml = loadFixture("government-form.html");

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("fixes criterion 3.1.1 (Language of Page): returned HTML passes the lang check", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const langIssue = issues.find((i) => i.criterion === "3.1.1")!;
    expect(langIssue.status).toBe("fail");

    const report = makeReport(issues);
    const result = await fixComplianceIssue(fixtureHtml, langIssue, issues.indexOf(langIssue), report);

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterLang = afterIssues.find((i) => i.criterion === "3.1.1")!;
    expect(afterLang.status).toBe("pass");
  });

  it("does not call the AI when fixing the Language of Page issue (3.1.1)", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const langIssue = issues.find((i) => i.criterion === "3.1.1")!;
    const report = makeReport(issues);
    mockCreate.mockClear();
    await fixComplianceIssue(fixtureHtml, langIssue, issues.indexOf(langIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("fixes criterion 2.4.2 (Page Titled): returned HTML passes the title check", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const titleIssue = issues.find((i) => i.criterion === "2.4.2")!;
    expect(titleIssue.status).toBe("fail");

    const report = makeReport(issues);
    const result = await fixComplianceIssue(fixtureHtml, titleIssue, issues.indexOf(titleIssue), report);

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterTitle = afterIssues.find((i) => i.criterion === "2.4.2")!;
    expect(afterTitle.status).toBe("pass");
  });

  it("does not call the AI when fixing the Page Titled issue (2.4.2)", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const titleIssue = issues.find((i) => i.criterion === "2.4.2")!;
    const report = makeReport(issues);
    mockCreate.mockClear();
    await fixComplianceIssue(fixtureHtml, titleIssue, issues.indexOf(titleIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("fixes criterion 2.4.6 (Headings and Labels): returned HTML passes the h1 check", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    const fixedHtml = fixtureHtml.replace(
      "<h2>Form W-99: Household Income Verification Request</h2>",
      "<h1>Form W-99: Household Income Verification Request</h1>"
    );
    mockAiResponse(`<!DOCTYPE html>\n${fixedHtml}`);

    const report = makeReport(issues);
    const result = await fixComplianceIssue(fixtureHtml, headingIssue, issues.indexOf(headingIssue), report);

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterHeading = afterIssues.find((i) => i.criterion === "2.4.6")!;
    expect(afterHeading.status).toBe("pass");
  });

  it("fixes criterion 1.1.1 (Image Descriptions): returned HTML passes the alt-text check", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const altIssue = issues.find((i) => i.criterion === "1.1.1")!;
    expect(altIssue.status).toBe("fail");

    const fixedHtml = fixtureHtml
      .replace('<img src="agency-logo.png">', '<img src="agency-logo.png" alt="Agency logo">')
      .replace('<img src="seal.png">', '<img src="seal.png" alt="Official seal">');
    mockAiResponse(`<!DOCTYPE html>\n${fixedHtml}`);

    const report = makeReport(issues);
    const result = await fixComplianceIssue(fixtureHtml, altIssue, issues.indexOf(altIssue), report);

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterAlt = afterIssues.find((i) => i.criterion === "1.1.1")!;
    expect(afterAlt.status).toBe("pass");
  });

  it("fixes criterion 1.3.1 Table Headers: returned HTML passes the table header check", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const tableIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Table Headers")!;
    expect(tableIssue.status).toBe("fail");

    const fixedHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Form W-99</title></head>
<body>
<main>
  <h1>Form W-99: Household Income Verification Request</h1>
  <table>
    <thead>
      <tr>
        <th scope="col">Last Name</th>
        <th scope="col">First Name</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><input type="text" name="last_name"></td>
        <td><input type="text" name="first_name"></td>
      </tr>
    </tbody>
  </table>
</main>
</body>
</html>`;
    mockAiResponse(fixedHtml);

    const report = makeReport(issues);
    const result = await fixComplianceIssue(fixtureHtml, tableIssue, issues.indexOf(tableIssue), report);

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterTable = afterIssues.find((i) => i.criterion === "1.3.1" && i.title === "Table Headers")!;
    expect(afterTable.status).toBe("pass");
  });

  it("marks the targeted issue as 'fixed' in the returned compliance report when the deterministic check now passes", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const langIssue = issues.find((i) => i.criterion === "3.1.1")!;
    const issueIndex = issues.indexOf(langIssue);

    const report = makeReport(issues);
    const result = await fixComplianceIssue(fixtureHtml, langIssue, issueIndex, report);

    const updatedIssue = result.complianceReport.issues[issueIndex];
    expect(updatedIssue.status).toBe("fixed");
    expect(updatedIssue.criterion).toBe("3.1.1");
  });

  it("throws when the AI returns output that does not start with <!DOCTYPE html> (both attempts fail)", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Sorry, I cannot fix that." }],
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Sorry, I cannot fix that." }],
    });

    const report = makeReport(issues);
    await expect(
      fixComplianceIssue(fixtureHtml, headingIssue, issues.indexOf(headingIssue), report)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
  });

  it("preserves issues that were already 'fixed' and are not targeted by the current fix", async () => {
    const baseIssues = runDeterministicChecks(fixtureHtml);
    const langIssue = baseIssues.find((i) => i.criterion === "3.1.1")!;
    const langIndex = baseIssues.indexOf(langIssue);

    const issuesWithPriorFix: ComplianceIssue[] = baseIssues.map((issue, idx) =>
      idx === 1 ? { ...issue, status: "fixed" } : issue
    );

    const report = makeReport(issuesWithPriorFix);
    const result = await fixComplianceIssue(fixtureHtml, langIssue, langIndex, report);

    const priorFixedIssue = result.complianceReport.issues[1];
    expect(priorFixedIssue.status).toBe("fixed");
  });

  it("strips and restores data URIs so the AI never receives large base64 blobs", async () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const htmlWithDataUri = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><img src="${dataUri}" alt="Pixel"></main></body></html>`;

    const issues = runDeterministicChecks(htmlWithDataUri);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    let capturedInput = "";
    mockCreate.mockImplementationOnce(async ({ messages }: { messages: Array<{ content: string }> }) => {
      capturedInput = messages[0].content;
      return { content: [{ type: "text", text: htmlWithDataUri }] };
    });

    const report = makeReport(issues);
    await fixComplianceIssue(htmlWithDataUri, headingIssue, issues.indexOf(headingIssue), report);

    expect(capturedInput).not.toContain("data:image/png;base64,iVBOR");
    expect(capturedInput).toContain("__IMG_PLACEHOLDER_");
  });

  it("fixes criterion 1.3.1 ARIA Role on Table Data Cell: replaces td role=columnheader with th scope=col", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Table</h1><table><thead><tr><td role="columnheader">Name</td><td role="columnheader">Value</td></tr></thead><tbody><tr><td>Row 1</td><td>Data 1</td></tr></tbody></table></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const ariaIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell")!;
    expect(ariaIssue).toBeDefined();
    expect(ariaIssue.status).toBe("warning");

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, ariaIssue, issues.indexOf(ariaIssue), report);

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterAriaIssue = afterIssues.find((i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell");
    expect(afterAriaIssue).toBeUndefined();
    expect(result.accessibleHtml).toContain('<th scope="col">');
    expect(result.accessibleHtml).not.toContain('role="columnheader"');
  });

  it("fixes criterion 1.3.1 ARIA Role on Table Data Cell: replaces td role=rowheader with th scope=row", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Table</h1><table><thead><tr><th scope="col">Category</th><th scope="col">Score</th></tr></thead><tbody><tr><td role="rowheader">Section A</td><td>95</td></tr></tbody></table></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const ariaIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell")!;
    expect(ariaIssue).toBeDefined();

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, ariaIssue, issues.indexOf(ariaIssue), report);

    expect(result.accessibleHtml).toContain('<th scope="row">');
    expect(result.accessibleHtml).not.toContain('role="rowheader"');
    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterAriaIssue = afterIssues.find((i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell");
    expect(afterAriaIssue).toBeUndefined();
  });

  it("does not call the AI when fixing the ARIA Role on Table Data Cell issue", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Table</h1><table><thead><tr><td role="columnheader">Col</td></tr></thead><tbody><tr><td>Data</td></tr></tbody></table></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const ariaIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell")!;
    const report = makeReport(issues);
    mockCreate.mockClear();
    await fixComplianceIssue(html, ariaIssue, issues.indexOf(ariaIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// applyAriaRoleHeaderFix
// ---------------------------------------------------------------------------

describe("applyAriaRoleHeaderFix", () => {
  it("converts <td role=columnheader> to <th scope=col>", () => {
    const html = `<table><tr><td role="columnheader">Name</td></tr></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain('<th scope="col">Name</th>');
    expect(result).not.toContain('<td');
    expect(result).not.toContain('role="columnheader"');
  });

  it("converts <td role=rowheader> to <th scope=row>", () => {
    const html = `<table><tr><td role="rowheader">Row A</td><td>Data</td></tr></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain('<th scope="row">Row A</th>');
    expect(result).not.toContain('role="rowheader"');
    expect(result).toContain('<td>Data</td>');
  });

  it("handles multiple cells with different roles in the same table", () => {
    const html = `<table><thead><tr><td role="columnheader">Col</td></tr></thead><tbody><tr><td role="rowheader">Row</td><td>Val</td></tr></tbody></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain('<th scope="col">Col</th>');
    expect(result).toContain('<th scope="row">Row</th>');
    expect(result).toContain('<td>Val</td>');
  });

  it("preserves other attributes on the td element (excluding role)", () => {
    const html = `<table><tr><td role="columnheader" class="header-cell" id="col1">Name</td></tr></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain('scope="col"');
    expect(result).toContain('class="header-cell"');
    expect(result).toContain('id="col1"');
    expect(result).not.toContain('role="columnheader"');
  });

  it("returns the HTML unchanged when no td cells have ARIA header roles", () => {
    const html = `<table><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td>Data</td></tr></tbody></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toBe(html);
  });

  it("fixed HTML no longer triggers the 1.3.1 ARIA Role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><table><thead><tr><td role="columnheader">Name</td></tr></thead><tbody><tr><td>Val</td></tr></tbody></table></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Role on Table Data Cell")).toBeDefined();

    const fixed = applyAriaRoleHeaderFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Role on Table Data Cell")).toBeUndefined();
  });

  it("preserves rich inner HTML when promoting td[role=columnheader] to <th>", () => {
    const html = `<table><tr><td role="columnheader"><strong>First</strong> <em>Name</em></td></tr></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain('<th scope="col">');
    expect(result).toContain("<strong>First</strong>");
    expect(result).toContain("<em>Name</em>");
    expect(result).not.toContain('role="columnheader"');
    expect(result).not.toContain("<td");
  });

  it("preserves rich inner HTML when promoting td[role=rowheader] to <th>", () => {
    const html = `<table><tr><td role="rowheader"><span class="label"><em>Row</em></span></td><td>Data</td></tr></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain('<th scope="row">');
    expect(result).toContain('<span class="label">');
    expect(result).toContain("<em>Row</em>");
    expect(result).not.toContain('role="rowheader"');
  });
});

// ---------------------------------------------------------------------------
// deterministicFixerRegistry – dispatch
// ---------------------------------------------------------------------------

describe("deterministicFixerRegistry – dispatch", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("routes a registered key to the deterministic fixer and does not call AI", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Table</h1><table><thead><tr><td role="columnheader">Name</td><td role="columnheader">Score</td></tr></thead><tbody><tr><td>Alice</td><td>95</td></tr></tbody></table></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const ariaIssue = issues.find(
      (i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell"
    )!;
    expect(ariaIssue).toBeDefined();

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, ariaIssue, issues.indexOf(ariaIssue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).toContain('<th scope="col">');
    expect(result.accessibleHtml).not.toContain('role="columnheader"');
  });

  it("routes a registered key to the correct fixer and returns transformed HTML", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Data</h1><table><tbody><tr><td role="rowheader">Row A</td><td>Val</td></tr></tbody></table></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const ariaIssue = issues.find(
      (i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell"
    )!;

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, ariaIssue, issues.indexOf(ariaIssue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).toContain('<th scope="row">Row A</th>');
    expect(result.accessibleHtml).not.toContain('role="rowheader"');
  });

  it("falls through to AI for an unregistered criterion+title key", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><div><h2>Sub</h2></div></body></html>`;
    const issues = runDeterministicChecks(html);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6" && i.title === "Headings and Labels")!;
    expect(headingIssue.status).toBe("fail");

    const fixedHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><div><h1>Main</h1><h2>Sub</h2></div></body></html>`;
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: `<!DOCTYPE html>\n${fixedHtml}` }],
    });

    const report = makeReport(issues);
    await fixComplianceIssue(html, headingIssue, issues.indexOf(headingIssue), report);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the deterministic fixer when the key is not registered", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><div style="position: absolute; top: 0">Floated</div></body></html>`;
    const issues = runDeterministicChecks(html);
    const readingOrderIssue = issues.find((i) => i.criterion === "1.3.2" && i.title === "Reading Order")!;
    expect(readingOrderIssue.status).toBe("warning");

    const fixedHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><div>Floated</div></body></html>`;
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: fixedHtml }],
    });

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, readingOrderIssue, issues.indexOf(readingOrderIssue), report);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.accessibleHtml).not.toContain("position: absolute");
  });

  it("marks the targeted issue as 'fixed' in the returned complianceReport after a deterministic fix", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Table</h1><table><thead><tr><td role="columnheader">Name</td><td role="columnheader">Score</td></tr></thead><tbody><tr><td>Alice</td><td>95</td></tr></tbody></table></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const ariaIssue = issues.find(
      (i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell"
    )!;
    expect(ariaIssue).toBeDefined();
    const issueIndex = issues.indexOf(ariaIssue);

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, ariaIssue, issueIndex, report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.complianceReport.issues[issueIndex].status).toBe("fixed");
    expect(result.complianceReport.issues[issueIndex].criterion).toBe("1.3.1");
  });
});

// ---------------------------------------------------------------------------
// applyAriaComboboxRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaComboboxRoleFix", () => {
  it("converts <div role=combobox> to <select>", () => {
    const html = `<div role="combobox"><option value="a">A</option></div>`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toContain("<select>");
    expect(result).toContain("</select>");
    expect(result).not.toContain('role="combobox"');
    expect(result).not.toContain("<div");
  });

  it("preserves inner content when replacing the element", () => {
    const html = `<span role="combobox">Choose one</span>`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toContain("Choose one");
    expect(result).toContain("<select>");
  });

  it("preserves other attributes on the element (excluding role)", () => {
    const html = `<div role="combobox" class="my-combo" id="combo1">Pick</div>`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toContain('class="my-combo"');
    expect(result).toContain('id="combo1"');
    expect(result).not.toContain('role="combobox"');
  });

  it("handles single-quoted role attribute correctly", () => {
    const html = `<div role='combobox'>Pick</div>`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toContain("<select>");
    expect(result).not.toContain("role='combobox'");
    expect(result).not.toContain("<div");
  });

  it("does not change <select role=combobox> (already a select)", () => {
    const html = `<select role="combobox"><option>A</option></select>`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toBe(html);
  });

  it("does not change <input role=combobox> (already an input)", () => {
    const html = `<input role="combobox" type="text">`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toBe(html);
  });

  it("fixed HTML no longer triggers the combobox ARIA warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="combobox">Choose</div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element")).toBeDefined();

    const fixed = applyAriaComboboxRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element")).toBeUndefined();
  });

  it("is dispatched deterministically by fixComplianceIssue without calling AI", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="combobox">Choose</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const comboIssue = issues.find((i) => i.title === "ARIA Combobox Role on Non-Combobox Element")!;
    const report = buildComplianceReport(issues);

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, comboIssue, issues.indexOf(comboIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).not.toContain('role="combobox"');
    expect(result.accessibleHtml).toContain("<select");
  });

  it("preserves rich inner HTML when replacing with <select>", () => {
    const html = `<div role="combobox"><option value="a"><strong>Option</strong> <em>A</em></option></div>`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toContain("<strong>Option</strong>");
    expect(result).toContain("<em>A</em>");
    expect(result).toContain("<select");
    expect(result).not.toContain('role="combobox"');
    expect(result).not.toContain("<div");
  });
});

// ---------------------------------------------------------------------------
// applyAriaGridRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaGridRoleFix", () => {
  it("converts <div role=grid> to <table>", () => {
    const html = `<div role="grid"><tr><td>Cell</td></tr></div>`;
    const result = applyAriaGridRoleFix(html);
    expect(result).toContain("<table>");
    expect(result).toContain("</table>");
    expect(result).not.toContain('role="grid"');
    expect(result).not.toContain("<div");
  });

  it("preserves inner content when replacing the element", () => {
    const html = `<section role="grid"><tr><td>Data</td></tr></section>`;
    const result = applyAriaGridRoleFix(html);
    expect(result).toContain("Data");
    expect(result).toContain("<table>");
  });

  it("preserves other attributes on the element (excluding role)", () => {
    const html = `<div role="grid" class="data-grid" aria-label="Results">Content</div>`;
    const result = applyAriaGridRoleFix(html);
    expect(result).toContain('class="data-grid"');
    expect(result).toContain('aria-label="Results"');
    expect(result).not.toContain('role="grid"');
  });

  it("handles single-quoted role attribute correctly", () => {
    const html = `<div role='grid'><tr><td>Cell</td></tr></div>`;
    const result = applyAriaGridRoleFix(html);
    expect(result).toContain("<table>");
    expect(result).not.toContain("role='grid'");
    expect(result).not.toContain("<div");
  });

  it("does not change <table role=grid> (already a table)", () => {
    const html = `<table role="grid"><tr><td>Cell</td></tr></table>`;
    const result = applyAriaGridRoleFix(html);
    expect(result).toBe(html);
  });

  it("fixed HTML no longer triggers the grid ARIA warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="grid"><tr><td>Cell</td></tr></div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Grid Role on Non-Table Element")).toBeDefined();

    const fixed = applyAriaGridRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Grid Role on Non-Table Element")).toBeUndefined();
  });

  it("is dispatched deterministically by fixComplianceIssue without calling AI", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="grid"><tr><td>Cell</td></tr></div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const gridIssue = issues.find((i) => i.title === "ARIA Grid Role on Non-Table Element")!;
    const report = buildComplianceReport(issues);

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, gridIssue, issues.indexOf(gridIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).not.toContain('role="grid"');
    expect(result.accessibleHtml).toContain("<table");
  });

  it("preserves rich inner HTML (formatted cell content) when replacing with <table>", () => {
    const html = `<div role="grid"><tr><td><strong>Header</strong></td><td><em>Data</em></td></tr></div>`;
    const result = applyAriaGridRoleFix(html);
    expect(result).toContain("<strong>Header</strong>");
    expect(result).toContain("<em>Data</em>");
    expect(result).toContain("<table");
    expect(result).not.toContain('role="grid"');
    expect(result).not.toContain("<div");
  });
});

// ---------------------------------------------------------------------------
// applyAriaTabRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaTabRoleFix", () => {
  it("converts <div role=tab> to <button>", () => {
    const html = `<div role="tab">Tab One</div>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toContain("<button>");
    expect(result).toContain("</button>");
    expect(result).not.toContain('role="tab"');
    expect(result).not.toContain("<div");
  });

  it("preserves inner content when replacing the element", () => {
    const html = `<span role="tab">Profile</span>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toContain("Profile");
    expect(result).toContain("<button>");
  });

  it("preserves other attributes on the element (excluding role)", () => {
    const html = `<div role="tab" class="tab-item" aria-selected="true">Settings</div>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toContain('class="tab-item"');
    expect(result).toContain('aria-selected="true"');
    expect(result).not.toContain('role="tab"');
  });

  it("handles single-quoted role attribute correctly", () => {
    const html = `<div role='tab'>Tab One</div>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toContain("<button>");
    expect(result).not.toContain("role='tab'");
    expect(result).not.toContain("<div");
  });

  it("does not change <button role=tab> (already a button)", () => {
    const html = `<button role="tab">Click</button>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toBe(html);
  });

  it("does not change <a role=tab> (anchor is allowed)", () => {
    const html = `<a role="tab" href="#">Link Tab</a>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toBe(html);
  });

  it("fixed HTML no longer triggers the tab ARIA warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="tab">Tab One</div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element")).toBeDefined();

    const fixed = applyAriaTabRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element")).toBeUndefined();
  });

  it("is dispatched deterministically by fixComplianceIssue without calling AI", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="tab">Tab One</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const tabIssue = issues.find((i) => i.title === "ARIA Tab Role on Non-Interactive Element")!;
    const report = buildComplianceReport(issues);

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, tabIssue, issues.indexOf(tabIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).not.toContain('role="tab"');
    expect(result.accessibleHtml).toContain("<button");
  });

  it("preserves rich inner HTML when replacing with <button>", () => {
    const html = `<div role="tab"><strong>My</strong> <em>Tab</em></div>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toContain("<strong>My</strong>");
    expect(result).toContain("<em>Tab</em>");
    expect(result).toContain("<button");
    expect(result).not.toContain('role="tab"');
    expect(result).not.toContain("<div");
  });
});

// ---------------------------------------------------------------------------
// applyAriaButtonRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaButtonRoleFix", () => {
  it("converts <div role=button> to <button>", () => {
    const html = `<div role="button">Click me</div>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toContain("<button>");
    expect(result).toContain("</button>");
    expect(result).not.toContain('role="button"');
    expect(result).not.toContain("<div");
  });

  it("converts <span role=button> to <button>", () => {
    const html = `<span role="button">Submit</span>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toContain("<button>Submit</button>");
    expect(result).not.toContain('role="button"');
    expect(result).not.toContain("<span");
  });

  it("preserves inner content when replacing the element", () => {
    const html = `<div role="button"><span>Icon</span> Label</div>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toContain("<span>Icon</span>");
    expect(result).toContain("Label");
    expect(result).toContain("<button");
  });

  it("preserves other attributes on the element (excluding role)", () => {
    const html = `<div role="button" class="btn" id="save-btn">Save</div>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toContain('class="btn"');
    expect(result).toContain('id="save-btn"');
    expect(result).not.toContain('role="button"');
  });

  it("handles single-quoted role attribute correctly", () => {
    const html = `<div role='button'>Click</div>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toContain("<button>");
    expect(result).not.toContain("role='button'");
    expect(result).not.toContain("<div");
  });

  it("does not change native <button> elements", () => {
    const html = `<button type="button">Click me</button>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toBe(html);
  });

  it("does not change <button role=button> (redundant but acceptable)", () => {
    const html = `<button role="button">OK</button>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toBe(html);
  });

  it("removes role=button from <input type=text> without converting to <button>", () => {
    const html = `<input type="text" role="button">`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).not.toContain('role="button"');
    expect(result).toContain("<input");
  });

  it("fixed HTML no longer triggers the 4.1.2 ARIA button role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="button">Click me</div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Button Role on Non-Button Element")).toBeDefined();

    const fixed = applyAriaButtonRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Button Role on Non-Button Element")).toBeUndefined();
  });

  it("is dispatched deterministically by fixComplianceIssue without calling AI", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="button">Click me</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const buttonIssue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element")!;
    expect(buttonIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, buttonIssue, issues.indexOf(buttonIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).not.toContain('role="button"');
    expect(result.accessibleHtml).toContain("<button");
  });

  it("resolves the warning after fix (issue marked fixed in report)", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><span role="button">Go</span></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const buttonIssue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element")!;
    const issueIndex = issues.indexOf(buttonIssue);
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, buttonIssue, issueIndex, report);
    const updatedIssue = result.complianceReport.issues[issueIndex];
    expect(updatedIssue.status).toBe("fixed");
  });

  it("elementsFixed equals the number of non-button elements with role=button", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="button">A</div><span role="button">B</span><p role="button">C</p></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const buttonIssue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element")!;
    expect(buttonIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, buttonIssue, issues.indexOf(buttonIssue), report);
    expect(result.elementsFixed).toBe(3);
  });

  it("elementsFixed is 1 when exactly one non-button element has role=button", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="button">Click</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const buttonIssue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element")!;
    expect(buttonIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, buttonIssue, issues.indexOf(buttonIssue), report);
    expect(result.elementsFixed).toBe(1);
  });

  it("elementsFixed does not count native <button> or button-type inputs with role=button", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><span role="button">Go</span><button role="button">OK</button><input type="button" role="button"></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const buttonIssue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element")!;
    expect(buttonIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, buttonIssue, issues.indexOf(buttonIssue), report);
    expect(result.elementsFixed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// applyAriaHeadingRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaHeadingRoleFix", () => {
  it("converts <div role=heading aria-level=2> to <h2>", () => {
    const html = `<div role="heading" aria-level="2">Section Title</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>Section Title</h2>");
    expect(result).not.toContain('role="heading"');
    expect(result).not.toContain('aria-level');
    expect(result).not.toContain("<div");
  });

  it("defaults to <h2> when aria-level is absent", () => {
    const html = `<span role="heading">Section</span>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>Section</h2>");
    expect(result).not.toContain('role="heading"');
  });

  it("uses aria-level=3 to produce <h3>", () => {
    const html = `<p role="heading" aria-level="3">Subsection</p>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h3>Subsection</h3>");
    expect(result).not.toContain('role="heading"');
  });

  it("clamps out-of-range aria-level values", () => {
    const html = `<div role="heading" aria-level="7">Too deep</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h6>Too deep</h6>");
  });

  it("preserves other attributes on the element (excluding role and aria-level)", () => {
    const html = `<div role="heading" aria-level="2" class="section-head" id="sec1">Title</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain('class="section-head"');
    expect(result).toContain('id="sec1"');
    expect(result).not.toContain('role="heading"');
    expect(result).not.toContain('aria-level');
  });

  it("preserves inner content when replacing the element", () => {
    const html = `<div role="heading" aria-level="2"><strong>Bold</strong> Title</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<strong>Bold</strong>");
    expect(result).toContain("<h2");
  });

  it("handles single-quoted role attribute correctly", () => {
    const html = `<div role='heading' aria-level='2'>Section</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>");
    expect(result).not.toContain("role='heading'");
    expect(result).not.toContain("<div");
  });

  it("does not change native heading elements", () => {
    const html = `<h2>Section Title</h2>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toBe(html);
  });

  it("fixed HTML no longer triggers the 1.3.1 ARIA heading role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="heading" aria-level="2">Section</div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Heading Role on Non-Heading Element")).toBeDefined();

    const fixed = applyAriaHeadingRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Heading Role on Non-Heading Element")).toBeUndefined();
  });

  it("is dispatched deterministically by fixComplianceIssue without calling AI", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="heading" aria-level="2">Section</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const headingIssue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element")!;
    expect(headingIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, headingIssue, issues.indexOf(headingIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).not.toContain('role="heading"');
    expect(result.accessibleHtml).toContain("<h2");
  });

  it("resolves the warning after fix (issue marked fixed in report)", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><span role="heading" aria-level="3">Sub</span></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const headingIssue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element")!;
    const issueIndex = issues.indexOf(headingIssue);
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, headingIssue, issueIndex, report);
    const updatedIssue = result.complianceReport.issues[issueIndex];
    expect(updatedIssue.status).toBe("fixed");
  });

  it("infers level from preceding h1 when aria-level is absent", () => {
    const html = `<h1>Page Title</h1><div role="heading">Section</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h1>Section</h1>");
    expect(result).not.toContain('role="heading"');
  });

  it("infers level from preceding h2 when aria-level is absent", () => {
    const html = `<h2>Chapter</h2><span role="heading">Subsection</span>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>Subsection</h2>");
    expect(result).not.toContain('role="heading"');
  });

  it("each element without aria-level independently uses the last preceding native heading", () => {
    const html = `<h1>Title</h1><div role="heading">First</div><h3>Sub</h3><div role="heading">Second</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h1>First</h1>");
    expect(result).toContain("<h3>Second</h3>");
    expect(result).not.toContain('role="heading"');
  });

  it("falls back to h2 when no preceding heading context exists", () => {
    const html = `<div role="heading">Orphan</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>Orphan</h2>");
  });

  it("does not use a heading that follows the target as context", () => {
    const html = `<div role="heading">First</div><h3>Later Heading</h3>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>First</h2>");
  });

  it("infers correct level for duplicate outerHTML targets based on DOM position", () => {
    const html = `<h1>A</h1><div role="heading">X</div><h3>B</h3><div role="heading">X</div>`;
    const result = applyAriaHeadingRoleFix(html);
    const firstIdx = result.indexOf("<h1>X</h1>");
    const thirdIdx = result.indexOf("<h3>X</h3>");
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(thirdIdx).toBeGreaterThan(firstIdx);
    expect(result).not.toContain('role="heading"');
  });

  it("inherits level from a preceding ARIA heading with explicit aria-level", () => {
    const html = `<div role="heading" aria-level="4">Section</div><span role="heading">Subsection</span>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h4>Section</h4>");
    expect(result).toContain("<h4>Subsection</h4>");
    expect(result).not.toContain('role="heading"');
  });

  it("chains inferred levels across consecutive ARIA-only headings", () => {
    const html = `<h2>Chapter</h2><div role="heading">First</div><div role="heading">Second</div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>First</h2>");
    expect(result).toContain("<h2>Second</h2>");
    expect(result).not.toContain('role="heading"');
  });

  // --- nested container tests ---

  it("inherits level from a native heading outside its containing section", () => {
    const html = `<h2>Outside</h2><section><div role="heading">Inside</div></section>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>Inside</h2>");
    expect(result).not.toContain('role="heading"');
  });

  it("carries forward level across sibling subtrees (native h3 in first article, ARIA heading in second)", () => {
    const html = `<article><h3>Chapter</h3></article><article><div role="heading">Next</div></article>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h3>Next</h3>");
    expect(result).not.toContain('role="heading"');
  });

  it("resolves a deeply nested ARIA heading using the last preceding native heading in DFS order", () => {
    const html = `<h1>Page</h1><div><div><div><div role="heading">Deep</div></div></div></div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h1>Deep</h1>");
    expect(result).not.toContain('role="heading"');
  });

  it("carries forward context to multiple ARIA headings across separate nested sections", () => {
    const html = `<section><h2>S1</h2></section><section><div role="heading">S2</div></section><section><div role="heading">S3</div></section>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h2>S2</h2>");
    expect(result).toContain("<h2>S3</h2>");
    expect(result).not.toContain('role="heading"');
  });

  it("carries the resolved level of an ARIA heading in one subtree to an ARIA heading in a sibling subtree", () => {
    const html = `<div><div role="heading" aria-level="3">A</div></div><div><div role="heading">B</div></div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h3>A</h3>");
    expect(result).toContain("<h3>B</h3>");
    expect(result).not.toContain('role="heading"');
  });

  it("native heading nested inside a div is still visible as context to an ARIA heading in a sibling div", () => {
    const html = `<div><h4>Nested Native</h4></div><div><span role="heading">Sibling ARIA</span></div>`;
    const result = applyAriaHeadingRoleFix(html);
    expect(result).toContain("<h4>Sibling ARIA</h4>");
    expect(result).not.toContain('role="heading"');
  });

  it("ignores a native heading that appears after the ARIA heading in DFS order even when in a nested structure", () => {
    const html = `<div><span role="heading">First</span></div><div><h3>Later</h3></div>`;
    const result = applyAriaHeadingRoleFix(html);
    // No preceding heading exists, so falls back to h2
    expect(result).toContain("<h2>First</h2>");
    expect(result).not.toContain('role="heading"');
  });

  it("elementsFixed equals the number of non-heading elements with role=heading", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="heading" aria-level="2">A</div><span role="heading" aria-level="3">B</span><p role="heading">C</p></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const headingIssue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element")!;
    expect(headingIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, headingIssue, issues.indexOf(headingIssue), report);
    expect(result.elementsFixed).toBe(3);
  });

  it("elementsFixed is 1 when exactly one non-heading element has role=heading", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="heading" aria-level="2">Section</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const headingIssue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element")!;
    expect(headingIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, headingIssue, issues.indexOf(headingIssue), report);
    expect(result.elementsFixed).toBe(1);
  });

  it("elementsFixed does not count native heading elements with role=heading", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><span role="heading" aria-level="2">Fake</span><h2 role="heading">Real</h2></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const headingIssue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element")!;
    expect(headingIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, headingIssue, issues.indexOf(headingIssue), report);
    expect(result.elementsFixed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// analyzeAriaHeadingFallbacks
// ---------------------------------------------------------------------------

describe("analyzeAriaHeadingFallbacks", () => {
  it("returns 0/0 when there are no role=heading targets", () => {
    const html = `<h1>Title</h1><p>Paragraph</p>`;
    const result = analyzeAriaHeadingFallbacks(html);
    expect(result.fallbackCount).toBe(0);
    expect(result.inferredCount).toBe(0);
  });

  it("returns 0/0 when all role=heading elements have explicit aria-level", () => {
    const html = `<div role="heading" aria-level="2">Section A</div><span role="heading" aria-level="3">Section B</span>`;
    const result = analyzeAriaHeadingFallbacks(html);
    expect(result.fallbackCount).toBe(0);
    expect(result.inferredCount).toBe(0);
  });

  it("counts fallbackCount=1 for an element with no aria-level and no preceding heading", () => {
    const html = `<div role="heading">Orphan Section</div>`;
    const result = analyzeAriaHeadingFallbacks(html);
    expect(result.fallbackCount).toBe(1);
    expect(result.inferredCount).toBe(0);
  });

  it("counts inferredCount=1 for an element with no aria-level but a preceding native heading", () => {
    const html = `<h1>Page Title</h1><div role="heading">Section</div>`;
    const result = analyzeAriaHeadingFallbacks(html);
    expect(result.fallbackCount).toBe(0);
    expect(result.inferredCount).toBe(1);
  });

  it("handles mixed case: fallback, inferred, and explicit each contribute independently", () => {
    const html = [
      `<div role="heading">No context (fallback)</div>`,
      `<h2>Native heading</h2>`,
      `<span role="heading">After h2 (inferred)</span>`,
      `<p role="heading" aria-level="3">Has aria-level (explicit)</p>`,
    ].join("");
    const result = analyzeAriaHeadingFallbacks(html);
    expect(result.fallbackCount).toBe(1);
    expect(result.inferredCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// applyDeterministicReport
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<ComplianceIssue> = {}): ComplianceIssue {
  return {
    criterion: "3.1.1",
    title: "Language of Page",
    level: "A",
    status: "fail",
    description: "The language of the page must be declared.",
    details: "No lang attribute found.",
    ...overrides,
  };
}

const BASE_HTML = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Hello</h1></main></body></html>`;
const NO_LANG_HTML = `<!DOCTYPE html><html><head><title>Test</title></head><body><main><h1>Hello</h1></main></body></html>`;

describe("applyDeterministicReport", () => {
  it("marks the target issue as 'fixed' when the deterministic check now passes", () => {
    const issue = makeIssue({ criterion: "3.1.1", title: "Language of Page", status: "fail" });
    const updatedIssues: ComplianceIssue[] = [{ ...issue }];

    applyDeterministicReport(BASE_HTML, issue, 0, updatedIssues);

    expect(updatedIssues[0].status).toBe("fixed");
  });

  it("leaves the target issue unchanged when the deterministic check still fails", () => {
    const issue = makeIssue({ criterion: "3.1.1", title: "Language of Page", status: "fail" });
    const updatedIssues: ComplianceIssue[] = [{ ...issue }];

    applyDeterministicReport(NO_LANG_HTML, issue, 0, updatedIssues);

    expect(updatedIssues[0].status).toBe("fail");
  });

  it("does not overwrite a non-target issue that is already 'fixed'", () => {
    const alreadyFixed = makeIssue({ criterion: "3.1.1", title: "Language of Page", status: "fixed" });
    const targetIssue = makeIssue({ criterion: "2.4.2", title: "Page Titled", status: "fail", details: "No title found." });
    const updatedIssues: ComplianceIssue[] = [{ ...alreadyFixed }, { ...targetIssue }];

    applyDeterministicReport(BASE_HTML, targetIssue, 1, updatedIssues);

    expect(updatedIssues[0].status).toBe("fixed");
  });

  it("applies a fallback 'fixed' label when the target issue is not in the deterministic map", () => {
    const aiOnlyIssue = makeIssue({
      criterion: "4.1.2",
      title: "Name Role Value",
      status: "fail",
      details: "Interactive element lacks a name.",
    });
    const updatedIssues: ComplianceIssue[] = [{ ...aiOnlyIssue }];

    applyDeterministicReport(BASE_HTML, aiOnlyIssue, 0, updatedIssues);

    expect(updatedIssues[0].status).toBe("fixed");
    expect(updatedIssues[0].details).toBe("Fixed: Interactive element lacks a name.");
  });

  it("updates a non-target, non-fixed issue whose criterion is in the deterministic map", () => {
    // index 0: non-target issue for 3.1.1 that was failing — should be refreshed by the loop
    const nonTargetIssue = makeIssue({
      criterion: "3.1.1",
      title: "Language of Page",
      status: "fail",
      details: "No lang attribute found.",
    });
    // index 1: target issue not in the deterministic map — gets the fallback fixed label
    const targetIssue = makeIssue({
      criterion: "4.1.2",
      title: "Name Role Value",
      status: "fail",
      details: "Interactive element lacks a name.",
    });
    const updatedIssues: ComplianceIssue[] = [{ ...nonTargetIssue }, { ...targetIssue }];

    // BASE_HTML has lang="en", so the 3.1.1 deterministic check will now pass
    applyDeterministicReport(BASE_HTML, targetIssue, 1, updatedIssues);

    // The non-target issue at index 0 should be refreshed to the fresh check result ("pass")
    expect(updatedIssues[0].status).toBe("pass");
    // The target issue at index 1 should get the fallback fixed treatment
    expect(updatedIssues[1].status).toBe("fixed");
  });

  it("degrades a non-target issue from 'pass' to 'fail' when the fresh deterministic check returns 'fail'", () => {
    // A non-target issue for 3.1.1 that was previously passing
    const nonTargetIssue = makeIssue({
      criterion: "3.1.1",
      title: "Language of Page",
      status: "pass",
      details: "lang attribute is present.",
    });
    // Target issue not in the deterministic map — gets fallback fixed label
    const targetIssue = makeIssue({
      criterion: "4.1.2",
      title: "Name Role Value",
      status: "fail",
      details: "Interactive element lacks a name.",
    });
    const updatedIssues: ComplianceIssue[] = [{ ...nonTargetIssue }, { ...targetIssue }];

    // NO_LANG_HTML has no lang attribute, so the 3.1.1 deterministic check returns "fail"
    applyDeterministicReport(NO_LANG_HTML, targetIssue, 1, updatedIssues);

    // The non-target issue should be degraded from "pass" to "fail"
    expect(updatedIssues[0].status).toBe("fail");
    // The target issue should still receive the fallback fixed treatment
    expect(updatedIssues[1].status).toBe("fixed");
  });

  it("sets details to mention the h1 source heading when the 2.4.2 fix finds an h1", () => {
    const pageTitleIssue = makeIssue({
      criterion: "2.4.2",
      title: "Page Titled",
      status: "fail",
      details: "The document is missing a title.",
    });
    const updatedIssues: ComplianceIssue[] = [{ ...pageTitleIssue }];
    const fixedHtml = `<!DOCTYPE html><html lang="en"><head><title>About Us</title></head><body><h1>About Us</h1></body></html>`;

    applyDeterministicReport(fixedHtml, pageTitleIssue, 0, updatedIssues);

    expect(updatedIssues[0].status).toBe("fixed");
    expect(updatedIssues[0].details).toBe("Title set to 'About Us' from the first <h1>");
  });

  it("sets details to mention the h2 source heading when the 2.4.2 fix uses h2", () => {
    const pageTitleIssue = makeIssue({
      criterion: "2.4.2",
      title: "Page Titled",
      status: "fail",
      details: "The document is missing a title.",
    });
    const updatedIssues: ComplianceIssue[] = [{ ...pageTitleIssue }];
    const fixedHtml = `<!DOCTYPE html><html lang="en"><head><title>Contact</title></head><body><h2>Contact</h2></body></html>`;

    applyDeterministicReport(fixedHtml, pageTitleIssue, 0, updatedIssues);

    expect(updatedIssues[0].status).toBe("fixed");
    expect(updatedIssues[0].details).toBe("Title set to 'Contact' from the first <h2>");
  });

  it("uses the generic details message when 2.4.2 fix fell back to 'Document'", () => {
    const pageTitleIssue = makeIssue({
      criterion: "2.4.2",
      title: "Page Titled",
      status: "fail",
      details: "The document is missing a title.",
    });
    const updatedIssues: ComplianceIssue[] = [{ ...pageTitleIssue }];
    const fixedHtml = `<!DOCTYPE html><html lang="en"><head><title>Document</title></head><body><p>No headings here</p></body></html>`;

    applyDeterministicReport(fixedHtml, pageTitleIssue, 0, updatedIssues);

    expect(updatedIssues[0].status).toBe("fixed");
    expect(updatedIssues[0].details).not.toContain("from the first");
    expect(updatedIssues[0].details).toContain("descriptive title");
  });
});

// ---------------------------------------------------------------------------
// applyAriaLinkRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaLinkRoleFix", () => {
  it("converts <div role=link> to <a href=#>", () => {
    const html = `<div role="link" tabindex="0">Go somewhere</div>`;
    const result = applyAriaLinkRoleFix(html);
    expect(result).toContain("<a");
    expect(result).toContain('href="#"');
    expect(result).toContain("Go somewhere");
    expect(result).not.toContain('role="link"');
    expect(result).not.toContain("<div");
  });

  it("converts <span role=link> to <a>", () => {
    const html = `<span role="link">Click me</span>`;
    const result = applyAriaLinkRoleFix(html);
    expect(result).toContain("<a");
    expect(result).toContain("Click me");
    expect(result).not.toContain('role="link"');
    expect(result).not.toContain("<span");
  });

  it("preserves an existing href attribute instead of adding href=#", () => {
    const html = `<div role="link" href="https://example.com">Visit</div>`;
    const result = applyAriaLinkRoleFix(html);
    expect(result).toContain('href="https://example.com"');
    expect(result).not.toContain('href="#"');
  });

  it("preserves other attributes (except role) on the replaced element", () => {
    const html = `<div role="link" class="nav-link" tabindex="0">Home</div>`;
    const result = applyAriaLinkRoleFix(html);
    expect(result).toContain('class="nav-link"');
    expect(result).toContain('tabindex="0"');
    expect(result).not.toContain('role="link"');
  });

  it("leaves native <a> elements unchanged", () => {
    const html = `<a href="#" role="link">Native link</a>`;
    const result = applyAriaLinkRoleFix(html);
    expect(result).toBe(html);
  });

  it("returns HTML unchanged when no role=link elements are present", () => {
    const html = `<div>No links here</div>`;
    expect(applyAriaLinkRoleFix(html)).toBe(html);
  });

  it("fixed HTML no longer triggers the ARIA Link Role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="link" tabindex="0">Go</div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Link Role on Non-Anchor Element")).toBeDefined();

    const fixed = applyAriaLinkRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Link Role on Non-Anchor Element")).toBeUndefined();
  });

  it("handles multiple non-anchor elements with role=link", () => {
    const html = `<div role="link">First</div><span role="link">Second</span>`;
    const result = applyAriaLinkRoleFix(html);
    expect((result.match(/<a /g) ?? []).length).toBe(2);
    expect(result).not.toContain('role="link"');
  });

  it("preserves rich inner HTML when replacing with <a>", () => {
    const html = `<div role="link" href="https://example.com"><strong>Visit</strong> <em>our site</em></div>`;
    const result = applyAriaLinkRoleFix(html);
    expect(result).toContain("<strong>Visit</strong>");
    expect(result).toContain("<em>our site</em>");
    expect(result).toContain("<a");
    expect(result).not.toContain('role="link"');
    expect(result).not.toContain("<div");
  });
});

// ---------------------------------------------------------------------------
// applyAriaCheckboxRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaCheckboxRoleFix", () => {
  it("converts <div role=checkbox> to <input type=checkbox> with aria-label", () => {
    const html = `<div role="checkbox" aria-checked="false">Option A</div>`;
    const result = applyAriaCheckboxRoleFix(html);
    expect(result).toContain('<input type="checkbox"');
    expect(result).toContain('aria-label="Option A"');
    expect(result).not.toContain('role="checkbox"');
    expect(result).not.toContain("<div");
  });

  it("converts <span role=checkbox> to <input type=checkbox>", () => {
    const html = `<span role="checkbox">Subscribe</span>`;
    const result = applyAriaCheckboxRoleFix(html);
    expect(result).toContain('<input type="checkbox"');
    expect(result).not.toContain("<span");
    expect(result).not.toContain('role="checkbox"');
  });

  it("changes type on <input type=radio role=checkbox> without removing other attrs", () => {
    const html = `<input type="radio" role="checkbox" name="opts">`;
    const result = applyAriaCheckboxRoleFix(html);
    expect(result).toContain('<input type="checkbox"');
    expect(result).not.toContain('role="checkbox"');
    expect(result).not.toContain('type="radio"');
    expect(result).toContain('name="opts"');
  });

  it("leaves <input type=checkbox> unchanged (correct native element)", () => {
    const html = `<input type="checkbox" name="agree">`;
    expect(applyAriaCheckboxRoleFix(html)).toBe(html);
  });

  it("returns HTML unchanged when no role=checkbox elements are present", () => {
    const html = `<div>No checkboxes</div>`;
    expect(applyAriaCheckboxRoleFix(html)).toBe(html);
  });

  it("fixed HTML no longer triggers the ARIA Checkbox Role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="checkbox" aria-checked="false">Accept</div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element")).toBeDefined();

    const fixed = applyAriaCheckboxRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element")).toBeUndefined();
  });

  it("wraps input and rich inner HTML in a <label> when content contains HTML tags", () => {
    const html = `<div role="checkbox"><strong>Important</strong> option</div>`;
    const result = applyAriaCheckboxRoleFix(html);
    expect(result).toBe(`<label><input type="checkbox"> <strong>Important</strong> option</label>`);
    expect(result).not.toContain('aria-label');
    expect(result).not.toContain("<div");
    expect(result).not.toContain('role="checkbox"');
  });

  it("preserves plain-text-only elements with aria-label (no unnecessary label wrapper)", () => {
    const html = `<div role="checkbox">Plain text only</div>`;
    const result = applyAriaCheckboxRoleFix(html);
    expect(result).toBe(`<input type="checkbox" aria-label="Plain text only">`);
    expect(result).not.toContain("<label");
  });

  it("label-wrap output produces zero new accessibility warnings on rich content", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="checkbox"><strong>Important</strong> option</div></main></body></html>`;
    const fixed = applyAriaCheckboxRoleFix(html);
    expect(fixed).toContain("<label><input");
    const issues = runDeterministicChecks(fixed);
    const newIssues = issues.filter(
      (i) =>
        (i.status === "fail" || i.status === "warning") &&
        i.title !== "ARIA Checkbox Role on Non-Input Element",
    );
    expect(newIssues).toHaveLength(0);
  });

  it("label-wrap output produces zero new accessibility warnings with multiple rich-content checkboxes", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="checkbox"><em>Choice</em> A</div><div role="checkbox"><strong>Choice</strong> B</div></main></body></html>`;
    const fixed = applyAriaCheckboxRoleFix(html);
    expect(fixed).toContain("<label><input");
    const issues = runDeterministicChecks(fixed);
    const newIssues = issues.filter(
      (i) =>
        (i.status === "fail" || i.status === "warning") &&
        i.title !== "ARIA Checkbox Role on Non-Input Element",
    );
    expect(newIssues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyAriaRadioRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaRadioRoleFix", () => {
  it("converts <span role=radio> to <input type=radio> with aria-label", () => {
    const html = `<span role="radio" aria-checked="false">Choice A</span>`;
    const result = applyAriaRadioRoleFix(html);
    expect(result).toContain('<input type="radio"');
    expect(result).toContain('aria-label="Choice A"');
    expect(result).not.toContain('role="radio"');
    expect(result).not.toContain("<span");
  });

  it("converts <div role=radio> to <input type=radio>", () => {
    const html = `<div role="radio">Option B</div>`;
    const result = applyAriaRadioRoleFix(html);
    expect(result).toContain('<input type="radio"');
    expect(result).not.toContain("<div");
    expect(result).not.toContain('role="radio"');
  });

  it("changes type on <input type=checkbox role=radio> without removing other attrs", () => {
    const html = `<input type="checkbox" role="radio" name="group">`;
    const result = applyAriaRadioRoleFix(html);
    expect(result).toContain('<input type="radio"');
    expect(result).not.toContain('role="radio"');
    expect(result).not.toContain('type="checkbox"');
    expect(result).toContain('name="group"');
  });

  it("leaves <input type=radio> unchanged (correct native element)", () => {
    const html = `<input type="radio" name="group">`;
    expect(applyAriaRadioRoleFix(html)).toBe(html);
  });

  it("returns HTML unchanged when no role=radio elements are present", () => {
    const html = `<div>No radios</div>`;
    expect(applyAriaRadioRoleFix(html)).toBe(html);
  });

  it("fixed HTML no longer triggers the ARIA Radio Role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><span role="radio" aria-checked="false">Yes</span></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Radio Role on Non-Input Element")).toBeDefined();

    const fixed = applyAriaRadioRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Radio Role on Non-Input Element")).toBeUndefined();
  });

  it("wraps input and rich inner HTML in a <label> when content contains HTML tags", () => {
    const html = `<div role="radio"><em>Option</em> A</div>`;
    const result = applyAriaRadioRoleFix(html);
    expect(result).toBe(`<label><input type="radio"> <em>Option</em> A</label>`);
    expect(result).not.toContain('aria-label');
    expect(result).not.toContain("<div");
    expect(result).not.toContain('role="radio"');
  });

  it("preserves plain-text-only elements with aria-label (no unnecessary label wrapper)", () => {
    const html = `<div role="radio">Plain text only</div>`;
    const result = applyAriaRadioRoleFix(html);
    expect(result).toBe(`<input type="radio" aria-label="Plain text only">`);
    expect(result).not.toContain("<label");
  });

  it("label-wrap output produces zero new accessibility warnings on rich content", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="radio"><em>Option</em> A</div></main></body></html>`;
    const fixed = applyAriaRadioRoleFix(html);
    expect(fixed).toContain("<label><input");
    const issues = runDeterministicChecks(fixed);
    const newIssues = issues.filter(
      (i) =>
        (i.status === "fail" || i.status === "warning") &&
        i.title !== "ARIA Radio Role on Non-Input Element",
    );
    expect(newIssues).toHaveLength(0);
  });

  it("label-wrap output produces zero new accessibility warnings with multiple rich-content radios", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="radio"><strong>Yes</strong> please</div><div role="radio"><strong>No</strong> thanks</div></main></body></html>`;
    const fixed = applyAriaRadioRoleFix(html);
    expect(fixed).toContain("<label><input");
    const issues = runDeterministicChecks(fixed);
    const newIssues = issues.filter(
      (i) =>
        (i.status === "fail" || i.status === "warning") &&
        i.title !== "ARIA Radio Role on Non-Input Element",
    );
    expect(newIssues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyAriaListRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaListRoleFix", () => {
  it("converts <div role=list> to <ul> preserving inner HTML", () => {
    const html = `<div role="list"><div role="listitem">Item</div></div>`;
    const result = applyAriaListRoleFix(html);
    expect(result).toContain("<ul>");
    expect(result).toContain("</ul>");
    expect(result).not.toContain('role="list"');
    expect(result).not.toContain("<div role=\"list\"");
    expect(result).toContain("Item");
  });

  it("preserves other attributes on the list element (excluding role)", () => {
    const html = `<div role="list" class="menu" id="nav-list"><div>Item</div></div>`;
    const result = applyAriaListRoleFix(html);
    expect(result).toContain('class="menu"');
    expect(result).toContain('id="nav-list"');
    expect(result).not.toContain('role="list"');
  });

  it("leaves native <ul> unchanged (even with redundant role=list)", () => {
    const html = `<ul role="list"><li>Item</li></ul>`;
    expect(applyAriaListRoleFix(html)).toBe(html);
  });

  it("leaves native <ol> unchanged", () => {
    const html = `<ol><li>Item</li></ol>`;
    expect(applyAriaListRoleFix(html)).toBe(html);
  });

  it("returns HTML unchanged when no role=list elements are present", () => {
    const html = `<ul><li>Item</li></ul>`;
    expect(applyAriaListRoleFix(html)).toBe(html);
  });

  it("fixed HTML no longer triggers the ARIA List Role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="list"><div role="listitem">Item</div></div></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA List Role on Non-List Element")).toBeDefined();

    const fixed = applyAriaListRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA List Role on Non-List Element")).toBeUndefined();
  });

  it("preserves rich inner HTML (inline formatting inside items) when replacing with <ul>", () => {
    const html = `<div role="list"><div role="listitem"><strong>Bold</strong> item</div><div role="listitem"><em>Italic</em> item</div></div>`;
    const result = applyAriaListRoleFix(html);
    expect(result).toContain("<strong>Bold</strong>");
    expect(result).toContain("<em>Italic</em>");
    expect(result).toContain("<ul");
    expect(result).not.toContain('role="list"');
    expect(result).not.toContain("<div role=\"list\"");
  });
});

// ---------------------------------------------------------------------------
// applyAriaListitemRoleFix
// ---------------------------------------------------------------------------

describe("applyAriaListitemRoleFix", () => {
  it("converts <div role=listitem> to <li> preserving inner HTML", () => {
    const html = `<ul><div role="listitem">Item A</div></ul>`;
    const result = applyAriaListitemRoleFix(html);
    expect(result).toContain("<li>Item A</li>");
    expect(result).not.toContain('role="listitem"');
    expect(result).not.toContain("<div");
  });

  it("converts <span role=listitem> to <li>", () => {
    const html = `<ul><span role="listitem">Item B</span></ul>`;
    const result = applyAriaListitemRoleFix(html);
    expect(result).toContain("<li>Item B</li>");
    expect(result).not.toContain("<span");
    expect(result).not.toContain('role="listitem"');
  });

  it("preserves other attributes on the listitem element (excluding role)", () => {
    const html = `<ul><div role="listitem" class="item" data-id="1">Entry</div></ul>`;
    const result = applyAriaListitemRoleFix(html);
    expect(result).toContain('class="item"');
    expect(result).toContain('data-id="1"');
    expect(result).not.toContain('role="listitem"');
  });

  it("leaves native <li> unchanged (even with redundant role=listitem)", () => {
    const html = `<ul><li role="listitem">Item</li></ul>`;
    expect(applyAriaListitemRoleFix(html)).toBe(html);
  });

  it("returns HTML unchanged when no role=listitem elements are present", () => {
    const html = `<ul><li>Item</li></ul>`;
    expect(applyAriaListitemRoleFix(html)).toBe(html);
  });

  it("fixed HTML no longer triggers the ARIA Listitem Role warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><ul><div role="listitem">Item</div></ul></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element")).toBeDefined();

    const fixed = applyAriaListitemRoleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element")).toBeUndefined();
  });

  it("handles multiple non-listitem elements with role=listitem", () => {
    const html = `<ul><div role="listitem">A</div><span role="listitem">B</span></ul>`;
    const result = applyAriaListitemRoleFix(html);
    expect(result).toContain("<li>A</li>");
    expect(result).toContain("<li>B</li>");
    expect(result).not.toContain('role="listitem"');
  });

  it("preserves rich inner HTML when replacing with <li>", () => {
    const html = `<ul><div role="listitem"><em>Italicized</em> text and <strong>bold</strong></div></ul>`;
    const result = applyAriaListitemRoleFix(html);
    expect(result).toContain("<em>Italicized</em>");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<li");
    expect(result).not.toContain('role="listitem"');
    expect(result).not.toContain("<div");
  });
});

// ---------------------------------------------------------------------------
// fixComplianceIssue — deterministic fix dispatch for new ARIA roles
// ---------------------------------------------------------------------------

describe("fixComplianceIssue – deterministic ARIA role fix dispatch", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("applies deterministic link fix without calling AI for ARIA Link Role on Non-Anchor Element", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="link" tabindex="0">Go</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    expect(afterIssues.find((i) => i.title === "ARIA Link Role on Non-Anchor Element")).toBeUndefined();
  });

  it("applies deterministic checkbox fix without calling AI for ARIA Checkbox Role on Non-Input Element", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="checkbox" aria-checked="false">Accept</div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    expect(afterIssues.find((i) => i.title === "ARIA Checkbox Role on Non-Input Element")).toBeUndefined();
  });

  it("applies deterministic radio fix without calling AI for ARIA Radio Role on Non-Input Element", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><span role="radio" aria-checked="false">Yes</span></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.title === "ARIA Radio Role on Non-Input Element")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    expect(afterIssues.find((i) => i.title === "ARIA Radio Role on Non-Input Element")).toBeUndefined();
  });

  it("applies deterministic list fix without calling AI for ARIA List Role on Non-List Element", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><div role="list"><div role="listitem">Item</div></div></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.title === "ARIA List Role on Non-List Element")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    expect(afterIssues.find((i) => i.title === "ARIA List Role on Non-List Element")).toBeUndefined();
  });

  it("applies deterministic listitem fix without calling AI for ARIA Listitem Role on Non-Listitem Element", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>T</h1><ul><div role="listitem">Item</div></ul></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    expect(afterIssues.find((i) => i.title === "ARIA Listitem Role on Non-Listitem Element")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ARIA misuse warning card UI contract
// These tests guard the exact title strings and issue shape that the results
// panel uses to decide whether to show the "ARIA Role Misuse" callout.
// Changing a title or status here would silently break the frontend callout.
// ---------------------------------------------------------------------------

describe("ARIA misuse warning card UI contract", () => {
  describe("ARIA Button Role warning (criterion 4.1.2)", () => {
    const html = `<html lang="en"><body><main><h1>Page</h1><div role="button">Click me</div></main></body></html>`;

    it("emits a warning with the exact title the UI callout checks", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.criterion === "4.1.2" && i.status === "warning");
      expect(issue).toBeDefined();
      expect(issue!.title).toBe("ARIA Button Role on Non-Button Element");
    });

    it("has status 'warning' so the callout block is rendered (not 'fail' or 'pass')", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue!.status).toBe("warning");
    });

    it("includes the offending element tag in details so the callout has actionable context", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue!.details).toContain("<div>");
      expect(issue!.details).toContain("<button>");
    });

    it("description mentions the native <button> element as the fix", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Button Role on Non-Button Element");
      expect(issue!.description).toContain("<button>");
    });
  });

  describe("ARIA Heading Role warning (criterion 1.3.1)", () => {
    const html = `<html lang="en"><body><main><h1>Page</h1><div role="heading" aria-level="2">Section</div></main></body></html>`;

    it("emits a warning with the exact title the UI callout checks", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue).toBeDefined();
      expect(issue!.title).toBe("ARIA Heading Role on Non-Heading Element");
    });

    it("has status 'warning' so the callout block is rendered", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue!.status).toBe("warning");
    });

    it("includes the offending element tag in details so the callout has actionable context", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue!.details).toContain("<div>");
      expect(issue!.details).toContain("<h1>");
    });

    it("description mentions native h1-h6 elements as the fix", () => {
      const issues = runDeterministicChecks(html);
      const issue = issues.find((i) => i.title === "ARIA Heading Role on Non-Heading Element");
      expect(issue!.description).toMatch(/h1.*h6|h1>.*<h6/i);
    });
  });
});

// ---------------------------------------------------------------------------
// applyLangAttributeFix
// ---------------------------------------------------------------------------

describe("applyLangAttributeFix", () => {
  it("adds lang=\"en\" to <html> when no lang attribute is present", () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><body></body></html>`;
    const result = applyLangAttributeFix(html);
    expect(result).toContain('<html lang="en">');
    expect(result).not.toContain("<html>");
  });

  it("preserves existing attributes on <html> when adding lang", () => {
    const html = `<!DOCTYPE html><html class="no-js"><head></head><body></body></html>`;
    const result = applyLangAttributeFix(html);
    expect(result).toContain('class="no-js"');
    expect(result).toContain('lang="en"');
  });

  it("does not modify the HTML when lang attribute is already present", () => {
    const html = `<!DOCTYPE html><html lang="fr"><head><title>T</title></head><body></body></html>`;
    const result = applyLangAttributeFix(html);
    expect(result).toBe(html);
    expect(result).toContain('lang="fr"');
  });

  it("does not duplicate lang when lang attribute already exists with a value", () => {
    const html = `<!DOCTYPE html><html lang="en-GB"><head></head><body></body></html>`;
    const result = applyLangAttributeFix(html);
    const langCount = (result.match(/\slang=/g) ?? []).length;
    expect(langCount).toBe(1);
  });

  it("fixed HTML no longer triggers the 3.1.1 Language of Page failure", () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><body><main><h1>T</h1></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.criterion === "3.1.1")!.status).toBe("fail");

    const fixed = applyLangAttributeFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.criterion === "3.1.1")!.status).toBe("pass");
  });

  it("fixComplianceIssue returns elementsFixed as undefined for the lang attribute fixer", async () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><body><main><h1>T</h1></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const langIssue = issues.find((i) => i.criterion === "3.1.1" && i.title === "Language of Page")!;
    expect(langIssue).toBeDefined();
    const report = buildComplianceReport(issues);

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, langIssue, issues.indexOf(langIssue), report);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.elementsFixed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyPageTitleFix
// ---------------------------------------------------------------------------

describe("applyPageTitleFix", () => {
  it("fills an empty <title> with 'Document'", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Document</title>");
    expect(result).not.toMatch(/<title>\s*<\/title>/);
  });

  it("fills a whitespace-only <title> with 'Document'", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>   </title></head><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Document</title>");
  });

  it("inserts a <title> into <head> when the title element is missing", () => {
    const html = `<!DOCTYPE html><html lang="en"><head></head><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Document</title>");
    expect(/<title>[^<]+<\/title>/i.test(result)).toBe(true);
  });

  it("inserts <head> and <title> when neither is present", () => {
    const html = `<!DOCTYPE html><html lang="en"><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Document</title>");
  });

  it("does not modify HTML when a non-empty title already exists", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>My Document</title></head><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toBe(html);
  });

  it("fixed HTML no longer triggers the 2.4.2 Page Titled failure (empty title)", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body><main><h1>T</h1></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.criterion === "2.4.2")!.status).toBe("fail");

    const fixed = applyPageTitleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.criterion === "2.4.2")!.status).toBe("pass");
  });

  it("fixed HTML no longer triggers the 2.4.2 Page Titled failure (missing title)", () => {
    const html = `<!DOCTYPE html><html lang="en"><head></head><body><main><h1>T</h1></main></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.criterion === "2.4.2")!.status).toBe("fail");

    const fixed = applyPageTitleFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.criterion === "2.4.2")!.status).toBe("pass");
  });

  it("uses the h1 text when the title is empty", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body><h1>About Us</h1></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>About Us</title>");
    expect(result).not.toContain("<title>Document</title>");
  });

  it("uses the h1 text when the title element is missing", () => {
    const html = `<!DOCTYPE html><html lang="en"><head></head><body><h1>Welcome Home</h1></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Welcome Home</title>");
    expect(result).not.toContain("<title>Document</title>");
  });

  it("falls back to h2 when h1 is absent", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body><h2>Contact</h2></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Contact</title>");
    expect(result).not.toContain("<title>Document</title>");
  });

  it("falls back to h2 when h1 is present but empty", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body><h1>  </h1><h2>Services</h2></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Services</title>");
  });

  it("falls back to 'Document' when no h1 or h2 is found", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body><p>No headings here</p></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Document</title>");
  });

  it("strips inner HTML tags from h1 when building the title", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body><h1><span>Products</span></h1></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Products</title>");
  });

  it("extracts h1 text correctly when the h1 tag has an attribute value containing '>'", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title></title></head><body><h1 data-label="x>y">Safe Heading</h1></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>Safe Heading</title>");
  });
});

// ---------------------------------------------------------------------------
// extractPageTitleInfo
// ---------------------------------------------------------------------------

describe("extractPageTitleInfo", () => {
  it("returns h1 text and headingLevel 'h1' when h1 is present", () => {
    const html = `<html><head><title></title></head><body><h1>About Us</h1></body></html>`;
    const result = extractPageTitleInfo(html);
    expect(result.title).toBe("About Us");
    expect(result.headingLevel).toBe("h1");
  });

  it("returns h2 text and headingLevel 'h2' when h1 is absent", () => {
    const html = `<html><head><title></title></head><body><h2>Contact</h2></body></html>`;
    const result = extractPageTitleInfo(html);
    expect(result.title).toBe("Contact");
    expect(result.headingLevel).toBe("h2");
  });

  it("falls back to h2 when h1 is present but empty", () => {
    const html = `<html><head><title></title></head><body><h1>  </h1><h2>Services</h2></body></html>`;
    const result = extractPageTitleInfo(html);
    expect(result.title).toBe("Services");
    expect(result.headingLevel).toBe("h2");
  });

  it("returns 'Document' and null headingLevel when no headings are found", () => {
    const html = `<html><head><title></title></head><body><p>No headings</p></body></html>`;
    const result = extractPageTitleInfo(html);
    expect(result.title).toBe("Document");
    expect(result.headingLevel).toBeNull();
  });

  it("strips inner HTML tags from heading text", () => {
    const html = `<html><head><title></title></head><body><h1><span>Products</span></h1></body></html>`;
    const result = extractPageTitleInfo(html);
    expect(result.title).toBe("Products");
    expect(result.headingLevel).toBe("h1");
  });
});

// ---------------------------------------------------------------------------
// applyBypassBlocksFix
// ---------------------------------------------------------------------------

describe("applyBypassBlocksFix", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("wraps body content in <main> when no landmark exists", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1>Hello</h1><p>World</p></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain("<main>");
    expect(result).toContain("</main>");
    expect(result).toMatch(/<body[^>]*><main>/i);
  });

  it("does not modify HTML when a <main> element already exists", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>Hello</h1></main></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toBe(html);
  });

  it("does not modify HTML when role=\"main\" already exists", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><div role="main"><h1>Hello</h1></div></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toBe(html);
  });

  it("does not modify HTML when role='main' is single-quoted", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><div role='main'><h1>Hello</h1></div></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toBe(html);
  });

  it("does not duplicate <main> when already present", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><p>Content</p></main></body></html>`;
    const result = applyBypassBlocksFix(html);
    const mainCount = (result.match(/<main/gi) ?? []).length;
    expect(mainCount).toBe(1);
  });

  it("wraps body content even when the <body> tag has an attribute value containing '>'", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body data-x="a>b"><h1>Hello</h1></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain("<main>");
    expect(result).toContain("</main>");
  });

  it("fixed HTML no longer triggers the 2.4.1 Bypass Blocks warning", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1>Hello</h1></body></html>`;
    const before = runDeterministicChecks(html);
    expect(before.find((i) => i.criterion === "2.4.1")!.status).toBe("warning");

    const fixed = applyBypassBlocksFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.criterion === "2.4.1")!.status).toBe("pass");
  });

  it("routes 2.4.1 Bypass Blocks through the deterministic fixer and does not call AI", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1>Hello</h1></body></html>`;
    const issues = runDeterministicChecks(html);
    const bypassIssue = issues.find((i) => i.criterion === "2.4.1" && i.title === "Bypass Blocks")!;
    expect(bypassIssue).toBeDefined();

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, bypassIssue, issues.indexOf(bypassIssue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).toContain("<main>");
  });

  /** Extract the inner HTML of the first <main>…</main> span from a string. */
  function extractMainContent(s: string): string {
    const m = s.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    return m ? m[1] : "";
  }

  it("leaves a top-level <header> outside <main> as a sibling", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><header><p>Site header</p></header><h1>Content</h1><p>Body</p></body></html>`;
    const result = applyBypassBlocksFix(html);
    // header must remain in the output
    expect(result).toContain("<header>");
    // primary content must be inside <main>
    expect(result).toContain("<main>");
    // the content inside <main> must not contain <header>
    expect(extractMainContent(result)).not.toContain("<header>");
  });

  it("leaves a top-level <nav> outside <main> as a sibling", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><nav><a href="#skip">Skip</a></nav><h1>Content</h1></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain("<nav>");
    expect(result).toContain("<main>");
    expect(extractMainContent(result)).not.toContain("<nav>");
  });

  it("leaves a top-level <footer> outside <main> as a sibling", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1>Content</h1><footer><p>Site footer</p></footer></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain("<footer>");
    expect(result).toContain("<main>");
    expect(extractMainContent(result)).not.toContain("<footer>");
  });

  it("keeps header, nav, and footer as siblings when all three are present", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><header><p>Header</p></header><nav><a href="#">Nav</a></nav><h1>Main content</h1><p>Paragraph</p><footer><p>Footer</p></footer></body></html>`;
    const result = applyBypassBlocksFix(html);
    // landmarks must still appear in the output
    expect(result).toContain("<header>");
    expect(result).toContain("<nav>");
    expect(result).toContain("<footer>");
    // exactly one <main> wrapping the non-landmark content
    const mainCount = (result.match(/<main/gi) ?? []).length;
    expect(mainCount).toBe(1);
    // the content inside <main> must not contain any landmark elements
    const mainInner = extractMainContent(result);
    expect(mainInner).not.toContain("<header>");
    expect(mainInner).not.toContain("<nav>");
    expect(mainInner).not.toContain("<footer>");
    // non-landmark content is inside <main>
    expect(mainInner).toContain("<h1>");
  });

  it("all non-landmark content is grouped into a single <main> (no double <main>)", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><p>Before nav</p><nav><a href="#">Nav</a></nav><p>After nav</p></body></html>`;
    const result = applyBypassBlocksFix(html);
    const mainCount = (result.match(/<main/gi) ?? []).length;
    expect(mainCount).toBe(1);
  });

  it("fixed HTML with landmarks still passes the 2.4.1 check", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><header><p>Header</p></header><nav><a href="#">Nav</a></nav><h1>Main</h1><footer><p>Footer</p></footer></body></html>`;
    const fixed = applyBypassBlocksFix(html);
    const after = runDeterministicChecks(fixed);
    expect(after.find((i) => i.criterion === "2.4.1")!.status).toBe("pass");
  });

  it('leaves a top-level <div role="banner"> outside <main> as a sibling', () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><div role="banner"><p>Site header</p></div><h1>Content</h1><p>Body</p></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain('role="banner"');
    expect(result).toContain("<main>");
    expect(extractMainContent(result)).not.toContain('role="banner"');
  });

  it("leaves a top-level <div role='banner'> (single-quoted) outside <main> as a sibling", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><div role='banner'><p>Site header</p></div><h1>Content</h1><p>Body</p></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain("role='banner'");
    expect(result).toContain("<main>");
    expect(extractMainContent(result)).not.toContain("role='banner'");
  });

  it('leaves a top-level <div role="navigation"> outside <main> as a sibling', () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><div role="navigation"><a href="#skip">Skip</a></div><h1>Content</h1></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain('role="navigation"');
    expect(result).toContain("<main>");
    expect(extractMainContent(result)).not.toContain('role="navigation"');
  });

  it('leaves a top-level <div role="contentinfo"> outside <main> as a sibling', () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1>Content</h1><div role="contentinfo"><p>Site footer</p></div></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain('role="contentinfo"');
    expect(result).toContain("<main>");
    expect(extractMainContent(result)).not.toContain('role="contentinfo"');
  });

  it("keeps all three ARIA role landmarks as siblings when mixed with native landmark tags", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><div role="banner"><p>Banner</p></div><div role="navigation"><a href="#">Nav</a></div><h1>Main content</h1><p>Paragraph</p><div role="contentinfo"><p>Footer</p></div></body></html>`;
    const result = applyBypassBlocksFix(html);
    expect(result).toContain('role="banner"');
    expect(result).toContain('role="navigation"');
    expect(result).toContain('role="contentinfo"');
    const mainCount = (result.match(/<main/gi) ?? []).length;
    expect(mainCount).toBe(1);
    const mainInner = extractMainContent(result);
    expect(mainInner).not.toContain('role="banner"');
    expect(mainInner).not.toContain('role="navigation"');
    expect(mainInner).not.toContain('role="contentinfo"');
    expect(mainInner).toContain("<h1>");
  });

  it("all-landmarks-no-content: applyBypassBlocksFix does not insert <main> and 2.4.1 check surfaces a distinct warning", () => {
    // Document body contains only landmark elements — no non-landmark content at all.
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><header><p>Site header</p></header><nav><a href="#">Home</a></nav><footer><p>Footer</p></footer></body></html>`;

    // The fixer should leave the document unchanged since there is nothing to wrap.
    const fixed = applyBypassBlocksFix(html);
    expect(fixed).not.toContain("<main>");

    // The deterministic check should still warn (status: "warning").
    const issues = runDeterministicChecks(fixed);
    const bypass = issues.find((i) => i.criterion === "2.4.1")!;
    expect(bypass.status).toBe("warning");

    // The details message must be the distinct "only-landmarks" explanation, not the generic one.
    expect(bypass.details).toBe(
      "This document contains header, navigation, or footer sections but has no main content area. " +
        "All body content appears to be inside landmark elements, so no <main> region could be identified. " +
        "Add a <main> element (or role=\"main\" on a wrapper) to clearly mark where the primary content begins, " +
        "so screen reader users can skip directly to it."
    );
  });

  it("all-landmarks-no-content: fixComplianceIssue returns noFixReason and leaves HTML unchanged", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><header><p>Site header</p></header><nav><a href="#">Home</a></nav><footer><p>Footer</p></footer></body></html>`;

    const issues = runDeterministicChecks(html);
    const report = buildComplianceReport(issues);
    const bypassIssue = issues.find((i) => i.criterion === "2.4.1")!;
    const bypassIndex = issues.indexOf(bypassIssue);

    const result = await fixComplianceIssue(html, bypassIssue, bypassIndex, report);

    expect(result.noFixReason).toBe(
      "This document contains only landmark elements (header, nav, footer) with no primary content outside them, so there is nothing to automatically wrap in a <main> region. " +
        "To fix this manually: add a <main> element around your primary page content, or add role=\"main\" to the landmark that holds the main information."
    );
    expect(result.accessibleHtml).not.toContain("<main>");
    expect(result.accessibleHtml).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// fixComplianceIssue — multi-fix sequence and report accumulation tests
// ---------------------------------------------------------------------------

describe("fixComplianceIssue – multi-fix sequences and report accumulation", () => {
  const fixtureHtml = loadFixture("government-form.html");

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("score strictly increases after each fix in a two-fix chain (3.1.1 then 2.4.2)", async () => {
    const initialIssues = runDeterministicChecks(fixtureHtml);
    const initialReport = makeReport(initialIssues);
    const initialScore = initialReport.overallScore;

    // Fix 1: add lang="en" to resolve criterion 3.1.1
    const html1 = fixtureHtml.replace("<html>", '<html lang="en">');
    mockAiResponse(`<!DOCTYPE html>\n${html1}`);

    const langIssue = initialIssues.find((i) => i.criterion === "3.1.1")!;
    const langIndex = initialIssues.indexOf(langIssue);

    const result1 = await fixComplianceIssue(fixtureHtml, langIssue, langIndex, initialReport);
    const scoreAfterFix1 = result1.complianceReport.overallScore;
    expect(scoreAfterFix1).toBeGreaterThan(initialScore);

    // Fix 2: add a proper title to resolve criterion 2.4.2, chained from fix 1 output
    const html2 = html1.replace("<title></title>", "<title>Form W-99: Household Income Verification</title>");
    mockAiResponse(`<!DOCTYPE html>\n${html2}`);

    const titleIssue = result1.complianceReport.issues.find((i) => i.criterion === "2.4.2")!;
    const titleIndex = result1.complianceReport.issues.indexOf(titleIssue);

    const result2 = await fixComplianceIssue(result1.accessibleHtml, titleIssue, titleIndex, result1.complianceReport);
    const scoreAfterFix2 = result2.complianceReport.overallScore;
    expect(scoreAfterFix2).toBeGreaterThan(scoreAfterFix1);
  });

  it("previously-fixed issue stays 'fixed' after a second fix targets a different issue", async () => {
    const initialIssues = runDeterministicChecks(fixtureHtml);
    const initialReport = makeReport(initialIssues);

    // Fix 1: resolve 3.1.1 (lang)
    const html1 = fixtureHtml.replace("<html>", '<html lang="en">');
    mockAiResponse(`<!DOCTYPE html>\n${html1}`);

    const langIssue = initialIssues.find((i) => i.criterion === "3.1.1")!;
    const langIndex = initialIssues.indexOf(langIssue);

    const result1 = await fixComplianceIssue(fixtureHtml, langIssue, langIndex, initialReport);
    expect(result1.complianceReport.issues[langIndex].status).toBe("fixed");

    // Fix 2: resolve 2.4.2 (page title) using the report and HTML from fix 1
    const html2 = html1.replace("<title></title>", "<title>W-99 Form</title>");
    mockAiResponse(`<!DOCTYPE html>\n${html2}`);

    const titleIssue = result1.complianceReport.issues.find((i) => i.criterion === "2.4.2")!;
    const titleIndex = result1.complianceReport.issues.indexOf(titleIssue);

    const result2 = await fixComplianceIssue(result1.accessibleHtml, titleIssue, titleIndex, result1.complianceReport);

    // The issue fixed in round 1 must still be "fixed" in the round 2 report
    expect(result2.complianceReport.issues[langIndex].status).toBe("fixed");
    // The issue fixed in round 2 must now also be "fixed"
    expect(result2.complianceReport.issues[titleIndex].status).toBe("fixed");
  });

  it("both targeted issues are reported as 'fixed' and overall score only increases across a three-fix chain", async () => {
    const initialIssues = runDeterministicChecks(fixtureHtml);
    const initialReport = makeReport(initialIssues);
    const initialScore = initialReport.overallScore;

    // Fix 1: lang attribute — deterministic fixer, does NOT call the AI
    const langIssue = initialIssues.find((i) => i.criterion === "3.1.1")!;
    const result1 = await fixComplianceIssue(fixtureHtml, langIssue, initialIssues.indexOf(langIssue), initialReport);
    expect(result1.complianceReport.overallScore).toBeGreaterThanOrEqual(initialScore);

    // Fix 2: page title — deterministic fixer, does NOT call the AI
    const titleIssue2 = result1.complianceReport.issues.find((i) => i.criterion === "2.4.2")!;
    const result2 = await fixComplianceIssue(result1.accessibleHtml, titleIssue2, result1.complianceReport.issues.indexOf(titleIssue2), result1.complianceReport);
    expect(result2.complianceReport.overallScore).toBeGreaterThanOrEqual(result1.complianceReport.overallScore);

    // Fix 3: h1 heading — uses AI; mock only this response
    const html3 = result2.accessibleHtml.replace(
      /<h2>Form W-99: Household Income Verification Request<\/h2>/i,
      "<h1>Form W-99: Household Income Verification Request</h1>"
    );
    mockAiResponse(`<!DOCTYPE html>\n${html3}`);
    const headingIssue3 = result2.complianceReport.issues.find((i) => i.criterion === "2.4.6")!;
    const result3 = await fixComplianceIssue(result2.accessibleHtml, headingIssue3, result2.complianceReport.issues.indexOf(headingIssue3), result2.complianceReport);
    expect(result3.complianceReport.overallScore).toBeGreaterThanOrEqual(result2.complianceReport.overallScore);

    // All three fixed issues must carry status "fixed" in the final report
    const finalIssues = result3.complianceReport.issues;
    expect(finalIssues.find((i) => i.criterion === "3.1.1")!.status).toBe("fixed");
    expect(finalIssues.find((i) => i.criterion === "2.4.2")!.status).toBe("fixed");
    expect(finalIssues.find((i) => i.criterion === "2.4.6")!.status).toBe("fixed");

    // Overall score must be higher than the initial score
    expect(result3.complianceReport.overallScore).toBeGreaterThan(initialScore);
  });

  it("fixCount in the report accumulates correctly across a fix chain", async () => {
    const initialIssues = runDeterministicChecks(fixtureHtml);
    const initialReport = makeReport(initialIssues);
    expect(initialReport.fixedCount).toBe(0);

    // Fix 1: lang
    const html1 = fixtureHtml.replace("<html>", '<html lang="en">');
    mockAiResponse(`<!DOCTYPE html>\n${html1}`);
    const langIssue = initialIssues.find((i) => i.criterion === "3.1.1")!;
    const result1 = await fixComplianceIssue(fixtureHtml, langIssue, initialIssues.indexOf(langIssue), initialReport);
    expect(result1.complianceReport.fixedCount).toBe(1);

    // Fix 2: title, chained from fix 1
    const html2 = html1.replace("<title></title>", "<title>W-99</title>");
    mockAiResponse(`<!DOCTYPE html>\n${html2}`);
    const titleIssue = result1.complianceReport.issues.find((i) => i.criterion === "2.4.2")!;
    const result2 = await fixComplianceIssue(result1.accessibleHtml, titleIssue, result1.complianceReport.issues.indexOf(titleIssue), result1.complianceReport);
    expect(result2.complianceReport.fixedCount).toBe(2);
  });

  it("issueIndex alignment stays correct when the targeted issue is not at index 0 and a prior fix changed other issue statuses", async () => {
    const initialIssues = runDeterministicChecks(fixtureHtml);
    const initialReport = makeReport(initialIssues);

    // Fix 1: resolve alt text (1.1.1) — not the first issue in the list
    const html1 = fixtureHtml
      .replace('<img src="agency-logo.png">', '<img src="agency-logo.png" alt="Agency logo">')
      .replace('<img src="seal.png">', '<img src="seal.png" alt="Official seal">');
    mockAiResponse(`<!DOCTYPE html>\n${html1}`);

    const altIssue = initialIssues.find((i) => i.criterion === "1.1.1")!;
    const altIndex = initialIssues.indexOf(altIssue);
    expect(altIndex).toBeGreaterThan(0); // confirm it's not at index 0

    const result1 = await fixComplianceIssue(fixtureHtml, altIssue, altIndex, initialReport);

    // After fix 1, the alt issue must be "fixed" at the same index
    expect(result1.complianceReport.issues[altIndex].status).toBe("fixed");
    expect(result1.complianceReport.issues[altIndex].criterion).toBe("1.1.1");

    // Fix 2: resolve lang (3.1.1) using the chained report — its index must still be correct
    const html2 = html1.replace("<html>", '<html lang="en">');
    mockAiResponse(`<!DOCTYPE html>\n${html2}`);

    const langIssueInChain = result1.complianceReport.issues.find((i) => i.criterion === "3.1.1")!;
    const langIndexInChain = result1.complianceReport.issues.indexOf(langIssueInChain);

    const result2 = await fixComplianceIssue(result1.accessibleHtml, langIssueInChain, langIndexInChain, result1.complianceReport);

    // Both issues must now be "fixed", at their respective original indices
    expect(result2.complianceReport.issues[altIndex].criterion).toBe("1.1.1");
    expect(result2.complianceReport.issues[altIndex].status).toBe("fixed");
    expect(result2.complianceReport.issues[langIndexInChain].criterion).toBe("3.1.1");
    expect(result2.complianceReport.issues[langIndexInChain].status).toBe("fixed");
  });

  it("issueIndex in the chain report diverges from a fresh runDeterministicChecks index after a conditional issue disappears — chained index correctly targets the right issue", async () => {
    // Build HTML that produces TWO conditional issues:
    //   (A) "ARIA Role on Table Data Cell" warning  (conditional — only when td[role] present)
    //   (B) "Heading Order" warning                 (conditional — only when headings are present)
    // Order produced by runDeterministicChecks:
    //   idx 0-6: seven unconditional checks
    //   idx 7  : Table Headers (fail — td role is not th)
    //   idx 8  : Table Header Markup (warning — td-only first row)
    //   idx 9  : ARIA Role on Table Data Cell (warning)   ← (A)
    //   idx 10 : Heading Order (warning — h1→h3 skips h2) ← (B)
    const customHtml = `<!DOCTYPE html>
<html>
<head><title>Multi-Fix Index Test</title></head>
<body>
<h1>Main Heading</h1>
<h3>Sub Section</h3>
<table>
  <tr>
    <td role="columnheader">Name</td>
    <td role="columnheader">Score</td>
  </tr>
  <tr><td>Alice</td><td>95</td></tr>
</table>
</body>
</html>`;

    const initialIssues = runDeterministicChecks(customHtml);
    const initialReport = makeReport(initialIssues);

    const ariaIssue = initialIssues.find(
      (i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell"
    )!;
    expect(ariaIssue).toBeDefined();
    const ariaIndex = initialIssues.indexOf(ariaIssue);

    const headingOrderIssue = initialIssues.find(
      (i) => i.criterion === "1.3.1" && i.title === "Heading Order"
    )!;
    expect(headingOrderIssue).toBeDefined();
    expect(headingOrderIssue.status).toBe("warning");
    const headingOrderIndexInitial = initialIssues.indexOf(headingOrderIssue);

    // The ARIA issue must appear BEFORE Heading Order so its removal will shift the heading order index
    expect(ariaIndex).toBeLessThan(headingOrderIndexInitial);

    // Fix 1: resolve ARIA Role issue — this fix is applied deterministically (no AI call needed)
    // so we do NOT queue a mock response here.
    const result1 = await fixComplianceIssue(customHtml, ariaIssue, ariaIndex, initialReport);
    expect(result1.complianceReport.issues[ariaIndex].status).toBe("fixed");

    // After fix 1, a fresh re-check no longer contains "ARIA Role on Table Data Cell"
    // or "Table Header Markup" (first row now has <th>).  The "Heading Order" issue
    // therefore shifts to a LOWER index in the fresh output.
    const freshAfterFix1 = runDeterministicChecks(result1.accessibleHtml);
    expect(
      freshAfterFix1.find((i) => i.criterion === "1.3.1" && i.title === "ARIA Role on Table Data Cell")
    ).toBeUndefined();

    const headingOrderIndexInFresh = freshAfterFix1.findIndex(
      (i) => i.criterion === "1.3.1" && i.title === "Heading Order"
    );
    const headingOrderIndexInChain = result1.complianceReport.issues.findIndex(
      (i) => i.criterion === "1.3.1" && i.title === "Heading Order"
    );

    // The indices must differ — this is the index shift the test is designed to expose
    expect(headingOrderIndexInFresh).toBeGreaterThanOrEqual(0);
    expect(headingOrderIndexInChain).toBeGreaterThanOrEqual(0);
    expect(headingOrderIndexInFresh).not.toBe(headingOrderIndexInChain);

    // Fix 2: target "Heading Order" using the CHAIN-derived index.
    // Simulate the AI fixing the heading skip: h1 → h3 becomes h1 → h2.
    // We derive html2 from result1.accessibleHtml (the actual post-fix-1 HTML).
    const html2 = result1.accessibleHtml.replace("<h3>Sub Section</h3>", "<h2>Sub Section</h2>");
    mockAiResponse(`<!DOCTYPE html>\n${html2}`);

    const result2 = await fixComplianceIssue(
      result1.accessibleHtml,
      result1.complianceReport.issues[headingOrderIndexInChain],
      headingOrderIndexInChain,
      result1.complianceReport
    );

    // The Heading Order issue at the chain-derived index is now fixed
    const finalIssueAtChainIdx = result2.complianceReport.issues[headingOrderIndexInChain];
    expect(finalIssueAtChainIdx.criterion).toBe("1.3.1");
    expect(finalIssueAtChainIdx.title).toBe("Heading Order");
    expect(finalIssueAtChainIdx.status).toBe("fixed");

    // The ARIA issue fixed in round 1 must still be "fixed"
    expect(result2.complianceReport.issues[ariaIndex].criterion).toBe("1.3.1");
    expect(result2.complianceReport.issues[ariaIndex].title).toBe("ARIA Role on Table Data Cell");
    expect(result2.complianceReport.issues[ariaIndex].status).toBe("fixed");

    // fixedCount accumulates: 2 total
    expect(result2.complianceReport.fixedCount).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // No-regression: originally-passing issues must not flip to fail/warning
  // ---------------------------------------------------------------------------

  it("no originally-passing issue regresses after applying an AI fix on the government-form fixture", async () => {
    const initialIssues = runDeterministicChecks(fixtureHtml);
    const initialReport = makeReport(initialIssues);

    // Record which issues were "pass" at baseline
    const originallyPassing = initialIssues
      .map((issue, idx) => ({ issue, idx }))
      .filter(({ issue }) => issue.status === "pass");

    // Sanity: there must be at least one passing issue to make this test meaningful
    expect(originallyPassing.length).toBeGreaterThan(0);

    // Fix lang (3.1.1) — mock AI returns valid HTML that only adds lang="en"
    const fixedHtml = fixtureHtml.replace("<html>", '<html lang="en">');
    mockAiResponse(`<!DOCTYPE html>\n${fixedHtml}`);

    const langIssue = initialIssues.find((i) => i.criterion === "3.1.1")!;
    const result = await fixComplianceIssue(
      fixtureHtml,
      langIssue,
      initialIssues.indexOf(langIssue),
      initialReport
    );

    // Every issue that was originally "pass" must still be "pass" or "fixed"
    for (const { issue, idx } of originallyPassing) {
      const afterIssue = result.complianceReport.issues[idx];
      expect(
        afterIssue.status === "pass" || afterIssue.status === "fixed",
        `Issue ${afterIssue.criterion} "${afterIssue.title}" (index ${idx}) was originally "pass" but became "${afterIssue.status}" after the fix`
      ).toBe(true);
    }
  });

  it("no originally-passing issue regresses after two sequential AI fixes on the government-form fixture", async () => {
    const initialIssues = runDeterministicChecks(fixtureHtml);
    const initialReport = makeReport(initialIssues);

    const originallyPassing = initialIssues
      .map((issue, idx) => ({ issue, idx }))
      .filter(({ issue }) => issue.status === "pass");

    expect(originallyPassing.length).toBeGreaterThan(0);

    // Fix 1: lang
    const html1 = fixtureHtml.replace("<html>", '<html lang="en">');
    mockAiResponse(`<!DOCTYPE html>\n${html1}`);
    const langIssue = initialIssues.find((i) => i.criterion === "3.1.1")!;
    const result1 = await fixComplianceIssue(
      fixtureHtml,
      langIssue,
      initialIssues.indexOf(langIssue),
      initialReport
    );

    for (const { issue, idx } of originallyPassing) {
      const afterIssue = result1.complianceReport.issues[idx];
      expect(
        afterIssue.status === "pass" || afterIssue.status === "fixed",
        `After fix 1: issue ${afterIssue.criterion} "${afterIssue.title}" (index ${idx}) was originally "pass" but became "${afterIssue.status}"`
      ).toBe(true);
    }

    // Fix 2: page title, chained from fix 1
    const html2 = html1.replace("<title></title>", "<title>Form W-99</title>");
    mockAiResponse(`<!DOCTYPE html>\n${html2}`);
    const titleIssue = result1.complianceReport.issues.find((i) => i.criterion === "2.4.2")!;
    const result2 = await fixComplianceIssue(
      result1.accessibleHtml,
      titleIssue,
      result1.complianceReport.issues.indexOf(titleIssue),
      result1.complianceReport
    );

    for (const { issue, idx } of originallyPassing) {
      const afterIssue = result2.complianceReport.issues[idx];
      expect(
        afterIssue.status === "pass" || afterIssue.status === "fixed",
        `After fix 2: issue ${afterIssue.criterion} "${afterIssue.title}" (index ${idx}) was originally "pass" but became "${afterIssue.status}"`
      ).toBe(true);
    }
  });

  it("no originally-passing issue regresses after a deterministic ARIA fix on a custom minimal HTML", async () => {
    // Custom minimal HTML: several issues pass at baseline; one ARIA link role issue warns
    const customHtml = `<!DOCTYPE html>
<html lang="en">
<head><title>My Test Page</title></head>
<body>
<main>
  <h1>Welcome</h1>
  <p>Some content with no images.</p>
  <div role="link" tabindex="0" onclick="navigate()">Go somewhere</div>
</main>
</body>
</html>`;

    const initialIssues = runDeterministicChecks(customHtml);
    const initialReport = makeReport(initialIssues);

    const originallyPassing = initialIssues
      .map((issue, idx) => ({ issue, idx }))
      .filter(({ issue }) => issue.status === "pass");

    expect(originallyPassing.length).toBeGreaterThan(0);

    // The ARIA Link Role fix is deterministic — no AI call needed
    const ariaLinkIssue = initialIssues.find(
      (i) => i.criterion === "4.1.2" && i.title === "ARIA Link Role on Non-Anchor Element"
    )!;
    expect(ariaLinkIssue).toBeDefined();
    expect(ariaLinkIssue.status).toBe("warning");

    const result = await fixComplianceIssue(
      customHtml,
      ariaLinkIssue,
      initialIssues.indexOf(ariaLinkIssue),
      initialReport
    );

    // The targeted issue must now be fixed
    expect(
      result.complianceReport.issues[initialIssues.indexOf(ariaLinkIssue)].status
    ).toBe("fixed");

    // Every originally-passing issue must still be "pass" or "fixed"
    for (const { issue, idx } of originallyPassing) {
      const afterIssue = result.complianceReport.issues[idx];
      expect(
        afterIssue.status === "pass" || afterIssue.status === "fixed",
        `Issue ${afterIssue.criterion} "${afterIssue.title}" (index ${idx}) was originally "pass" but became "${afterIssue.status}" after the deterministic fix`
      ).toBe(true);
    }
  });

  it("no originally-passing issue regresses when a malformed AI response only changes the targeted element on a custom minimal HTML", async () => {
    // Minimal HTML with one failing issue (missing lang) and several passing ones
    const customHtml = `<!DOCTYPE html>
<html>
<head><title>Report</title></head>
<body>
<main>
  <h1>Annual Report</h1>
  <p>No images, no absolutely positioned divs.</p>
</main>
</body>
</html>`;

    const initialIssues = runDeterministicChecks(customHtml);
    const initialReport = makeReport(initialIssues);

    const originallyPassing = initialIssues
      .map((issue, idx) => ({ issue, idx }))
      .filter(({ issue }) => issue.status === "pass");

    expect(originallyPassing.length).toBeGreaterThan(0);

    // Fix lang (3.1.1) — the AI response correctly adds lang="en" without touching anything else
    const fixedHtml = customHtml.replace("<html>", '<html lang="en">');
    mockAiResponse(`<!DOCTYPE html>\n${fixedHtml}`);

    const langIssue = initialIssues.find((i) => i.criterion === "3.1.1")!;
    expect(langIssue.status).toBe("fail");

    const result = await fixComplianceIssue(
      customHtml,
      langIssue,
      initialIssues.indexOf(langIssue),
      initialReport
    );

    expect(result.complianceReport.issues[initialIssues.indexOf(langIssue)].status).toBe("fixed");

    // No previously-passing issue should regress
    for (const { issue, idx } of originallyPassing) {
      const afterIssue = result.complianceReport.issues[idx];
      expect(
        afterIssue.status === "pass" || afterIssue.status === "fixed",
        `Issue ${afterIssue.criterion} "${afterIssue.title}" (index ${idx}) was originally "pass" but became "${afterIssue.status}" after the fix`
      ).toBe(true);
    }
  });
});

// fixComplianceIssue — partial AI response propagation in multi-fix chains
// ---------------------------------------------------------------------------
// These tests feed the (potentially corrupted) document returned by a first
// fixComplianceIssue call directly into a second call, verifying that the
// engine degrades consistently rather than silently producing worse output.
// ---------------------------------------------------------------------------

describe("fixComplianceIssue – partial AI response propagation in multi-fix chains", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("round 1 throws when AI returns truncated HTML missing </body> and </html>, blocking the chain at the boundary", async () => {
    // This test documents that corrupted output cannot silently propagate to step 2:
    // the hardened validation in fixComplianceIssue rejects it before any result is
    // returned, making it impossible to call a second fix with the corrupted document
    // via the normal execution path.
    // Note: the engine retries once on an invalid response, so both the first attempt
    // and the retry must return truncated HTML for the throw to be reached.
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h2>Section</h2></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const report = makeReport(issues);

    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;

    const truncatedResponse = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Section</h1></main>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedResponse }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedResponse }] });

    await expect(
      fixComplianceIssue(html, headingIssue, issues.indexOf(headingIssue), report)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
  });

  it("round 1 throws when AI returns head-only HTML with no <body>, blocking the chain at the boundary", async () => {
    // Same boundary test for the head-only shape: the caller never receives a result and
    // therefore cannot feed a corrupted document into a subsequent fixComplianceIssue call.
    // Both the initial attempt and the retry return head-only HTML to reach the throw.
    const html = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h2>Section</h2></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const report = makeReport(issues);

    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;

    const headOnlyResponse = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: headOnlyResponse }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: headOnlyResponse }] });

    await expect(
      fixComplianceIssue(html, headingIssue, issues.indexOf(headingIssue), report)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
  });

  it("deterministic lang fix succeeds when applied to a truncated document — simulates step 2 in a chain where step 1 leaked corrupted output", async () => {
    // Directly construct the corrupted document that step 2 would receive if step 1 had
    // returned truncated HTML without being rejected (e.g. before hardening was applied).
    const truncatedInput = `<!DOCTYPE html><html><head><title></title></head><body><main><h1>No H1 Here</h1></main>`;
    const issues = runDeterministicChecks(truncatedInput);
    const prevReport = makeReport(issues);

    // The lang issue must still be detectable even in truncated HTML
    const langIssue = issues.find((i) => i.criterion === "3.1.1")!;
    expect(langIssue.status).toBe("fail");
    const langIndex = issues.indexOf(langIssue);

    // Deterministic fix — no AI call queued; must not throw even though input is truncated
    const result = await fixComplianceIssue(truncatedInput, langIssue, langIndex, prevReport);

    expect(result.accessibleHtml).toContain('lang="en"');
    expect(result.complianceReport.issues[langIndex].status).toBe("fixed");
  });

  it("deterministic lang fix succeeds when applied to a head-only document — simulates step 2 in a chain where step 1 leaked corrupted output", async () => {
    // Directly construct a head-only document that step 2 would receive if step 1 had
    // returned head-only HTML without being rejected (e.g. before hardening was applied).
    const headOnlyInput = `<!DOCTYPE html><html><head><title></title></head></html>`;
    const issues = runDeterministicChecks(headOnlyInput);
    const prevReport = makeReport(issues);

    // The lang issue must still be detectable in head-only HTML
    const langIssue = issues.find((i) => i.criterion === "3.1.1")!;
    expect(langIssue.status).toBe("fail");
    const langIndex = issues.indexOf(langIssue);

    // Deterministic fix — no AI call queued; must not throw even though input has no <body>
    const result = await fixComplianceIssue(headOnlyInput, langIssue, langIndex, prevReport);

    expect(result.accessibleHtml).toContain('lang="en"');
    expect(result.complianceReport.issues[langIndex].status).toBe("fixed");
  });

  it("round 2 throws when its AI returns truncated HTML, consistent with single-call behaviour (chain with valid round 1)", async () => {
    // Use HTML that has a heading issue (AI path) AND an image without alt (AI path for round 2).
    const htmlWithImg = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h2>Section</h2><img src="photo.jpg"></main></body></html>`;
    const initialIssues = runDeterministicChecks(htmlWithImg);
    const initialReport = makeReport(initialIssues);

    // Round 1: AI fixes the heading issue (2.4.6) and returns VALID, complete HTML.
    const validAfterRound1 = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Section</h1><img src="photo.jpg"></main></body></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: validAfterRound1 }] });

    const headingIssue = initialIssues.find((i) => i.criterion === "2.4.6")!;
    const result1 = await fixComplianceIssue(htmlWithImg, headingIssue, initialIssues.indexOf(headingIssue), initialReport);
    expect(result1.accessibleHtml).toBe(validAfterRound1);

    // Round 2: AI fix for alt text (1.1.1) — AI path; AI returns truncated HTML on both
    // the initial attempt and the retry, causing the engine to throw.
    const truncatedRound2Response = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Section</h1><img src="photo.jpg" alt="Photo"></main>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedRound2Response }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedRound2Response }] });

    const altIssue = result1.complianceReport.issues.find((i) => i.criterion === "1.1.1")!;
    const altIndex = result1.complianceReport.issues.indexOf(altIssue);

    // Round 2 must reject the truncated AI response, consistent with single-call behaviour.
    await expect(
      fixComplianceIssue(result1.accessibleHtml, altIssue, altIndex, result1.complianceReport)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
  });

  it("round 2 throws when its AI returns head-only HTML, consistent with single-call behaviour (chain with valid round 1)", async () => {
    // Use HTML that has a heading issue (AI path) AND an image without alt (AI path for round 2).
    const htmlWithImg = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h2>Section</h2><img src="photo.jpg"></main></body></html>`;
    const initialIssues = runDeterministicChecks(htmlWithImg);
    const initialReport = makeReport(initialIssues);

    // Round 1: AI fixes the heading issue (2.4.6) and returns VALID, complete HTML.
    const validAfterRound1 = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>Section</h1><img src="photo.jpg"></main></body></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: validAfterRound1 }] });

    const headingIssue = initialIssues.find((i) => i.criterion === "2.4.6")!;
    const result1 = await fixComplianceIssue(htmlWithImg, headingIssue, initialIssues.indexOf(headingIssue), initialReport);
    expect(result1.accessibleHtml).toBe(validAfterRound1);

    // Round 2: AI fix for alt text (1.1.1) — AI returns head-only HTML on both the initial
    // attempt and the retry, causing the engine to throw.
    const headOnlyRound2Response = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: headOnlyRound2Response }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: headOnlyRound2Response }] });

    const altIssue = result1.complianceReport.issues.find((i) => i.criterion === "1.1.1")!;
    const altIndex = result1.complianceReport.issues.indexOf(altIssue);

    // Round 2 must reject the head-only AI response, consistent with single-call behaviour.
    await expect(
      fixComplianceIssue(result1.accessibleHtml, altIssue, altIndex, result1.complianceReport)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
  });
});

// fixComplianceIssue — partial / truncated AI response edge cases
// ---------------------------------------------------------------------------

describe("fixComplianceIssue – partial or truncated AI HTML responses", () => {
  const baseHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h2>No H1 Here</h2></main></body></html>`;

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("throws when the AI returns a valid HTML fragment that is missing the DOCTYPE declaration (both attempts fail)", async () => {
    const issues = runDeterministicChecks(baseHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    const noDoctype = `<html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main></body></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: noDoctype }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: noDoctype }] });

    const report = makeReport(issues);
    await expect(
      fixComplianceIssue(baseHtml, headingIssue, issues.indexOf(headingIssue), report)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws when AI returns truncated HTML on both attempts (missing closing </body> and </html> tags)", async () => {
    const issues = runDeterministicChecks(baseHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    const truncatedHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedHtml }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedHtml }] });

    const report = makeReport(issues);
    await expect(
      fixComplianceIssue(baseHtml, headingIssue, issues.indexOf(headingIssue), report)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws when AI returns head-only HTML on both attempts (no <body>)", async () => {
    const issues = runDeterministicChecks(baseHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    const headOnlyHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: headOnlyHtml }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: headOnlyHtml }] });

    const report = makeReport(issues);
    await expect(
      fixComplianceIssue(baseHtml, headingIssue, issues.indexOf(headingIssue), report)
    ).rejects.toThrow("AI failed to produce a valid HTML fix");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("succeeds on retry when the first AI response is incomplete but the second is valid", async () => {
    const issues = runDeterministicChecks(baseHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    const truncatedHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main>`;
    const validHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main></body></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedHtml }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: validHtml }] });

    const report = makeReport(issues);
    const result = await fixComplianceIssue(baseHtml, headingIssue, issues.indexOf(headingIssue), report);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.accessibleHtml).toContain("</body>");
    expect(result.accessibleHtml).toContain("</html>");
  });

  it("sets wasRetried to true when first AI response is invalid and retry produces valid HTML", async () => {
    // This is the core retry-notice test: the first AI call returns a truncated/incomplete
    // document that fails validateOutput, triggering the retry path. The second call returns
    // a valid document. The result must carry wasRetried: true so the route layer can surface
    // the toast notice to the user.
    const issues = runDeterministicChecks(baseHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    const incompleteHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main>`;
    const validHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main></body></html>`;

    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: incompleteHtml }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: validHtml }] });

    const report = makeReport(issues);
    const result = await fixComplianceIssue(baseHtml, headingIssue, issues.indexOf(headingIssue), report);

    expect(result.wasRetried).toBe(true);
    expect(result.accessibleHtml).toContain("</body>");
    expect(result.accessibleHtml).toContain("</html>");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("does not set wasRetried when the first AI response is already valid", async () => {
    // The wasRetried flag must remain false (or undefined) on the happy path where no retry
    // was needed. This prevents a spurious toast from appearing to the user.
    const issues = runDeterministicChecks(baseHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;
    expect(headingIssue.status).toBe("fail");

    const validHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main></body></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: validHtml }] });

    const report = makeReport(issues);
    const result = await fixComplianceIssue(baseHtml, headingIssue, issues.indexOf(headingIssue), report);

    expect(result.wasRetried).toBeFalsy();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("uses the strict completeness prompt on the retry call", async () => {
    const issues = runDeterministicChecks(baseHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;

    const truncatedHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main>`;
    const validHtml = `<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><main><h1>No H1 Here</h1></main></body></html>`;
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: truncatedHtml }] });
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: validHtml }] });

    const report = makeReport(issues);
    await fixComplianceIssue(baseHtml, headingIssue, issues.indexOf(headingIssue), report);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const retryCall = mockCreate.mock.calls[1][0] as { system: string };
    expect(retryCall.system).toContain("CRITICAL");
    expect(retryCall.system).toContain("ENTIRE document");
  });
});

// ---------------------------------------------------------------------------
// Angle-bracket-in-attribute-value robustness tests
// These verify that the robust (?:[^>"']|"[^"]*"|'[^']*')* pattern correctly
// handles attribute values that contain literal '>' characters, which would
// cause the naive [^>]* pattern to terminate the match prematurely.
// ---------------------------------------------------------------------------

describe("runDeterministicChecks – angle bracket in attribute value", () => {
  it("correctly detects lang attribute on <html> even when an earlier attribute value contains literal '>'", () => {
    const htmlWithLang = `<!DOCTYPE html><html data-info="a>b" lang="en"><head><title>T</title></head><body><main><h1>T</h1></main></body></html>`;
    const issues = runDeterministicChecks(htmlWithLang);
    const langIssue = issues.find((i) => i.criterion === "3.1.1");
    expect(langIssue).toBeDefined();
    expect(langIssue!.status).toBe("pass");
  });

  it("reports lang as missing when <html> has '>' in an attribute value but no lang", () => {
    const htmlNoLang = `<!DOCTYPE html><html data-info="a>b"><head><title>T</title></head><body><main><h1>T</h1></main></body></html>`;
    const issues = runDeterministicChecks(htmlNoLang);
    const langIssue = issues.find((i) => i.criterion === "3.1.1");
    expect(langIssue).toBeDefined();
    expect(langIssue!.status).toBe("fail");
  });
});

describe("applyLangAttributeFix – angle bracket in attribute value", () => {
  it("adds lang attribute when <html> tag contains a double-quoted attribute value with '>'", () => {
    const html = `<!DOCTYPE html><html data-info="a>b"><head><title>T</title></head><body></body></html>`;
    const result = applyLangAttributeFix(html);
    expect(result).toMatch(/lang="en"/i);
  });

  it("adds lang attribute when <html> tag contains a single-quoted attribute value with '>'", () => {
    const html = `<!DOCTYPE html><html data-info='a>b'><head><title>T</title></head><body></body></html>`;
    const result = applyLangAttributeFix(html);
    expect(result).toMatch(/lang="en"/i);
  });

  it("does not add lang when lang is already present, even with '>' in an earlier attribute value", () => {
    const html = `<!DOCTYPE html><html data-info="a>b" lang="fr"><head><title>T</title></head><body></body></html>`;
    const result = applyLangAttributeFix(html);
    expect(result).toBe(html);
  });
});

describe("applyPageTitleFix – angle bracket in attribute value", () => {
  it("inserts <title> into <head> when <head> tag has a double-quoted attribute value containing '>'", () => {
    const html = `<!DOCTYPE html><html lang="en"><head data-meta="x>y"></head><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>");
  });

  it("inserts <head><title> after <html> tag when no <head> present and <html> has '>' in attribute value", () => {
    const html = `<!DOCTYPE html><html lang="en" data-info="a>b"><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>");
  });

  it("replaces empty <title> even when <head> tag has '>' in attribute value", () => {
    const html = `<!DOCTYPE html><html lang="en"><head data-x="p>q"><title></title></head><body></body></html>`;
    const result = applyPageTitleFix(html);
    expect(result).not.toContain("<title></title>");
    expect(result).toContain("<title>");
  });
});

describe("runDeterministicChecks – angle bracket in attribute value", () => {
  it("correctly detects lang attribute on <html> even when an earlier attribute value contains literal '>'", () => {
    const htmlWithLang = `<!DOCTYPE html><html data-info="a>b" lang="en"><head><title>T</title></head><body><main><h1>T</h1></main></body></html>`;
    const issues = runDeterministicChecks(htmlWithLang);
    const langIssue = issues.find((i) => i.criterion === "3.1.1");
    expect(langIssue).toBeDefined();
    expect(langIssue!.status).toBe("pass");
  });

  it("reports lang as missing when <html> has '>' in an attribute value but no lang", () => {
    const htmlNoLang = `<!DOCTYPE html><html data-info="a>b"><head><title>T</title></head><body><main><h1>T</h1></main></body></html>`;
    const issues = runDeterministicChecks(htmlNoLang);
    const langIssue = issues.find((i) => i.criterion === "3.1.1");
    expect(langIssue).toBeDefined();
    expect(langIssue!.status).toBe("fail");
  });
});

describe("applyAriaRoleHeaderFix – angle bracket in attribute value", () => {
  it("converts td[role=columnheader] to <th scope=col> when td has an attribute value containing literal '>'", () => {
    const html = `<table><tr><td role="columnheader" data-info="a>b">Header</td></tr></table>`;
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain('<th scope="col"');
    expect(result).not.toContain('role="columnheader"');
  });
});

describe("applyAriaLinkRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=link] to <a> when an attribute value contains literal '>'", () => {
    const html = `<div role="link" title="Click > here" tabindex="0">Go</div>`;
    const result = applyAriaLinkRoleFix(html);
    expect(result).toContain("<a ");
    expect(result).not.toContain('role="link"');
    expect(result).toContain("Go");
  });
});

describe("applyAriaListRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=list] to <ul> when an attribute value contains literal '>'", () => {
    const html = `<div role="list" data-label="items > 0"><li>A</li></div>`;
    const result = applyAriaListRoleFix(html);
    expect(result).toContain("<ul");
    expect(result).not.toContain('role="list"');
    expect(result).toContain("<li>A</li>");
  });
});

describe("applyAriaListitemRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=listitem] to <li> when an attribute value contains literal '>'", () => {
    const html = `<ul><div role="listitem" data-label="item > 1">Entry</div></ul>`;
    const result = applyAriaListitemRoleFix(html);
    expect(result).toContain("<li");
    expect(result).not.toContain('role="listitem"');
    expect(result).toContain("Entry");
  });
});

describe("replaceAriaRoleElements (via applyAriaComboboxRoleFix) – angle bracket in attribute value", () => {
  it("converts div[role=combobox] to <select> when an attribute value contains literal '>'", () => {
    const html = `<div role="combobox" data-label="opt > 0"><option>A</option></div>`;
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toContain("<select");
    expect(result).not.toContain('role="combobox"');
    expect(result).toContain("<option>A</option>");
  });
});

describe("applyAriaButtonRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=button] to <button> when an attribute value contains literal '>'", () => {
    const html = `<div role="button" data-label="count > 0">Click me</div>`;
    const result = applyAriaButtonRoleFix(html);
    expect(result).toContain("<button");
    expect(result).not.toContain('role="button"');
    expect(result).toContain("Click me");
  });
});

describe("applyAriaCheckboxRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=checkbox] to <input type=checkbox> when an attribute value contains literal '>'", () => {
    const html = `<div role="checkbox" data-label="score > 0">Accept</div>`;
    const result = applyAriaCheckboxRoleFix(html);
    expect(result).toContain('<input type="checkbox"');
    expect(result).not.toContain('role="checkbox"');
    expect(result).toContain("Accept");
  });
});

describe("applyAriaRadioRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=radio] to <input type=radio> when an attribute value contains literal '>'", () => {
    const html = `<div role="radio" data-label="value > 1">Option</div>`;
    const result = applyAriaRadioRoleFix(html);
    expect(result).toContain('<input type="radio"');
    expect(result).not.toContain('role="radio"');
    expect(result).toContain("Option");
  });
});

describe("applyAriaGridRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=grid] to <table> when an attribute value contains literal '>'", () => {
    const html = `<div role="grid" data-label="rows > 0"><tr><td>Cell</td></tr></div>`;
    const result = applyAriaGridRoleFix(html);
    expect(result).toContain("<table");
    expect(result).not.toContain('role="grid"');
    expect(result).toContain("<td>Cell</td>");
  });
});

describe("applyAriaTabRoleFix – angle bracket in attribute value", () => {
  it("converts div[role=tab] to <button> when an attribute value contains literal '>'", () => {
    const html = `<div role="tab" data-label="step > 1">Tab One</div>`;
    const result = applyAriaTabRoleFix(html);
    expect(result).toContain("<button");
    expect(result).not.toContain('role="tab"');
    expect(result).toContain("Tab One");
  });
});

// ---------------------------------------------------------------------------
// registerDeterministicFixer
// ---------------------------------------------------------------------------

describe("registerDeterministicFixer", () => {
  it("registers a custom fixer that fixComplianceIssue dispatches without calling AI", async () => {
    const CUSTOM_CRITERION = "9.9.9";
    const CUSTOM_TITLE = "Custom Test Fixer";
    const SENTINEL = "data-custom-fixed";

    registerDeterministicFixer(`${CUSTOM_CRITERION}::${CUSTOM_TITLE}`, (html) =>
      html.replace("<body>", `<body ${SENTINEL}>`)
    );

    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>H</h1></main></body></html>`;
    const customIssue: ComplianceIssue = {
      criterion: CUSTOM_CRITERION,
      title: CUSTOM_TITLE,
      level: "AA",
      status: "fail",
      description: "Custom test issue",
      details: "Details",
    };
    const report = buildComplianceReport([customIssue]);

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, customIssue, 0, report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).toContain(SENTINEL);
  });

  it("allows overwriting an existing fixer key", async () => {
    const key = "3.1.1::Language of Page";
    const MARKER = "data-overwritten";

    registerDeterministicFixer(key, (html) => html.replace("<html", `<html ${MARKER}`));

    const html = `<!DOCTYPE html><html><head><title>T</title></head><body><main><h1>H</h1></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const langIssue = issues.find((i) => i.title === "Language of Page")!;
    const report = buildComplianceReport(issues);

    const result = await fixComplianceIssue(html, langIssue, issues.indexOf(langIssue), report);
    expect(result.accessibleHtml).toContain(MARKER);

    registerDeterministicFixer(key, applyLangAttributeFix);
  });
});

// ---------------------------------------------------------------------------
// fixAllAriaRoleMisuse – batch fix
// ---------------------------------------------------------------------------

function makeAriaReport(issues: Partial<ComplianceIssue>[]): ComplianceReport {
  const full: ComplianceIssue[] = issues.map((ov) => ({
    criterion: "1.3.1",
    title: "ARIA Role Misuse",
    level: "A" as const,
    status: "warning" as const,
    description: "ARIA role misuse.",
    details: "Element uses wrong ARIA role.",
    ...ov,
  }));
  return buildComplianceReport(full);
}

describe("fixAllAriaRoleMisuse", () => {
  it("fixes combobox, grid, and tab misuse in a single call", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="combobox"><option>A</option></div>
      <div role="grid"><tr><td>Cell</td></tr></div>
      <div role="tab">Tab One</div>
    </body></html>`;

    const report = makeAriaReport([
      { title: "ARIA Combobox Role on Non-Combobox Element" },
      { title: "ARIA Grid Role on Non-Table Element" },
      { title: "ARIA Tab Role on Non-Interactive Element" },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    expect(result.accessibleHtml).not.toContain('role="combobox"');
    expect(result.accessibleHtml).not.toContain('role="grid"');
    expect(result.accessibleHtml).not.toContain('role="tab"');
    expect(result.accessibleHtml).toContain("<select");
    expect(result.accessibleHtml).toContain("<table");
    expect(result.accessibleHtml).toContain("<button");
  });

  it("marks all three ARIA role issues as fixed in the compliance report", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="combobox"><option>A</option></div>
      <div role="grid"><tr><td>Cell</td></tr></div>
      <div role="tab">Tab One</div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Combobox Role on Non-Combobox Element" },
      { criterion: "1.3.1", title: "ARIA Grid Role on Non-Table Element" },
      { criterion: "1.3.1", title: "ARIA Tab Role on Non-Interactive Element" },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    const comboboxIssue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Combobox Role on Non-Combobox Element"
    );
    const gridIssue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Grid Role on Non-Table Element"
    );
    const tabIssue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Tab Role on Non-Interactive Element"
    );

    expect(comboboxIssue?.status).toBe("fixed");
    expect(gridIssue?.status).toBe("fixed");
    expect(tabIssue?.status).toBe("fixed");
  });

  it("preserves non-ARIA issues unchanged", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="tab">Tab One</div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Tab Role on Non-Interactive Element" },
      { criterion: "4.1.2", title: "Name Role Value", status: "fail", details: "Missing label." },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    const nameRoleIssue = result.complianceReport.issues.find(
      (i) => i.title === "Name Role Value"
    );
    expect(nameRoleIssue?.status).toBe("fail");
  });

  it("preserves already-fixed ARIA issues as fixed", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="combobox"><option>A</option></div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Combobox Role on Non-Combobox Element", status: "fixed" },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    const issue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Combobox Role on Non-Combobox Element"
    );
    expect(issue?.status).toBe("fixed");
  });

  it("updates the overall compliance score upward after fixing all three roles", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="combobox"><option>A</option></div>
      <div role="grid"><tr><td>Cell</td></tr></div>
      <div role="tab">Tab One</div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Combobox Role on Non-Combobox Element" },
      { criterion: "1.3.1", title: "ARIA Grid Role on Non-Table Element" },
      { criterion: "1.3.1", title: "ARIA Tab Role on Non-Interactive Element" },
    ]);

    const before = report.overallScore;
    const result = fixAllAriaRoleMisuse(html, report);
    expect(result.complianceReport.overallScore).toBeGreaterThan(before);
  });

  it("fixes all nine ARIA role types present simultaneously", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <td role="columnheader">Header</td>
      <div role="link" href="/about">About</div>
      <div role="checkbox">Check me</div>
      <div role="radio">Option A</div>
      <div role="list"><div role="listitem">Item</div></div>
      <div role="combobox"><option>A</option></div>
      <div role="grid"><tr><td>Cell</td></tr></div>
      <div role="tab">Tab One</div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Role on Table Data Cell" },
      { criterion: "4.1.2", title: "ARIA Link Role on Non-Anchor Element" },
      { criterion: "4.1.2", title: "ARIA Checkbox Role on Non-Input Element" },
      { criterion: "4.1.2", title: "ARIA Radio Role on Non-Input Element" },
      { criterion: "1.3.1", title: "ARIA List Role on Non-List Element" },
      { criterion: "1.3.1", title: "ARIA Listitem Role on Non-Listitem Element" },
      { criterion: "1.3.1", title: "ARIA Combobox Role on Non-Combobox Element" },
      { criterion: "1.3.1", title: "ARIA Grid Role on Non-Table Element" },
      { criterion: "1.3.1", title: "ARIA Tab Role on Non-Interactive Element" },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    const warningOrFail = result.complianceReport.issues.filter(
      (i) => i.title.includes("ARIA") && (i.status === "warning" || i.status === "fail")
    );
    expect(warningOrFail).toHaveLength(0);
  });

  it("correctly transitions warning-status ARIA issues to fixed (matching real deterministic output)", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="combobox"><option>A</option></div>
      <div role="grid"><tr><td>Cell</td></tr></div>
      <div role="tab">Tab One</div>
    </body></html>`;

    const report = buildComplianceReport(
      runDeterministicChecks(html)
    );

    const before = report.issues.filter((i) => i.title.includes("ARIA") && i.status === "warning");
    expect(before.length).toBeGreaterThanOrEqual(3);

    const result = fixAllAriaRoleMisuse(html, report);

    const after = result.complianceReport.issues.filter(
      (i) => i.title.includes("ARIA") && (i.status === "warning" || i.status === "fail")
    );
    expect(after).toHaveLength(0);

    const fixed = result.complianceReport.issues.filter(
      (i) => i.title.includes("ARIA") && i.status === "fixed"
    );
    expect(fixed.length).toBeGreaterThanOrEqual(3);
  });

  it("attaches fixNotes to the heading issue when headings fallback to h2", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="heading">No aria-level, no context</div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Heading Role on Non-Heading Element" },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    const headingIssue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Heading Role on Non-Heading Element"
    );
    expect(headingIssue?.fixNotes).toMatch(/defaulted to <h2>/);
  });

  it("attaches fixNotes to the heading issue when headings use inferred level", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <h1>Top heading</h1>
      <div role="heading">No aria-level, but h1 precedes it</div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Heading Role on Non-Heading Element" },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    const headingIssue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Heading Role on Non-Heading Element"
    );
    expect(headingIssue?.fixNotes).toMatch(/nearest preceding heading/);
  });

  it("does not attach fixNotes when all headings have explicit aria-level", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="heading" aria-level="2">Explicit level</div>
    </body></html>`;

    const report = makeAriaReport([
      { criterion: "1.3.1", title: "ARIA Heading Role on Non-Heading Element" },
    ]);

    const result = fixAllAriaRoleMisuse(html, report);

    const headingIssue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Heading Role on Non-Heading Element"
    );
    expect(headingIssue?.fixNotes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fixComplianceIssue – batch ARIA role misuse dispatch
// ---------------------------------------------------------------------------

describe("fixComplianceIssue – batch ARIA role misuse via synthetic issue title", () => {
  it("dispatches to fixAllAriaRoleMisuse when issue title is 'Fix all ARIA role misuse'", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <div role="combobox"><option>A</option></div>
      <div role="grid"><tr><td>Cell</td></tr></div>
      <div role="tab">Tab One</div>
    </body></html>`;

    const report = buildComplianceReport(runDeterministicChecks(html));

    const batchIssue: ComplianceIssue = {
      criterion: "batch",
      title: "Fix all ARIA role misuse",
      level: "A",
      status: "warning",
      description: "Fix all ARIA role misuse in one action.",
      details: "Applies all registered ARIA role fixers.",
    };

    mockCreate.mockClear();
    const result = await fixComplianceIssue(html, batchIssue, -1, report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).not.toContain('role="combobox"');
    expect(result.accessibleHtml).not.toContain('role="grid"');
    expect(result.accessibleHtml).not.toContain('role="tab"');

    const remaining = result.complianceReport.issues.filter(
      (i) => i.title.includes("ARIA") && (i.status === "warning" || i.status === "fail")
    );
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// fixComplianceIssue — deterministic fix for Duplicate Table Captions
// ---------------------------------------------------------------------------

describe("fixComplianceIssue – Duplicate Table Captions deterministic fixer", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("resolves two tables sharing the same caption by appending positional suffixes", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <main><h1>T</h1>
        <table><caption>Student Grades</caption><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Alice</td></tr></tbody></table>
        <table><caption>Student Grades</caption><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Bob</td></tr></tbody></table>
      </main></body></html>`;

    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).toContain("Student Grades (1 of 2)");
    expect(result.accessibleHtml).toContain("Student Grades (2 of 2)");
    expect(result.accessibleHtml).not.toContain("<caption>Student Grades</caption>");
  });

  it("re-running runDeterministicChecks on the fixed HTML no longer emits the warning", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <main><h1>T</h1>
        <table><caption>Summary</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
        <table><caption>Summary</caption><thead><tr><th>B</th></tr></thead><tbody><tr><td>2</td></tr></tbody></table>
      </main></body></html>`;

    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    const afterIssue = afterIssues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions");
    expect(afterIssue).toBeUndefined();
  });

  it("handles three tables sharing the same caption and numbers them correctly", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <main><h1>T</h1>
        <table><caption>Data</caption><thead><tr><th>X</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>
        <table><caption>Data</caption><thead><tr><th>X</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>
        <table><caption>Data</caption><thead><tr><th>X</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>
      </main></body></html>`;

    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.accessibleHtml).toContain("Data (1 of 3)");
    expect(result.accessibleHtml).toContain("Data (2 of 3)");
    expect(result.accessibleHtml).toContain("Data (3 of 3)");

    const afterIssues = runDeterministicChecks(result.accessibleHtml);
    expect(afterIssues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions")).toBeUndefined();
  });

  it("preserves the original caption text casing when adding the suffix", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <main><h1>T</h1>
        <table><caption>SUMMARY</caption><thead><tr><th>C</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>
        <table><caption>SUMMARY</caption><thead><tr><th>C</th></tr></thead><tbody><tr><td>y</td></tr></tbody></table>
      </main></body></html>`;

    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(result.accessibleHtml).toContain("SUMMARY (1 of 2)");
    expect(result.accessibleHtml).toContain("SUMMARY (2 of 2)");
  });

  it("leaves tables with unique captions and tables without captions untouched", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>
      <main><h1>T</h1>
        <table><caption>Alpha</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
        <table><caption>Alpha</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>2</td></tr></tbody></table>
        <table><caption>Beta</caption><thead><tr><th>B</th></tr></thead><tbody><tr><td>3</td></tr></tbody></table>
        <table><thead><tr><th>C</th></tr></thead><tbody><tr><td>4</td></tr></tbody></table>
      </main></body></html>`;

    const issues = runDeterministicChecks(html);
    const issue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Duplicate Table Captions")!;
    expect(issue).toBeDefined();

    const report = buildComplianceReport(issues);
    const result = await fixComplianceIssue(html, issue, issues.indexOf(issue), report);

    expect(result.accessibleHtml).toContain("Alpha (1 of 2)");
    expect(result.accessibleHtml).toContain("Alpha (2 of 2)");
    expect(result.accessibleHtml).toContain("<caption>Beta</caption>");
  });
});

// ---------------------------------------------------------------------------
// Backtick-quoted attribute values — ATTR_PATTERN coverage
// These tests confirm that ATTR_PATTERN correctly handles backtick-delimited
// attribute values so fixers do not mistake the closing backtick for the end
// of the tag or mismatch the attribute list.
// ---------------------------------------------------------------------------

describe("applyLangAttributeFix – backtick-quoted attribute value", () => {
  it("adds lang attribute when <html> tag contains a backtick-quoted attribute value", () => {
    const html = "<!DOCTYPE html><html data-info=`a b`><head><title>T</title></head><body></body></html>";
    const result = applyLangAttributeFix(html);
    expect(result).toMatch(/lang="en"/i);
  });

  it("does not add lang when lang is already present alongside a backtick-quoted attribute value", () => {
    const html = "<!DOCTYPE html><html data-info=`a b` lang=\"fr\"><head><title>T</title></head><body></body></html>";
    const result = applyLangAttributeFix(html);
    expect(result).toBe(html);
  });

  it("does not treat a backtick inside the value as the end of the <html> tag", () => {
    const html = "<!DOCTYPE html><html data-x=`foo`><head><title>T</title></head><body></body></html>";
    const result = applyLangAttributeFix(html);
    expect(result).toContain("lang=\"en\"");
    expect(result).not.toContain("<html><head>");
  });
});

describe("applyPageTitleFix – backtick-quoted attribute value", () => {
  it("inserts <title> into <head> when <head> tag has a backtick-quoted attribute value", () => {
    const html = "<!DOCTYPE html><html lang=\"en\"><head data-meta=`x`></head><body></body></html>";
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>");
  });

  it("inserts <head><title> after <html> tag when no <head> present and <html> has a backtick-quoted attribute value", () => {
    const html = "<!DOCTYPE html><html lang=\"en\" data-info=`a b`><body></body></html>";
    const result = applyPageTitleFix(html);
    expect(result).toContain("<title>");
  });

  it("replaces empty <title> even when <head> tag has a backtick-quoted attribute value", () => {
    const html = "<!DOCTYPE html><html lang=\"en\"><head data-x=`p`><title></title></head><body></body></html>";
    const result = applyPageTitleFix(html);
    expect(result).not.toContain("<title></title>");
    expect(result).toContain("<title>");
  });
});

describe("runDeterministicChecks – backtick-quoted attribute value", () => {
  it("correctly detects lang attribute on <html> even when an earlier attribute value is backtick-quoted", () => {
    const html = "<!DOCTYPE html><html data-info=`a b` lang=\"en\"><head><title>T</title></head><body><main><h1>T</h1></main></body></html>";
    const issues = runDeterministicChecks(html);
    const langIssue = issues.find((i) => i.criterion === "3.1.1");
    expect(langIssue).toBeDefined();
    expect(langIssue!.status).toBe("pass");
  });

  it("reports lang as missing when <html> has a backtick-quoted attribute value but no lang", () => {
    const html = "<!DOCTYPE html><html data-info=`a b`><head><title>T</title></head><body><main><h1>T</h1></main></body></html>";
    const issues = runDeterministicChecks(html);
    const langIssue = issues.find((i) => i.criterion === "3.1.1");
    expect(langIssue).toBeDefined();
    expect(langIssue!.status).toBe("fail");
  });

  it("passes image alt check when an <img> has a backtick-quoted class attribute and a valid alt", () => {
    const html = "<html lang=\"en\"><body><img class=`hero` src=\"photo.jpg\" alt=\"A cat\"></body></html>";
    const issues = runDeterministicChecks(html);
    const altCheck = issues.find((i) => i.criterion === "1.1.1");
    expect(altCheck!.status).toBe("pass");
  });

  it("fails image alt check when an <img> with a backtick-quoted attribute is missing its alt", () => {
    const html = "<html lang=\"en\"><body><img class=`hero` src=\"photo.jpg\"></body></html>";
    const issues = runDeterministicChecks(html);
    const altCheck = issues.find((i) => i.criterion === "1.1.1");
    expect(altCheck!.status).toBe("fail");
  });
});

describe("applyAriaRoleHeaderFix – backtick-quoted attribute value", () => {
  it("converts td[role=columnheader] to <th scope=col> when td has a backtick-quoted attribute value", () => {
    const html = "<table><tr><td role=\"columnheader\" data-info=`a b`>Header</td></tr></table>";
    const result = applyAriaRoleHeaderFix(html);
    expect(result).toContain("<th scope=\"col\"");
    expect(result).not.toContain("role=\"columnheader\"");
  });
});

describe("applyAriaLinkRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=link] to <a> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"link\" title=`click here` tabindex=\"0\">Go</div>";
    const result = applyAriaLinkRoleFix(html);
    expect(result).toContain("<a ");
    expect(result).not.toContain("role=\"link\"");
    expect(result).toContain("Go");
  });
});

describe("applyAriaListRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=list] to <ul> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"list\" data-label=`items`><li>A</li></div>";
    const result = applyAriaListRoleFix(html);
    expect(result).toContain("<ul");
    expect(result).not.toContain("role=\"list\"");
    expect(result).toContain("<li>A</li>");
  });
});

describe("applyAriaListitemRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=listitem] to <li> when an attribute value is backtick-quoted", () => {
    const html = "<ul><div role=\"listitem\" data-label=`item 1`>Entry</div></ul>";
    const result = applyAriaListitemRoleFix(html);
    expect(result).toContain("<li");
    expect(result).not.toContain("role=\"listitem\"");
    expect(result).toContain("Entry");
  });
});

describe("replaceAriaRoleElements (via applyAriaComboboxRoleFix) – backtick-quoted attribute value", () => {
  it("converts div[role=combobox] to <select> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"combobox\" data-label=`opt`><option>A</option></div>";
    const result = applyAriaComboboxRoleFix(html);
    expect(result).toContain("<select");
    expect(result).not.toContain("role=\"combobox\"");
    expect(result).toContain("<option>A</option>");
  });
});

describe("applyAriaButtonRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=button] to <button> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"button\" data-label=`action`>Click me</div>";
    const result = applyAriaButtonRoleFix(html);
    expect(result).toContain("<button");
    expect(result).not.toContain("role=\"button\"");
    expect(result).toContain("Click me");
  });
});

describe("applyAriaCheckboxRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=checkbox] to <input type=checkbox> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"checkbox\" data-label=`opt`>Accept</div>";
    const result = applyAriaCheckboxRoleFix(html);
    expect(result).toContain('<input type="checkbox"');
    expect(result).not.toContain("role=\"checkbox\"");
    expect(result).toContain("Accept");
  });
});

describe("applyAriaRadioRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=radio] to <input type=radio> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"radio\" data-label=`choice`>Option</div>";
    const result = applyAriaRadioRoleFix(html);
    expect(result).toContain('<input type="radio"');
    expect(result).not.toContain("role=\"radio\"");
    expect(result).toContain("Option");
  });
});

describe("applyAriaGridRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=grid] to <table> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"grid\" data-label=`grid`><tr><td>Cell</td></tr></div>";
    const result = applyAriaGridRoleFix(html);
    expect(result).toContain("<table");
    expect(result).not.toContain("role=\"grid\"");
    expect(result).toContain("<td>Cell</td>");
  });
});

describe("applyAriaTabRoleFix – backtick-quoted attribute value", () => {
  it("converts div[role=tab] to <button> when an attribute value is backtick-quoted", () => {
    const html = "<div role=\"tab\" data-label=`tab1`>Tab One</div>";
    const result = applyAriaTabRoleFix(html);
    expect(result).toContain("<button");
    expect(result).not.toContain("role=\"tab\"");
    expect(result).toContain("Tab One");
  });
});
