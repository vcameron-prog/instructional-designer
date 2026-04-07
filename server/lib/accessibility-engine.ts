import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ExtractedImage, ExtractedTable } from "./pdf-processor";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const complianceIssueSchema = z.object({
  criterion: z.string(),
  title: z.string(),
  level: z.enum(["A", "AA", "AAA"]),
  status: z.enum(["pass", "fail", "fixed", "warning", "accepted"]),
  description: z.string(),
  details: z.string(),
  justification: z.string().optional(),
  previousStatus: z.enum(["fail", "warning"]).optional(),
});

export interface ComplianceIssue {
  criterion: string;
  title: string;
  level: "A" | "AA" | "AAA";
  status: "pass" | "fail" | "fixed" | "warning" | "accepted";
  description: string;
  details: string;
  justification?: string;
  previousStatus?: "fail" | "warning";
}

export const complianceReportSchema = z.object({
  totalIssues: z.number(),
  passCount: z.number(),
  failCount: z.number(),
  fixedCount: z.number(),
  warningCount: z.number(),
  acceptedCount: z.number().default(0),
  overallScore: z.number(),
  issues: z.array(complianceIssueSchema),
});

export interface ComplianceReport {
  totalIssues: number;
  passCount: number;
  failCount: number;
  fixedCount: number;
  warningCount: number;
  acceptedCount: number;
  overallScore: number;
  issues: ComplianceIssue[];
}

export interface AccessibilityResult {
  accessibleHtml: string;
  complianceReport: ComplianceReport;
}

function buildStructuralSummary(
  images: ExtractedImage[],
  tables: ExtractedTable[]
): string {
  const parts: string[] = [];

  if (images.length > 0) {
    parts.push(`\n--- EXTRACTED IMAGES (${images.length} found) ---`);
    for (const img of images.slice(0, 20)) {
      parts.push(
        `Image "${img.name}" on page ${img.pageNumber}: ${img.width}x${img.height}px`
      );
    }
    parts.push(
      "CRITICAL: You MUST include an <img> tag for EVERY image listed above. " +
      "EVERY <img> MUST have a non-empty alt attribute with meaningful descriptive text. " +
      "IMPORTANT: Set the src attribute to exactly the image name (e.g. src=\"ImageName\"). " +
      "Do NOT skip any images. Do NOT omit alt text."
    );
  }

  if (tables.length > 0) {
    parts.push(`\n--- EXTRACTED TABLES (${tables.length} found) ---`);
    for (let i = 0; i < Math.min(tables.length, 10); i++) {
      const table = tables[i];
      parts.push(`Table on page ${table.pageNumber} (${table.rows.length} rows):`);
      for (const row of table.rows.slice(0, 5)) {
        parts.push(`  | ${row.join(" | ")} |`);
      }
      if (table.rows.length > 5) {
        parts.push(`  ... (${table.rows.length - 5} more rows)`);
      }
    }
    parts.push(
      "For each table above, generate proper HTML <table> with <thead>/<tbody>, <th> with scope attributes, and <caption>."
    );
  }

  return parts.join("\n");
}

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function injectImageData(html: string, images: ExtractedImage[]): string {
  if (images.length === 0) return html;

  const imageMap = new Map<string, string>();
  for (const img of images) {
    imageMap.set(img.name.toLowerCase(), img.dataUrl);
  }

  return html.replace(
    /<img\s([^>]*?)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*?)>/gi,
    (match, before: string, dq: string | undefined, sq: string | undefined, uq: string | undefined, after: string) => {
      const src = dq ?? sq ?? uq ?? "";
      if (src.startsWith("data:")) return match;

      const srcLower = src.toLowerCase();
      const dataUrl = imageMap.get(srcLower);
      if (dataUrl) {
        return `<img ${before}src="${dataUrl}"${after}>`;
      }

      for (const [name, url] of imageMap) {
        if (srcLower.includes(name) || name.includes(srcLower)) {
          return `<img ${before}src="${url}"${after}>`;
        }
      }

      return `<img ${before}src="${TRANSPARENT_PIXEL}"${after}>`;
    }
  );
}

function escapeHtmlAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlText(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ensureAltText(html: string, images: ExtractedImage[]): string {
  const imageMetaMap = new Map<string, ExtractedImage>();
  for (const img of images) {
    imageMetaMap.set(img.dataUrl, img);
  }

  const weakAltPatterns = /^(image|photo|picture|img|icon|graphic|figure|untitled|undefined|null)$/i;
  const altAttrRegex = /(?:^|\s)alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

  return html.replace(
    /<img\s([^>]*)>/gi,
    (_match, attrs: string) => {
      const altMatch = attrs.match(altAttrRegex);
      const existingAlt = altMatch ? (altMatch[1] ?? altMatch[2] ?? "") : null;

      const hasValidAlt = existingAlt !== null
        && existingAlt.trim().length > 0
        && !weakAltPatterns.test(existingAlt.trim());

      if (hasValidAlt) return `<img ${attrs}>`;

      let altText = "Document image";
      const srcMatch = attrs.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const src = srcMatch?.[1] ?? srcMatch?.[2] ?? "";

      if (src && !src.startsWith("data:")) {
        const cleanName = src.replace(/[_-]/g, " ").replace(/\.[^.]+$/, "");
        altText = `Image: ${escapeHtmlAttr(cleanName)}`;
      } else if (src.startsWith("data:")) {
        const meta = imageMetaMap.get(src);
        if (meta) {
          const cleanName = meta.name.replace(/[_-]/g, " ").replace(/\.[^.]+$/, "");
          altText = `Image: ${escapeHtmlAttr(cleanName)} (page ${meta.pageNumber})`;
        }
      }

      const cleanedAttrs = existingAlt !== null
        ? attrs.replace(altAttrRegex, "")
        : attrs;

      return `<img ${cleanedAttrs.trim()} alt="${altText}">`;
    }
  );
}

function ensureMissingImages(html: string, images: ExtractedImage[]): string {
  if (images.length === 0) return html;

  const matchedDataUrls = new Set<string>();
  const matchedNames = new Set<string>();
  const imgTagRegex = /<img\s[^>]*src\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = imgTagRegex.exec(html)) !== null) {
    const src = tagMatch[1] ?? tagMatch[2] ?? "";
    if (src.startsWith("data:")) {
      matchedDataUrls.add(src);
    } else {
      matchedNames.add(src.toLowerCase());
    }
  }

  const missingImages = images.filter(
    (img) => !matchedDataUrls.has(img.dataUrl) && !matchedNames.has(img.name.toLowerCase())
  );

  if (missingImages.length === 0) return html;

  const missingImgTags = missingImages
    .map((img) => {
      const cleanName = img.name.replace(/[_-]/g, " ").replace(/\.[^.]+$/, "");
      const safeAltText = `Image: ${escapeHtmlAttr(cleanName)} (page ${img.pageNumber})`;
      const safeCaptionText = escapeHtmlText(cleanName);
      return `    <figure><img src="${img.dataUrl}" alt="${safeAltText}"><figcaption>${safeCaptionText}</figcaption></figure>`;
    })
    .join("\n");

  const sectionHtml = `\n  <section aria-label="Additional document images">\n    <h2>Additional Images</h2>\n${missingImgTags}\n  </section>`;

  const bodyCloseIdx = html.lastIndexOf("</body>");
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + sectionHtml + "\n" + html.slice(bodyCloseIdx);
  }
  const mainCloseIdx = html.lastIndexOf("</main>");
  if (mainCloseIdx !== -1) {
    return html.slice(0, mainCloseIdx) + sectionHtml + "\n" + html.slice(mainCloseIdx);
  }
  return html + sectionHtml;
}

export function runDeterministicChecks(html: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  const hasLang = /<html[^>]*\slang\s*=/i.test(html);
  issues.push({
    criterion: "3.1.1",
    title: "Language of Page",
    level: "A",
    status: hasLang ? "pass" : "fail",
    description: "The document must specify what language it's written in so screen readers pronounce words correctly.",
    details: hasLang
      ? "The document correctly identifies its language."
      : "The document doesn't specify its language, which means screen readers may mispronounce words.",
  });

  const hasTitle = /<title>[^<]+<\/title>/i.test(html);
  issues.push({
    criterion: "2.4.2",
    title: "Page Titled",
    level: "A",
    status: hasTitle ? "pass" : "fail",
    description: "The document needs a clear title so users know what they're looking at.",
    details: hasTitle
      ? "The document has a descriptive title."
      : "The document is missing a title, making it hard for users to identify.",
  });

  const hasH1 = /<h1[\s>]/i.test(html);
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  issues.push({
    criterion: "2.4.6",
    title: "Headings and Labels",
    level: "AA",
    status: hasH1 ? "pass" : "fail",
    description: "The document needs clear headings to help users navigate and find information.",
    details: hasH1
      ? `The document has ${h1Count} main heading(s) providing clear structure.`
      : "The document is missing a main heading, making it harder to navigate.",
  });

  const hasLandmarks =
    /<main[\s>]/i.test(html) ||
    /role\s*=\s*["']main["']/i.test(html);
  issues.push({
    criterion: "2.4.1",
    title: "Bypass Blocks",
    level: "A",
    status: hasLandmarks ? "pass" : "warning",
    description: "The document should have clear sections so users can skip to the content they need.",
    details: hasLandmarks
      ? "The document is organized into clear, labeled sections."
      : "The document could be better organized into labeled sections for easier navigation.",
  });

  const imgTags = html.match(/<img\s[^>]*>/gi) || [];
  const imgsWithoutAlt = imgTags.filter(
    (tag) => !/\salt\s*=\s*["'][^"']*["']/i.test(tag)
  );
  issues.push({
    criterion: "1.1.1",
    title: "Image Descriptions",
    level: "A",
    status:
      imgTags.length === 0
        ? "pass"
        : imgsWithoutAlt.length === 0
          ? "pass"
          : "fail",
    description: "Every image must have a text description so people who can't see the image understand what it shows.",
    details:
      imgTags.length === 0
        ? "No images were found in the document."
        : imgsWithoutAlt.length === 0
          ? `All ${imgTags.length} image(s) have text descriptions.`
          : `${imgsWithoutAlt.length} of ${imgTags.length} image(s) are missing text descriptions.`,
  });

  const hasSemantic =
    /<(header|nav|main|section|article|aside|footer)[\s>]/i.test(html);
  const hasHeadingHierarchy = /<h[1-6][\s>]/i.test(html);
  issues.push({
    criterion: "1.3.1",
    title: "Document Structure",
    level: "A",
    status: hasSemantic && hasHeadingHierarchy ? "pass" : "warning",
    description: "The document's structure (headings, lists, sections) must be clear to assistive technology.",
    details:
      hasSemantic && hasHeadingHierarchy
        ? "The document uses proper headings and organized sections."
        : "The document could benefit from better-organized headings and sections.",
  });

  const hasReadingOrder =
    !/<div\s+style\s*=\s*["'][^"']*position\s*:\s*absolute/i.test(html);
  issues.push({
    criterion: "1.3.2",
    title: "Reading Order",
    level: "A",
    status: hasReadingOrder ? "pass" : "warning",
    description: "Content must be arranged in a logical reading order.",
    details: hasReadingOrder
      ? "The document follows a natural top-to-bottom reading order."
      : "Some content may not be in a natural reading order, which could confuse screen readers.",
  });

  const tableTags = html.match(/<table[\s>]/gi) || [];
  const tablesWithTh = (html.match(/<th[\s>]/gi) || []).length;
  if (tableTags.length > 0) {
    issues.push({
      criterion: "1.3.1",
      title: "Table Headers",
      level: "A",
      status: tablesWithTh > 0 ? "pass" : "fail",
      description: "Tables must have clear headers so users understand what each column or row means.",
      details:
        tablesWithTh > 0
          ? `Found ${tableTags.length} table(s) with properly labeled headers.`
          : `Found ${tableTags.length} table(s) without labeled headers, making them hard to understand.`,
    });
  }

  return issues;
}

export function buildComplianceReport(allIssues: ComplianceIssue[]): ComplianceReport {
  const passCount = allIssues.filter((i) => i.status === "pass").length;
  const failCount = allIssues.filter((i) => i.status === "fail").length;
  const fixedCount = allIssues.filter((i) => i.status === "fixed").length;
  const warningCount = allIssues.filter((i) => i.status === "warning").length;
  const acceptedCount = allIssues.filter((i) => i.status === "accepted").length;
  const totalIssues = allIssues.length;
  const overallScore =
    totalIssues > 0
      ? Math.round(((passCount + fixedCount + acceptedCount) / totalIssues) * 100)
      : 0;

  return {
    totalIssues,
    passCount,
    failCount,
    fixedCount,
    warningCount,
    acceptedCount,
    overallScore,
    issues: allIssues,
  };
}

async function runAiAudit(html: string): Promise<ComplianceIssue[]> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: `You are an accessibility compliance auditor. Analyze the generated HTML for issues that automated checks cannot detect. Focus on readability, usability, and content quality.

Output a JSON array of additional compliance findings. Each finding has:
- criterion: WCAG number (e.g., "1.4.3")
- title: a short, plain-English name for the issue (e.g., "Text Contrast", "Link Clarity", "Code Quality", "Interactive Elements")
- level: "A" or "AA"
- status: "pass" | "fail" | "fixed" | "warning"
- description: explain in plain, non-technical language what this requirement means and why it matters for real users. Do NOT use technical jargon.
- details: specific findings about THIS document, written in the same plain language style

Focus on criteria NOT already covered: 1.4.3 (Contrast), 2.4.4 (Link Purpose), 4.1.1 (Parsing), 4.1.2 (Name Role Value).
Output ONLY the JSON array.`,
    messages: [
      {
        role: "user",
        content: `Analyze this accessible HTML for additional WCAG compliance:\n${html.substring(0, 6000)}`,
      },
    ],
  });

  try {
    const reportText = response.content[0]?.type === "text" ? response.content[0].text : "[]";
    const cleaned = reportText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const validated = z.array(complianceIssueSchema).safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
  } catch {
  }
  return [];
}

export function evaluateOriginalDocument(extractedText: string): ComplianceReport {
  const wrappedHtml = extractedText;
  const issues = runDeterministicChecks(wrappedHtml);
  return buildComplianceReport(issues);
}

function stripDataUris(html: string): { stripped: string; uris: Map<string, string> } {
  const uris = new Map<string, string>();
  let counter = 0;
  const stripped = html.replace(
    /src\s*=\s*(?:"(data:[^"]+)"|'(data:[^']+)')/gi,
    (_match, dq: string | undefined, sq: string | undefined) => {
      const dataUri = dq ?? sq ?? "";
      const placeholder = `__IMG_PLACEHOLDER_${counter++}__`;
      uris.set(placeholder, dataUri);
      return `src="${placeholder}"`;
    }
  );
  return { stripped, uris };
}

function restoreDataUris(html: string, uris: Map<string, string>): string {
  let result = html;
  for (const [placeholder, dataUri] of uris) {
    result = result.replaceAll(placeholder, dataUri);
  }
  return result;
}

export async function fixComplianceIssue(
  currentHtml: string,
  issue: ComplianceIssue,
  issueIndex: number,
  existingReport: ComplianceReport
): Promise<AccessibilityResult> {
  const { stripped, uris } = stripDataUris(currentHtml);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    system: `You are an accessibility expert specializing in ADA Title II compliance and WCAG 2.1 Level AA standards.

You will receive an accessible HTML document and a specific accessibility issue that needs to be fixed.
Your task is to modify the HTML to resolve ONLY the specified issue while preserving all other content and structure.

Rules:
1. Fix ONLY the specific issue described - do not make unrelated changes
2. Preserve all existing content, structure, and styling
3. Maintain the complete HTML document structure
4. Ensure the fix follows accessibility best practices
5. Preserve all img src attributes exactly as they are - do not modify, remove, or rewrite any src values
6. Output ONLY the complete fixed HTML document, no markdown, no code fences
7. Start with <!DOCTYPE html>`,
    messages: [
      {
        role: "user",
        content: `Fix the following WCAG compliance issue in this HTML document:

--- ISSUE TO FIX ---
WCAG Criterion: ${issue.criterion} (${issue.title})
Level: ${issue.level}
Status: ${issue.status}
Description: ${issue.description}
Details: ${issue.details}

--- CURRENT HTML ---
${stripped}`,
      },
    ],
  });

  const rawOutput = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  if (!rawOutput || (!rawOutput.startsWith("<!DOCTYPE html>") && !rawOutput.startsWith("<!doctype html>"))) {
    throw new Error("AI failed to produce a valid HTML fix. Please try again.");
  }

  const fixedHtml = restoreDataUris(rawOutput, uris);

  const updatedIssues = [...existingReport.issues];

  const deterministicIssues = runDeterministicChecks(fixedHtml);
  const deterministicMap = new Map<string, ComplianceIssue>();
  for (const di of deterministicIssues) {
    deterministicMap.set(`${di.criterion}::${di.title}`, di);
  }

  for (let i = 0; i < updatedIssues.length; i++) {
    const key = `${updatedIssues[i].criterion}::${updatedIssues[i].title}`;
    const freshCheck = deterministicMap.get(key);
    if (freshCheck) {
      if (updatedIssues[i].status !== "fixed") {
        updatedIssues[i] = { ...freshCheck };
      }
    }
  }

  if (issueIndex >= 0 && issueIndex < updatedIssues.length) {
    const targetIssue = updatedIssues[issueIndex];
    if (targetIssue.criterion === issue.criterion && targetIssue.title === issue.title) {
      const freshCheck = deterministicMap.get(`${issue.criterion}::${issue.title}`);
      if (freshCheck) {
        if (freshCheck.status === "pass") {
          updatedIssues[issueIndex] = { ...freshCheck, status: "fixed" };
        } else {
          updatedIssues[issueIndex] = { ...freshCheck };
        }
      } else {
        updatedIssues[issueIndex] = {
          ...targetIssue,
          status: "fixed",
          details: `Fixed: ${targetIssue.details}`,
        };
      }
    }
  }

  return {
    accessibleHtml: fixedHtml,
    complianceReport: buildComplianceReport(updatedIssues),
  };
}

export async function generateAccessibleDocument(
  extractedText: string,
  originalFilename: string,
  metadata: { title?: string; author?: string; subject?: string },
  images: ExtractedImage[] = [],
  tables: ExtractedTable[] = []
): Promise<AccessibilityResult> {
  const documentTitle =
    metadata.title || originalFilename.replace(/\.pdf$/i, "");

  const structuralSummary = buildStructuralSummary(images, tables);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: `You are an accessibility expert specializing in ADA Title II compliance and WCAG 2.1 Level AA standards.

Your task is to convert extracted PDF content into a fully accessible HTML document. Follow these rules:

1. DOCUMENT STRUCTURE: Use proper HTML5 semantic elements (header, nav, main, article, section, aside, footer)
2. HEADINGS: Create a logical heading hierarchy (h1-h6) based on the content structure. Never skip heading levels.
3. LISTS: Convert any list-like content into proper <ul>, <ol>, or <dl> elements
4. TABLES: If tabular data is provided in the structural data below, use proper <table> with <thead>, <tbody>, <th> (with scope="col" or scope="row"), and <caption>
5. LANGUAGE: Include lang="en" attribute on the html element
6. LINKS: Ensure all links have descriptive text (no "click here")
7. IMAGES: You MUST include an <img> tag for EVERY image listed in the structural data. EVERY <img> tag MUST have a non-empty alt attribute with descriptive text. Set the src attribute to exactly the image name. NEVER omit the alt attribute.
8. READING ORDER: Ensure the DOM order matches a logical linear reading order. Do not use absolute positioning.
9. CONTRAST: Use inline CSS with colors that have at least 4.5:1 contrast ratio for normal text
10. FOCUS: Ensure all interactive elements are keyboard accessible
11. LANDMARKS: Use ARIA landmarks where appropriate
12. PAGE TITLE: Include a descriptive <title> element

Output ONLY the complete HTML document, no markdown, no code fences. Start with <!DOCTYPE html>.
Include inline CSS for basic readable styling that meets contrast requirements.`,
    messages: [
      {
        role: "user",
        content: `Convert this extracted PDF content into an accessible HTML document.

Document title: ${documentTitle}
Author: ${metadata.author || "Unknown"}
Subject: ${metadata.subject || "Not specified"}

--- EXTRACTED TEXT ---
${extractedText.substring(0, 10000)}
${structuralSummary}`,
      },
    ],
  });

  const rawHtml = response.content[0]?.type === "text" ? response.content[0].text : "";
  let accessibleHtml = injectImageData(rawHtml, images);
  accessibleHtml = ensureMissingImages(accessibleHtml, images);
  accessibleHtml = ensureAltText(accessibleHtml, images);

  const deterministicIssues = runDeterministicChecks(accessibleHtml);
  const aiIssues = await runAiAudit(accessibleHtml);
  const allIssues = [...deterministicIssues, ...aiIssues];

  return {
    accessibleHtml,
    complianceReport: buildComplianceReport(allIssues),
  };
}
