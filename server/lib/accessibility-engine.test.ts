import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import {
  runDeterministicChecks,
  buildComplianceReport,
  evaluateOriginalDocument,
  fixComplianceIssue,
  applyAriaRoleHeaderFix,
  applyDeterministicReport,
  applyAriaLinkRoleFix,
  applyAriaCheckboxRoleFix,
  applyAriaRadioRoleFix,
  applyAriaListRoleFix,
  applyAriaListitemRoleFix,
  applyLangAttributeFix,
  applyPageTitleFix,
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  checkHeadingOrder,
  ensureAltText,
  injectImageData,
  ensureMissingImages,
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
      expect(altCheck!.details).toContain("No images");
    });

    it("passes when all images have alt attributes", () => {
      const html = `<html lang="en"><body><img src="photo.jpg" alt="A photo of a cat"></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("pass");
    });

    it("fails when an image is missing its alt attribute", () => {
      const html = `<html lang="en"><body><img src="photo.jpg"></body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
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
      expect(markupIssue!.details).toContain("1 table(s)");
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
      expect(ariaIssue!.details).toContain("1 table(s)");
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
  });

  it("warns when heading levels are skipped", () => {
    const html = `<html lang="en"><body><h1>Title</h1><h3>Jumped</h3></body></html>`;
    const issues = runDeterministicChecks(html);
    const orderIssue = issues.find(
      (i) => i.criterion === "1.3.1" && i.title === "Heading Order"
    );
    expect(orderIssue!.status).toBe("warning");
    expect(orderIssue!.details).toContain("h1 → h3");
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
    expect(orderIssue!.details).toContain("h3 → h5");
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

  it("keeps a single quote in the filename literally inside a double-quoted alt attribute without breaking HTML", () => {
    const html = `<img src="o'clock.png">`;
    const result = ensureAltText(html, []);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    const altValue = altMatch![1];
    expect(altValue).toContain("o'clock");
    expect(result).not.toMatch(/alt="[^"]*"[^"]*"/);
  });

  it("keeps a single quote in a data URI image name literally inside a double-quoted alt attribute", () => {
    const img = makeImage("o'clock.png", "data:image/png;base64,clockdata");
    const html = `<img src="${img.dataUrl}">`;
    const result = ensureAltText(html, [img]);
    const altMatch = result.match(/alt="([^"]*)"/);
    expect(altMatch).not.toBeNull();
    const altValue = altMatch![1];
    expect(altValue).toContain("o'clock");
    expect(result).not.toMatch(/alt="[^"]*"[^"]*"/);
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

  it("throws when the AI returns output that does not start with <!DOCTYPE html>", async () => {
    const issues = runDeterministicChecks(fixtureHtml);
    const headingIssue = issues.find((i) => i.criterion === "2.4.6")!;

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
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body><main><h1>Hello</h1></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const langIssue = issues.find((i) => i.criterion === "3.1.1")!;
    expect(langIssue.status).toBe("fail");

    const fixedHtml = html.replace("<html>", '<html lang="en">');
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: `<!DOCTYPE html>\n${fixedHtml}` }],
    });

    const report = makeReport(issues);
    await fixComplianceIssue(html, langIssue, issues.indexOf(langIssue), report);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the deterministic fixer when the key is not registered", async () => {
    const html = `<!DOCTYPE html><html lang="en"><head></head><body><main><h1>Hello</h1></main></body></html>`;
    const issues = runDeterministicChecks(html);
    const titleIssue = issues.find((i) => i.criterion === "2.4.2")!;
    expect(titleIssue.status).toBe("fail");

    const fixedHtml = `<!DOCTYPE html><html lang="en"><head><title>My Page</title></head><body><main><h1>Hello</h1></main></body></html>`;
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: fixedHtml }],
    });

    const report = makeReport(issues);
    const result = await fixComplianceIssue(html, titleIssue, issues.indexOf(titleIssue), report);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.accessibleHtml).toContain("<title>My Page</title>");
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
});
