import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import {
  runDeterministicChecks,
  buildComplianceReport,
  evaluateOriginalDocument,
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  checkHeadingOrder,
  ensureAltText,
  injectImageData,
  ensureMissingImages,
  type ComplianceIssue,
} from "./accessibility-engine.js";
import type { ExtractedImage } from "./pdf-processor.js";

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

    it("fails when some images are missing alt and reports the count", () => {
      const html = `<html lang="en"><body>
        <img src="a.jpg" alt="Image A">
        <img src="b.jpg">
        <img src="c.jpg">
      </body></html>`;
      const issues = runDeterministicChecks(html);
      const altCheck = issues.find((i) => i.criterion === "1.1.1");
      expect(altCheck!.status).toBe("fail");
      expect(altCheck!.details).toContain("2 of 3");
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

  it("returns exactly 9 issues total", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    expect(issues.length).toBe(9);
  });

  it("fails table headers check (1.3.1 Table Headers) — second table has no <th>", () => {
    const html = loadFixture("healthcare-brochure.html");
    const issues = runDeterministicChecks(html);
    const tableIssue = issues.find((i) => i.criterion === "1.3.1" && i.title === "Table Headers");
    expect(tableIssue).toBeDefined();
    expect(tableIssue!.status).toBe("fail");
  });

  it("evaluateOriginalDocument reports exact counts: 6 pass, 2 fail, 1 warning, score 67", () => {
    const html = loadFixture("healthcare-brochure.html");
    const report = evaluateOriginalDocument(html);
    expect(report.totalIssues).toBe(9);
    expect(report.passCount).toBe(6);
    expect(report.failCount).toBe(2);
    expect(report.warningCount).toBe(1);
    expect(report.overallScore).toBe(67);
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

  it("returns exactly 9 issues total", () => {
    const html = loadFixture("government-form.html");
    const issues = runDeterministicChecks(html);
    expect(issues.length).toBe(9);
  });

  it("evaluateOriginalDocument reports exact counts: 1 pass, 5 fail, 3 warning, score 11", () => {
    const html = loadFixture("government-form.html");
    const report = evaluateOriginalDocument(html);
    expect(report.totalIssues).toBe(9);
    expect(report.passCount).toBe(1);
    expect(report.failCount).toBe(5);
    expect(report.warningCount).toBe(3);
    expect(report.overallScore).toBe(11);
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
});

// ---------------------------------------------------------------------------
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
});
