import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ExtractedImage, ExtractedTable } from "./pdf-processor";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  timeout: 5 * 60 * 1000,
  maxRetries: 2,
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
    parts.push(
      "CRITICAL: You MUST reproduce EVERY table below with ALL rows and ALL cell content. " +
      "Do NOT summarize, truncate, or skip any rows or cells. Include every single piece of data."
    );
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      parts.push(`\nTable ${i + 1} on page ${table.pageNumber} (${table.rows.length} rows):`);
      for (const row of table.rows) {
        parts.push(`  | ${row.join(" | ")} |`);
      }
    }
    parts.push(
      "\nFor EVERY table above, generate proper HTML <table> with <thead>/<tbody>, <th> with scope attributes, and <caption>. " +
      "Include ALL rows — do NOT omit any data."
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

// ---------------------------------------------------------------------------
// Pure helper: parse a CSS hex colour string to [r, g, b] 0-255, or null.
// ---------------------------------------------------------------------------
export function parseHexColor(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, "").trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure helper: WCAG relative luminance for a linear RGB channel value 0-255.
// ---------------------------------------------------------------------------
export function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

// ---------------------------------------------------------------------------
// Pure helper: WCAG contrast ratio between two relative luminance values.
// ---------------------------------------------------------------------------
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Pure helper: detect skipped heading levels in document order.
// Returns the sequence of levels found and whether any level was skipped.
// ---------------------------------------------------------------------------
export function checkHeadingOrder(html: string): {
  levels: number[];
  hasSkippedLevels: boolean;
  skips: Array<{ from: number; to: number }>;
} {
  const headingRegex = /<h([1-6])[\s>]/gi;
  const levels: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    levels.push(parseInt(match[1], 10));
  }

  const skips: Array<{ from: number; to: number }> = [];
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1];
    const curr = levels[i];
    if (curr > prev + 1) {
      skips.push({ from: prev, to: curr });
    }
  }

  return { levels, hasSkippedLevels: skips.length > 0, skips };
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

  // 2.4.6 / 1.3.1 – Heading order: detect skipped heading levels
  const headingOrder = checkHeadingOrder(html);
  if (headingOrder.levels.length > 0) {
    issues.push({
      criterion: "1.3.1",
      title: "Heading Order",
      level: "A",
      status: headingOrder.hasSkippedLevels ? "warning" : "pass",
      description: "Headings should follow a logical order without skipping levels so screen reader users can navigate predictably.",
      details: headingOrder.hasSkippedLevels
        ? `Heading levels appear to skip: ${headingOrder.skips.map((s) => `h${s.from} → h${s.to}`).join(", ")}. This may confuse screen reader users.`
        : `Headings follow a logical order (${headingOrder.levels.map((l) => `h${l}`).join(", ")}).`,
    });
  }

  // 1.4.3 – Contrast: check inline hex color/background pairs for WCAG AA ratio
  const inlineStyleRegex = /style\s*=\s*["']([^"']*)["']/gi;
  const colorPairs: Array<{ color: string; background: string; ratio: number }> = [];
  let styleMatch: RegExpExecArray | null;
  const styleBlocks: string[] = [];
  while ((styleMatch = inlineStyleRegex.exec(html)) !== null) {
    styleBlocks.push(styleMatch[1]);
  }
  for (const block of styleBlocks) {
    let colorVal: string | null = null;
    let bgVal: string | null = null;
    let m: RegExpExecArray | null;
    const colorBlockRegex = /(?:^|;)\s*(color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,6})/gi;
    while ((m = colorBlockRegex.exec(block)) !== null) {
      const prop = m[1].toLowerCase();
      const val = m[2];
      if (prop === "color") colorVal = val;
      else bgVal = val;
    }
    if (colorVal && bgVal) {
      const fg = parseHexColor(colorVal);
      const bg = parseHexColor(bgVal);
      if (fg && bg) {
        const ratio = contrastRatio(relativeLuminance(...fg), relativeLuminance(...bg));
        colorPairs.push({ color: colorVal, background: bgVal, ratio });
      }
    }
  }
  const lowContrastPairs = colorPairs.filter((p) => p.ratio < 4.5);
  if (colorPairs.length > 0) {
    issues.push({
      criterion: "1.4.3",
      title: "Text Contrast",
      level: "AA",
      status: lowContrastPairs.length === 0 ? "pass" : "fail",
      description: "Text must have enough colour contrast against its background so people with low vision can read it.",
      details: lowContrastPairs.length === 0
        ? `All ${colorPairs.length} inline colour pair(s) meet the minimum contrast ratio of 4.5:1.`
        : `${lowContrastPairs.length} of ${colorPairs.length} inline colour pair(s) fail the minimum contrast ratio of 4.5:1 (e.g., ${lowContrastPairs[0].color} on ${lowContrastPairs[0].background} = ${lowContrastPairs[0].ratio.toFixed(2)}:1).`,
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
  const AI_AUDIT_CHUNK_SIZE = 15000;
  const htmlToAudit = html.length > AI_AUDIT_CHUNK_SIZE ? html.substring(0, AI_AUDIT_CHUNK_SIZE) : html;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
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
        content: `Analyze this accessible HTML for additional WCAG compliance:\n${htmlToAudit}`,
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
    model: "claude-sonnet-4-5",
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

export type ProgressCallback = (message: string) => Promise<void>;

interface PageChunk {
  text: string;
  startPage: number;
  endPage: number;
}

function splitTextByPages(text: string, maxChunkSize: number = 8000): PageChunk[] {
  const pageBreakRegex = /(?:^|\n)(?:[-=]{3,}|Page\s+\d+|---\s*Page\s*\d+\s*---|\f)/gi;
  const parts: { pageNum: number; text: string }[] = [];
  let lastIdx = 0;
  let currentPage = 1;
  let match: RegExpExecArray | null;

  const regex = new RegExp(pageBreakRegex.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ pageNum: currentPage, text: text.slice(lastIdx, match.index) });
    }
    currentPage++;
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push({ pageNum: currentPage, text: text.slice(lastIdx) });
  }
  if (parts.length === 0) {
    parts.push({ pageNum: 1, text });
  }

  const chunks: PageChunk[] = [];
  let currentChunk = "";
  let chunkStartPage = parts[0]?.pageNum ?? 1;

  for (const part of parts) {
    if (currentChunk.length + part.text.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        startPage: chunkStartPage,
        endPage: part.pageNum - 1,
      });
      currentChunk = part.text;
      chunkStartPage = part.pageNum;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + part.text;
    }
  }
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      startPage: chunkStartPage,
      endPage: parts[parts.length - 1]?.pageNum ?? 1,
    });
  }

  return chunks;
}

function filterImagesForChunk(images: ExtractedImage[], startPage: number, endPage: number): ExtractedImage[] {
  return images.filter((img) => img.pageNumber >= startPage && img.pageNumber <= endPage);
}

function filterTablesForChunk(tables: ExtractedTable[], startPage: number, endPage: number): ExtractedTable[] {
  return tables.filter((t) => t.pageNumber >= startPage && t.pageNumber <= endPage);
}

function tableContentSignature(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.trim().toLowerCase().replace(/\s+/g, " ")).join("|")).join("||");
}

function ensureMissingTables(html: string, tables: ExtractedTable[]): string {
  if (tables.length === 0) return html;

  const existingTableRegex = /<table[\s\S]*?<\/table>/gi;
  const existingTables = html.match(existingTableRegex) || [];
  const existingSignatures = new Set<string>();

  for (const tHtml of existingTables) {
    const rowMatches = tHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const rows: string[][] = [];
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) {
      existingSignatures.add(tableContentSignature(rows));
    }
  }

  const missingTables = tables.filter((t) => !existingSignatures.has(tableContentSignature(t.rows)));
  if (missingTables.length === 0) return html;

  const tableSections = missingTables
    .map((t, i) => {
      const headerRow = t.rows[0] || [];
      const bodyRows = t.rows.slice(1);
      const thead = `<thead><tr>${headerRow.map((c) => `<th scope="col">${escapeHtmlText(c)}</th>`).join("")}</tr></thead>`;
      const tbody = bodyRows.length > 0
        ? `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtmlText(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
        : "";
      return `<table><caption>Table from page ${t.pageNumber}</caption>${thead}${tbody}</table>`;
    })
    .join("\n");

  const sectionHtml = `\n<section aria-label="Additional tables">\n<h2>Additional Tables</h2>\n${tableSections}\n</section>`;

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

function mergeChunksIntoDocument(
  chunks: string[],
  metadata: { title?: string; author?: string; subject?: string }
): string {
  if (chunks.length === 1) return chunks[0];

  const bodyContents: string[] = [];
  let headContent = "";
  let lang = "en";

  for (const chunk of chunks) {
    const langMatch = chunk.match(/<html[^>]*\slang=["']([^"']+)["']/i);
    if (langMatch) lang = langMatch[1];

    const headMatch = chunk.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch && !headContent) headContent = headMatch[1];

    const bodyMatch = chunk.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      bodyContents.push(bodyMatch[1]);
    } else {
      const cleaned = chunk
        .replace(/<!DOCTYPE[^>]*>/i, "")
        .replace(/<html[^>]*>/i, "")
        .replace(/<\/html>/i, "")
        .replace(/<head[^>]*>[\s\S]*?<\/head>/i, "")
        .replace(/<body[^>]*>/i, "")
        .replace(/<\/body>/i, "")
        .trim();
      if (cleaned) bodyContents.push(cleaned);
    }
  }

  const documentTitle = metadata.title || "Accessible Document";
  if (!headContent) {
    headContent = `<meta charset="utf-8"><title>${escapeHtmlText(documentTitle)}</title>`;
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headContent}
</head>
<body>
<main id="main-content">
${bodyContents.join("\n\n<hr aria-hidden=\"true\">\n\n")}
</main>
</body>
</html>`;
}

export async function generateAccessibleDocument(
  extractedText: string,
  originalFilename: string,
  metadata: { title?: string; author?: string; subject?: string },
  images: ExtractedImage[] = [],
  tables: ExtractedTable[] = [],
  pageCount?: number,
  onProgress?: ProgressCallback
): Promise<AccessibilityResult> {
  const documentTitle =
    metadata.title || originalFilename.replace(/\.pdf$/i, "");

  const CHUNK_THRESHOLD = 8000;
  const chunks = splitTextByPages(extractedText, CHUNK_THRESHOLD);
  const needsChunking = chunks.length > 1;

  const systemPrompt = `You are an accessibility expert specializing in ADA Title II compliance and WCAG 2.1 Level AA standards.

Your task is to convert extracted PDF content into a fully accessible HTML document. Follow these rules:

1. DOCUMENT STRUCTURE: Use proper HTML5 semantic elements (header, nav, main, article, section, aside, footer)
2. HEADINGS: Create a logical heading hierarchy (h1-h6) based on the content structure. Never skip heading levels.
3. LISTS: Convert any list-like content into proper <ul>, <ol>, or <dl> elements
4. TABLES: If tabular data is provided in the structural data below, you MUST reproduce EVERY table with ALL rows and ALL cell data — do NOT summarize, skip, or truncate any rows. Use proper <table> with <thead>, <tbody>, <th> (with scope="col" or scope="row"), and <caption>. Even if a cell appears empty in the source, include it as an empty <td>
5. LANGUAGE: Include lang="en" attribute on the html element
6. LINKS: Ensure all links have descriptive text (no "click here")
7. IMAGES: You MUST include an <img> tag for EVERY image listed in the structural data. EVERY <img> tag MUST have a non-empty alt attribute with descriptive text. Set the src attribute to exactly the image name. NEVER omit the alt attribute.
8. READING ORDER: Ensure the DOM order matches a logical linear reading order. Do not use absolute positioning.
9. CONTRAST: Use inline CSS with colors that have at least 4.5:1 contrast ratio for normal text
10. FOCUS: Ensure all interactive elements are keyboard accessible
11. LANDMARKS: Use ARIA landmarks where appropriate
12. PAGE TITLE: Include a descriptive <title> element

Output ONLY the complete HTML document, no markdown, no code fences. Start with <!DOCTYPE html>.
Include inline CSS for basic readable styling that meets contrast requirements.`;

  const continuationSystemPrompt = `You are an accessibility expert continuing the conversion of a multi-page PDF document into accessible HTML.

You are receiving a CONTINUATION chunk of the same document. The previous chunks have already been converted.
Your task is to convert THIS chunk into accessible HTML content that can be merged with the previous chunks.

Follow the same WCAG 2.1 Level AA rules:
- Proper semantic HTML5 elements
- Logical heading hierarchy (continue from where the previous chunk left off)
- Proper lists, tables with headers, image alt text
- TABLES: Reproduce EVERY table with ALL rows and ALL cell data — do NOT skip or summarize any rows
- No absolute positioning

Output ONLY the HTML content for this chunk (no <!DOCTYPE>, no <html>, no <head>). 
Just output the <body> content that will be merged into the full document.
Do NOT repeat any content from previous chunks.`;

  const chunkHtmlParts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkImages = filterImagesForChunk(images, chunk.startPage, chunk.endPage);
    const chunkTables = filterTablesForChunk(tables, chunk.startPage, chunk.endPage);
    const structuralSummary = buildStructuralSummary(chunkImages, chunkTables);

    const totalPages = pageCount || chunks[chunks.length - 1].endPage;
    const progressMsg = needsChunking
      ? `Converting pages ${chunk.startPage}–${chunk.endPage} of ${totalPages} (chunk ${i + 1}/${chunks.length})…`
      : `Converting ${totalPages} page document…`;

    if (onProgress) {
      await onProgress(progressMsg);
    }

    const isFirst = i === 0;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 16384,
      system: isFirst ? systemPrompt : continuationSystemPrompt,
      messages: [
        {
          role: "user",
          content: isFirst
            ? `Convert this extracted PDF content into an accessible HTML document.

Document title: ${documentTitle}
Author: ${metadata.author || "Unknown"}
Subject: ${metadata.subject || "Not specified"}
${needsChunking ? `\nThis is chunk ${i + 1} of ${chunks.length} (pages ${chunk.startPage}–${chunk.endPage}).` : ""}

--- EXTRACTED TEXT ---
${chunk.text}
${structuralSummary}`
            : `Continue converting this PDF document.

Document title: ${documentTitle}
This is chunk ${i + 1} of ${chunks.length} (pages ${chunk.startPage}–${chunk.endPage}).

--- EXTRACTED TEXT (CONTINUATION) ---
${chunk.text}
${structuralSummary}`,
        },
      ],
    });

    const rawHtml = response.content[0]?.type === "text" ? response.content[0].text : "";
    let chunkHtml = injectImageData(rawHtml, chunkImages);
    chunkHtml = ensureMissingImages(chunkHtml, chunkImages);
    chunkHtml = ensureAltText(chunkHtml, chunkImages);
    chunkHtml = ensureMissingTables(chunkHtml, chunkTables);

    chunkHtmlParts.push(chunkHtml);
  }

  if (onProgress) {
    await onProgress("Running compliance checks…");
  }

  const accessibleHtml = needsChunking
    ? mergeChunksIntoDocument(chunkHtmlParts, metadata)
    : chunkHtmlParts[0];

  const deterministicIssues = runDeterministicChecks(accessibleHtml);
  const aiIssues = await runAiAudit(accessibleHtml);
  const allIssues = [...deterministicIssues, ...aiIssues];

  return {
    accessibleHtml,
    complianceReport: buildComplianceReport(allIssues),
  };
}
