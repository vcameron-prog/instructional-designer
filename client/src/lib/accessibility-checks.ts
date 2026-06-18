export interface AccessibilityIssue {
  type: string;
  severity: "warning" | "suggestion";
  message: string;
  fix: string;
  fixType?: string;
}

export const checkAccessibility = (content: string): AccessibilityIssue[] => {
  const issues: AccessibilityIssue[] = [];

  const headingMatches = content.match(/^#{1,6}\s|^[A-Z][A-Z\s]{5,}$/gm) || [];
  if (headingMatches.length === 0 && content.length > 500) {
    issues.push({
      type: "structure",
      severity: "suggestion",
      message: "Consider adding clear section headings to improve navigation",
      fix: 'Add headings like "## Overview" or "## Learning Objectives" to organize content',
    });
  }

  const paragraphs = content.split(/\n\n+/);
  const longParagraphs = paragraphs.filter(p => p.length > 800 && !p.includes("|"));
  if (longParagraphs.length > 0) {
    issues.push({
      type: "readability",
      severity: "suggestion",
      message: `${longParagraphs.length} paragraph(s) may be too long for easy reading`,
      fix: "Break long paragraphs into smaller chunks of 3-4 sentences each",
    });
  }

  if (content.match(/\[(click here|here|link|read more|learn more|go here|this page|more info|more|click|this link|this article|this resource|view here|find out more|see here|details|info)\]/gi)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'Avoid vague link text like "click here", "read more", or "learn more"',
      fix: "Use descriptive link text that explains the destination (e.g., [BSU Academic Calendar])",
      fixType: "fix-vague-link-text",
    });
  }

  if (content.match(/\b(red|green|blue|yellow|orange|purple)\s+(text|items?|sections?|parts?)\b/gi)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: "Information may rely on color alone to convey meaning",
      fix: "Use additional indicators like icons, labels, or patterns alongside color",
    });
  }

  const allCapsMatches = content.match(/\b[A-Z]{10,}\b/g) || [];
  if (allCapsMatches.length > 3) {
    issues.push({
      type: "readability",
      severity: "suggestion",
      message: "Excessive use of ALL CAPS text can reduce readability",
      fix: "Use bold or heading styles instead of all caps for emphasis",
      fixType: "fix-all-caps",
    });
  }

  // Check for heading level skips (e.g., h1 → h3 without h2)
  const headingLevelMatches = [...content.matchAll(/^(#{1,6})\s/gm)];
  if (headingLevelMatches.length > 1) {
    let prevLevel = headingLevelMatches[0][1].length;
    for (let h = 1; h < headingLevelMatches.length; h++) {
      const currentLevel = headingLevelMatches[h][1].length;
      if (currentLevel > prevLevel + 1) {
        issues.push({
          type: "structure",
          severity: "warning",
          message: `Heading level skipped: h${prevLevel} jumps to h${currentLevel} — screen readers may lose context`,
          fix: `Add an h${prevLevel + 1} heading between the h${prevLevel} and h${currentLevel} headings to maintain a logical hierarchy`,
          fixType: "fix-heading-skip",
        });
        break;
      }
      prevLevel = currentLevel;
    }
  }

  // Check for residual markdown tables that were not converted
  if (/^\|[\s\S]*?\|[\s\S]*?\n\|[\s\-:|]+\|/m.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: "Markdown pipe table detected — may not be accessible to screen readers",
      fix: "Replace markdown tables (| col | col |) with HTML <table> elements that include <caption> and <th scope> attributes",
      fixType: "convert-markdown-tables",
    });
  }

  // Check for HTML tables missing <caption> or <thead>
  const tableMatches = [...content.matchAll(/<table[\s>]/gi)];
  let reportedMissingCaption = false;
  let reportedMissingThead = false;
  for (const tableMatch of tableMatches) {
    const tableStart = tableMatch.index ?? 0;
    // Find the closing </table> tag to scope the check to this table only
    const tableEnd = content.indexOf("</table>", tableStart);
    const tableBlock = tableEnd > tableStart
      ? content.slice(tableStart, tableEnd + 8)
      : content.slice(tableStart, tableStart + 600);

    if (!reportedMissingCaption && !/<caption[\s>]/i.test(tableBlock)) {
      issues.push({
        type: "accessibility",
        severity: "warning",
        message: "HTML table found without a <caption> element",
        fix: "Add a <caption> element immediately after <table> to describe the table's purpose for screen reader users",
        fixType: "fix-html-table-caption",
      });
      reportedMissingCaption = true;
    }

    if (!reportedMissingThead && !/<thead[\s>]/i.test(tableBlock)) {
      issues.push({
        type: "accessibility",
        severity: "warning",
        message: "HTML table found without a <thead> element",
        fix: "Add a <thead> with <th scope=\"col\"> for each column so screen readers can identify column headers",
        fixType: "fix-html-table-thead",
      });
      reportedMissingThead = true;
    }

    if (reportedMissingCaption && reportedMissingThead) break;
  }

  // Check for ARIA role misuse on non-native elements
  if (/role\s*=\s*["']?combobox["']?/i.test(content) && !/<(select|input)[^>]*role\s*=\s*["']?combobox/i.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'ARIA role="combobox" found on a non-native element',
      fix: 'Replace non-input elements that use role="combobox" with a native <select> or <input> element for proper keyboard and screen reader support',
      fixType: "fix-aria-combobox",
    });
  }

  if (/role\s*=\s*["']?grid["']?/i.test(content) && !/<table[^>]*role\s*=\s*["']?grid/i.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'ARIA role="grid" found on a non-table element',
      fix: 'Replace non-table elements that use role="grid" with a native <table> element so screen readers can announce rows and columns correctly',
      fixType: "fix-aria-grid",
    });
  }

  if (/role\s*=\s*["']?tab["']?/i.test(content) && !/<(button|a)[^>]*role\s*=\s*["']?tab/i.test(content)) {
    issues.push({
      type: "accessibility",
      severity: "warning",
      message: 'ARIA role="tab" found on a non-interactive element',
      fix: 'Replace non-interactive elements that use role="tab" with a native <button> or <a> element for full keyboard accessibility',
      fixType: "fix-aria-tab",
    });
  }

  return issues;
};
