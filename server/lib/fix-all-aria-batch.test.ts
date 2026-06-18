import { describe, it, expect } from "vitest";
import {
  fixAllAriaRoleMisuse,
  buildComplianceReport,
} from "./accessibility-engine";
import type { ComplianceIssue, ComplianceReport } from "./accessibility-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<ComplianceIssue>): ComplianceIssue {
  return {
    criterion: "1.3.1",
    title: "ARIA Role Misuse",
    level: "A",
    status: "fail",
    description: "Element uses an incorrect ARIA role.",
    details: "This element has a role attribute that is misused.",
    ...overrides,
  };
}

/** Count issues that would trigger the "Fix all ARIA" button in the UI.
 *
 * The button renders when:
 *   report.issues.filter(i =>
 *     i.title.includes("ARIA") && (i.status === "fail" || i.status === "warning")
 *   ).length >= 2
 */
function countActiveAriaIssues(report: ComplianceReport): number {
  return report.issues.filter(
    (i) => i.title.includes("ARIA") && (i.status === "fail" || i.status === "warning")
  ).length;
}

// ---------------------------------------------------------------------------
// HTML with multiple fixable ARIA role patterns
// ---------------------------------------------------------------------------

const HTML_WITH_ARIA_ISSUES = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Document</title></head>
<body>
  <main>
    <h1>Test Document</h1>
    <p>This document contains several ARIA role misuse patterns.</p>
    <div role="link" tabindex="0">Go to section</div>
    <div role="list"><li>Item one</li><li>Item two</li></div>
    <div role="listitem">Standalone list item</div>
  </main>
</body>
</html>`;

// ---------------------------------------------------------------------------
// End-to-end scenario: "Fix all ARIA role misuse" batch fix button
// ---------------------------------------------------------------------------

describe("Fix all ARIA role misuse – end-to-end button scenario", () => {
  it("button appears when there are 2 or more active ARIA issues", () => {
    const report = buildComplianceReport([
      makeIssue({ title: "ARIA Link Role on Non-Anchor Element", status: "fail" }),
      makeIssue({ title: "ARIA List Role on Non-List Element", status: "warning" }),
    ]);

    expect(countActiveAriaIssues(report)).toBeGreaterThanOrEqual(2);
  });

  it("button does not appear when fewer than 2 ARIA issues are active", () => {
    const report = buildComplianceReport([
      makeIssue({ title: "ARIA Link Role on Non-Anchor Element", status: "fail" }),
    ]);

    expect(countActiveAriaIssues(report)).toBeLessThan(2);
  });

  it("after calling fixAllAriaRoleMisuse all ARIA issues are marked fixed", () => {
    const issues: ComplianceIssue[] = [
      makeIssue({ title: "ARIA Link Role on Non-Anchor Element", criterion: "4.1.2", status: "fail" }),
      makeIssue({ title: "ARIA List Role on Non-List Element", criterion: "1.3.1", status: "warning" }),
      makeIssue({ title: "ARIA Listitem Role on Non-Listitem Element", criterion: "1.3.1", status: "fail" }),
    ];
    const report = buildComplianceReport(issues);

    const result = fixAllAriaRoleMisuse(HTML_WITH_ARIA_ISSUES, report);

    const ariaIssuesAfter = result.complianceReport.issues.filter((i) =>
      i.title.includes("ARIA")
    );
    for (const issue of ariaIssuesAfter) {
      expect(issue.status).toBe("fixed");
    }
  });

  it("after calling fixAllAriaRoleMisuse the active ARIA issue count drops below 2 (button disappears)", () => {
    const issues: ComplianceIssue[] = [
      makeIssue({ title: "ARIA Link Role on Non-Anchor Element", criterion: "4.1.2", status: "fail" }),
      makeIssue({ title: "ARIA List Role on Non-List Element", criterion: "1.3.1", status: "warning" }),
    ];
    const report = buildComplianceReport(issues);

    expect(countActiveAriaIssues(report)).toBeGreaterThanOrEqual(2);

    const result = fixAllAriaRoleMisuse(HTML_WITH_ARIA_ISSUES, report);

    expect(countActiveAriaIssues(result.complianceReport)).toBeLessThan(2);
  });

  it("non-ARIA issues that are not resolved by ARIA fixers remain unchanged", () => {
    // Use a custom criterion that the deterministic checker does not produce,
    // so it stays unresolved after the ARIA fixers run.
    const nonAriaIssue = makeIssue({
      criterion: "2.1.1",
      title: "Keyboard Accessible: no keyboard trap",
      status: "fail",
    });
    const ariaIssue1 = makeIssue({ title: "ARIA Link Role on Non-Anchor Element", criterion: "4.1.2", status: "fail" });
    const ariaIssue2 = makeIssue({ title: "ARIA List Role on Non-List Element", criterion: "1.3.1", status: "warning" });
    const report = buildComplianceReport([nonAriaIssue, ariaIssue1, ariaIssue2]);

    const result = fixAllAriaRoleMisuse(HTML_WITH_ARIA_ISSUES, report);

    const keyboardIssue = result.complianceReport.issues.find(
      (i) => i.title === "Keyboard Accessible: no keyboard trap"
    );
    expect(keyboardIssue).toBeDefined();
    expect(keyboardIssue!.status).toBe("fail");
  });

  it("button disappears after fixing 3 ARIA issues across multiple role types", () => {
    const html = `<!DOCTYPE html>
<html lang="en"><head><title>T</title></head>
<body><main>
  <h1>Doc</h1>
  <div role="combobox"><option>A</option></div>
  <div role="grid"><tr><td>Cell</td></tr></div>
  <div role="tab">Tab One</div>
</main></body></html>`;

    const issues: ComplianceIssue[] = [
      makeIssue({ title: "ARIA Combobox Role on Non-Combobox Element", criterion: "1.3.1", status: "fail" }),
      makeIssue({ title: "ARIA Grid Role on Non-Table Element", criterion: "1.3.1", status: "fail" }),
      makeIssue({ title: "ARIA Tab Role on Non-Interactive Element", criterion: "1.3.1", status: "warning" }),
    ];
    const report = buildComplianceReport(issues);

    expect(countActiveAriaIssues(report)).toBe(3);

    const result = fixAllAriaRoleMisuse(html, report);

    expect(countActiveAriaIssues(result.complianceReport)).toBeLessThan(2);
    const allAriaIssues = result.complianceReport.issues.filter((i) => i.title.includes("ARIA"));
    for (const issue of allAriaIssues) {
      expect(issue.status).toBe("fixed");
    }
  });

  it("already-fixed ARIA issues are not double-counted or reverted", () => {
    const issues: ComplianceIssue[] = [
      makeIssue({ title: "ARIA Link Role on Non-Anchor Element", criterion: "4.1.2", status: "fixed" }),
      makeIssue({ title: "ARIA List Role on Non-List Element", criterion: "1.3.1", status: "fail" }),
      makeIssue({ title: "ARIA Listitem Role on Non-Listitem Element", criterion: "1.3.1", status: "warning" }),
    ];
    const report = buildComplianceReport(issues);

    const result = fixAllAriaRoleMisuse(HTML_WITH_ARIA_ISSUES, report);

    const linkIssue = result.complianceReport.issues.find(
      (i) => i.title === "ARIA Link Role on Non-Anchor Element"
    );
    expect(linkIssue).toBeDefined();
    expect(linkIssue!.status).toBe("fixed");
  });
});
