import { describe, it, expect } from "vitest";
import { checkAccessibility } from "./accessibility-checks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const issueTypes = (content: string) =>
  checkAccessibility(content).map((i) => i.type);

const fixTypes = (content: string) =>
  checkAccessibility(content).map((i) => i.fixType).filter(Boolean);

const hasIssue = (content: string, fixType: string) =>
  checkAccessibility(content).some((i) => i.fixType === fixType);

const hasStructureIssue = (content: string, msgPart: string) =>
  checkAccessibility(content).some(
    (i) => i.type === "structure" && i.message.includes(msgPart),
  );

// ---------------------------------------------------------------------------
// 1. Heading presence — long content with no headings
// ---------------------------------------------------------------------------

describe("heading presence check", () => {
  it("detects missing headings in content longer than 500 characters", () => {
    const longContent = "This is a sentence without any headings. ".repeat(20);
    expect(longContent.length).toBeGreaterThan(500);

    const issues = checkAccessibility(longContent);
    const issue = issues.find(
      (i) =>
        i.type === "structure" &&
        i.message.includes("clear section headings"),
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("suggestion");
  });

  it("does not flag short content that lacks headings", () => {
    const shortContent = "No headings here.";
    expect(shortContent.length).toBeLessThanOrEqual(500);

    const issues = checkAccessibility(shortContent);
    expect(
      issues.some((i) => i.message.includes("clear section headings")),
    ).toBe(false);
  });

  it("does not flag long content that has markdown headings", () => {
    const content =
      "## Overview\n" + "Some paragraph content. ".repeat(30);
    const issues = checkAccessibility(content);
    expect(
      issues.some((i) => i.message.includes("clear section headings")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Long paragraphs
// ---------------------------------------------------------------------------

describe("long paragraph check", () => {
  it("detects paragraphs longer than 800 characters", () => {
    const longParagraph = "word ".repeat(200);
    expect(longParagraph.length).toBeGreaterThan(800);

    const issues = checkAccessibility(longParagraph);
    const issue = issues.find((i) => i.message.includes("too long"));
    expect(issue).toBeDefined();
    expect(issue?.type).toBe("readability");
    expect(issue?.severity).toBe("suggestion");
  });

  it("does not flag paragraphs that are 800 characters or shorter", () => {
    const shortParagraph = "word ".repeat(50);
    expect(shortParagraph.length).toBeLessThanOrEqual(800);

    const issues = checkAccessibility(shortParagraph);
    expect(issues.some((i) => i.message.includes("too long"))).toBe(false);
  });

  it("does not flag long table rows (pipe-separated content) as long paragraphs", () => {
    // Tables can be wide but should not be treated as long paragraphs
    const tableContent = "| " + "cell content | ".repeat(60);
    expect(tableContent.length).toBeGreaterThan(800);
    expect(tableContent.includes("|")).toBe(true);

    const issues = checkAccessibility(tableContent);
    expect(issues.some((i) => i.message.includes("too long"))).toBe(false);
  });

  it("reports the correct count of long paragraphs", () => {
    const longPara = "word ".repeat(200);
    const content = longPara + "\n\n" + longPara;

    const issues = checkAccessibility(content);
    const issue = issues.find((i) => i.message.includes("too long"));
    expect(issue?.message).toContain("2 paragraph(s)");
  });
});

// ---------------------------------------------------------------------------
// 3. Vague link text
// ---------------------------------------------------------------------------

describe("vague link text check", () => {
  const VAGUE_TERMS = [
    "click here",
    "here",
    "link",
    "read more",
    "learn more",
    "go here",
    "this page",
    "more info",
    "more",
    "click",
    "this link",
    "this article",
    "this resource",
    "view here",
    "find out more",
    "see here",
    "details",
    "info",
  ];

  for (const term of VAGUE_TERMS) {
    it(`detects vague link text: [${term}]`, () => {
      const content = `Visit [${term}] for details.`;
      expect(hasIssue(content, "fix-vague-link-text")).toBe(true);
    });
  }

  it("does not flag descriptive link text", () => {
    const content =
      "See the [BSU Academic Calendar] for semester dates.";
    expect(hasIssue(content, "fix-vague-link-text")).toBe(false);
  });

  it("detects vague link text case-insensitively", () => {
    const upper = "Please [CLICK HERE] to continue.";
    const mixed = "Please [Click Here] to continue.";
    expect(hasIssue(upper, "fix-vague-link-text")).toBe(true);
    expect(hasIssue(mixed, "fix-vague-link-text")).toBe(true);
  });

  it("reports severity as warning", () => {
    const content = "[click here] for more.";
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-vague-link-text",
    );
    expect(issue?.severity).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// 4. Color-only information
// ---------------------------------------------------------------------------

describe("color-only information check", () => {
  const COLOR_WORDS = ["red", "green", "blue", "yellow", "orange", "purple"];
  const OBJECT_WORDS = [
    "text",
    "items",
    "item",
    "sections",
    "section",
    "parts",
    "part",
  ];

  for (const color of COLOR_WORDS) {
    it(`detects color-only phrasing: "${color} items"`, () => {
      const content = `The ${color} items are required.`;
      const issues = checkAccessibility(content);
      const issue = issues.find((i) =>
        i.message.includes("color alone"),
      );
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("warning");
    });
  }

  it("does not flag plain color mentions not paired with a section/item noun", () => {
    const content = "The sky is blue and the grass is green.";
    const issues = checkAccessibility(content);
    expect(issues.some((i) => i.message.includes("color alone"))).toBe(false);
  });

  it("detects pattern case-insensitively", () => {
    const content = "Refer to the RED SECTIONS for warnings.";
    const issues = checkAccessibility(content);
    expect(issues.some((i) => i.message.includes("color alone"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Excessive ALL CAPS
// ---------------------------------------------------------------------------

describe("ALL CAPS check", () => {
  it("detects more than 3 occurrences of 10+ consecutive uppercase letters", () => {
    // Four distinct all-caps words of at least 10 letters
    const content =
      "ABCDEFGHIJ KLMNOPQRST UVWXYZABCD EFGHIJKLMN something normal";
    const matches = content.match(/\b[A-Z]{10,}\b/g) ?? [];
    expect(matches.length).toBeGreaterThan(3);

    const issues = checkAccessibility(content);
    const issue = issues.find((i) => i.message.includes("ALL CAPS"));
    expect(issue).toBeDefined();
    expect(issue?.type).toBe("readability");
    expect(issue?.fixType).toBe("fix-all-caps");
  });

  it("does not flag content with 3 or fewer all-caps words", () => {
    const content = "ABCDEFGHIJ KLMNOPQRST UVWXYZABCD some normal text";
    const matches = content.match(/\b[A-Z]{10,}\b/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(3);

    const issues = checkAccessibility(content);
    expect(issues.some((i) => i.fixType === "fix-all-caps")).toBe(false);
  });

  it("does not count short uppercase words (fewer than 10 letters)", () => {
    // Acronyms like "USA", "HTML", "ADA" — all under 10 chars — should not count
    const content = "USA HTML ADA WCAG PDF API IT IS OK NO".repeat(5);
    const issues = checkAccessibility(content);
    expect(issues.some((i) => i.fixType === "fix-all-caps")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Heading level skip
// ---------------------------------------------------------------------------

describe("heading level skip check", () => {
  it("detects h1 → h3 (skipping h2)", () => {
    const content = "# Title\n\n### Section\n\nSome content.";
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-heading-skip",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("h1");
    expect(issue?.message).toContain("h3");
  });

  it("detects h2 → h4 (skipping h3)", () => {
    const content = "## Overview\n\n#### Details\n\nContent here.";
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-heading-skip",
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("h2");
    expect(issue?.message).toContain("h4");
  });

  it("does not flag sequential heading levels (h1 → h2 → h3)", () => {
    const content = "# Title\n\n## Section\n\n### Subsection\n\nContent.";
    expect(hasIssue(content, "fix-heading-skip")).toBe(false);
  });

  it("does not flag a single heading (no previous level to compare)", () => {
    const content = "## Only Heading\n\nSome content here.";
    expect(hasIssue(content, "fix-heading-skip")).toBe(false);
  });

  it("does not flag heading levels that step back up (h3 → h2 is valid)", () => {
    const content =
      "# Title\n\n## Section A\n\n### Subsection\n\n## Section B\n\nContent.";
    expect(hasIssue(content, "fix-heading-skip")).toBe(false);
  });

  it("fix message names the missing intermediate heading level", () => {
    const content = "# Title\n\n### Jump\n\nContent.";
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-heading-skip",
    );
    expect(issue?.fix).toContain("h2");
  });
});

// ---------------------------------------------------------------------------
// 7. Markdown pipe tables
// ---------------------------------------------------------------------------

describe("markdown pipe table check", () => {
  it("detects a markdown pipe table", () => {
    const content =
      "| Column A | Column B |\n| --- | --- |\n| Value 1 | Value 2 |";
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "convert-markdown-tables",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("does not flag plain text lines that contain pipes but are not tables", () => {
    const content = "Use the A|B syntax for inline notation.";
    expect(hasIssue(content, "convert-markdown-tables")).toBe(false);
  });

  it("does not flag HTML <table> elements", () => {
    const content =
      "<table><caption>Data</caption><thead><tr><th scope=\"col\">Name</th></tr></thead><tbody><tr><td>Alice</td></tr></tbody></table>";
    expect(hasIssue(content, "convert-markdown-tables")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. HTML table — missing <caption>
// ---------------------------------------------------------------------------

describe("HTML table caption check", () => {
  it("detects an HTML table without <caption>", () => {
    const content =
      "<table><thead><tr><th scope=\"col\">Name</th></tr></thead><tbody><tr><td>Alice</td></tr></tbody></table>";
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-html-table-caption",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("does not flag an HTML table that includes <caption>", () => {
    const content =
      "<table><caption>Student Grades</caption><thead><tr><th scope=\"col\">Name</th></tr></thead><tbody><tr><td>Alice</td></tr></tbody></table>";
    expect(hasIssue(content, "fix-html-table-caption")).toBe(false);
  });

  it("reports only one missing-caption issue even when multiple tables are missing captions", () => {
    const table =
      "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>";
    const content = table + "\n\n" + table;
    const issues = checkAccessibility(content).filter(
      (i) => i.fixType === "fix-html-table-caption",
    );
    expect(issues).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. HTML table — missing <thead>
// ---------------------------------------------------------------------------

describe("HTML table thead check", () => {
  it("detects an HTML table without <thead>", () => {
    const content =
      "<table><caption>Data</caption><tbody><tr><td>Alice</td></tr></tbody></table>";
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-html-table-thead",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("does not flag an HTML table that includes <thead>", () => {
    const content =
      "<table><caption>Data</caption><thead><tr><th scope=\"col\">Name</th></tr></thead><tbody><tr><td>Alice</td></tr></tbody></table>";
    expect(hasIssue(content, "fix-html-table-thead")).toBe(false);
  });

  it("reports only one missing-thead issue even when multiple tables lack <thead>", () => {
    const table =
      "<table><caption>T</caption><tbody><tr><td>D</td></tr></tbody></table>";
    const content = table + "\n\n" + table;
    const issues = checkAccessibility(content).filter(
      (i) => i.fixType === "fix-html-table-thead",
    );
    expect(issues).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 10. ARIA role="combobox" on non-native element
// ---------------------------------------------------------------------------

describe('ARIA role="combobox" check', () => {
  it("detects combobox role on a non-native element (div)", () => {
    const content = '<div role="combobox">options</div>';
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-aria-combobox",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("does not flag combobox role on a native <input> element", () => {
    const content = '<input role="combobox" type="text" />';
    expect(hasIssue(content, "fix-aria-combobox")).toBe(false);
  });

  it("does not flag combobox role on a native <select> element", () => {
    const content = '<select role="combobox"><option>A</option></select>';
    expect(hasIssue(content, "fix-aria-combobox")).toBe(false);
  });

  it("does not flag content without any combobox role", () => {
    const content = "<div>Just a plain div with no ARIA roles.</div>";
    expect(hasIssue(content, "fix-aria-combobox")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. ARIA role="grid" on non-table element
// ---------------------------------------------------------------------------

describe('ARIA role="grid" check', () => {
  it("detects grid role on a non-native element (div)", () => {
    const content = '<div role="grid">cells</div>';
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-aria-grid",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("does not flag grid role on a native <table> element", () => {
    const content =
      '<table role="grid"><tbody><tr><td>Cell</td></tr></tbody></table>';
    expect(hasIssue(content, "fix-aria-grid")).toBe(false);
  });

  it("does not flag content without any grid role", () => {
    const content = "<div>No ARIA roles here.</div>";
    expect(hasIssue(content, "fix-aria-grid")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. ARIA role="tab" on non-interactive element
// ---------------------------------------------------------------------------

describe('ARIA role="tab" check', () => {
  it("detects tab role on a non-interactive element (span)", () => {
    const content = '<span role="tab">Tab label</span>';
    const issue = checkAccessibility(content).find(
      (i) => i.fixType === "fix-aria-tab",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("does not flag tab role on a native <button> element", () => {
    const content = '<button role="tab">Tab label</button>';
    expect(hasIssue(content, "fix-aria-tab")).toBe(false);
  });

  it("does not flag tab role on a native <a> element", () => {
    const content = '<a role="tab" href="#">Tab label</a>';
    expect(hasIssue(content, "fix-aria-tab")).toBe(false);
  });

  it("does not flag content without any tab role", () => {
    const content = "<button>Normal button</button>";
    expect(hasIssue(content, "fix-aria-tab")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. Clean content — no false positives
// ---------------------------------------------------------------------------

describe("clean, well-structured content produces no issues", () => {
  it("returns an empty array for fully compliant content", () => {
    const content = `# Course Overview

## Learning Objectives

By the end of this module, students will be able to:
- Identify key concepts in accessible design
- Apply WCAG 2.1 AA guidelines to real content

## Assignment Instructions

Complete the reading and submit a reflection. See the
[BSU Submission Portal](https://bsu.example.edu/submit) for details.

<table>
<caption>Grading Breakdown</caption>
<thead>
<tr><th scope="col">Component</th><th scope="col">Points</th></tr>
</thead>
<tbody>
<tr><td>Reflection</td><td>50</td></tr>
<tr><td>Participation</td><td>50</td></tr>
</tbody>
</table>
`;
    const issues = checkAccessibility(content);
    expect(issues).toHaveLength(0);
  });
});
