import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parse as parseHtml } from "node-html-parser";
import type { ExtractedImage, ExtractedTable } from "./pdf-processor";
import { fixDuplicateTableCaptions } from "./table-fixers.js";
import { db } from "../db";
import { appMetrics } from "@shared/schema";
import { sql } from "drizzle-orm";
import { storage } from "../storage";

/** Inline concurrency limiter — equivalent to p-limit but works in any bundle format. */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          if (queue.length > 0) queue.shift()!();
        });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

/** Escape all regex metacharacters in a string so it can be safely embedded in a RegExp pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the attribute list inside an HTML open tag, correctly skipping over
 * quoted attribute values so that `>`, `"`, or `'` inside a value are not
 * mistaken for the end of the tag.
 *
 * Pattern breakdown:
 *   [^>"'`]  — any character that is not >, ", ', or ` (unquoted attr chars)
 *   "[^"]*"  — a double-quoted value (including any >, ', or ` inside)
 *   '[^']*'  — a single-quoted value (including any >, ", or ` inside)
 *   `[^`]*`  — a backtick-quoted value (including any >, ", or ' inside)
 *
 * Use as a string so it can be interpolated into `new RegExp(...)` calls.
 */
const ATTR_PATTERN = "(?:[^>\"'`]|\"[^\"]*\"|'[^']*'|`[^`]*`)*";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  timeout: 5 * 60 * 1000,
  maxRetries: 2,
});

let aiFixRetryCount = 0;
let aiFixRetryLastAt: string | null = null;
let persistAiFixRetryLastFailed = false;

// DB row key used in the app_metrics table.
// Exported so tests can reference the canonical value instead of repeating
// the string literal — a rename in source will cause a compile-time mismatch.
export const AI_FIX_RETRY_METRIC_KEY = "ai_fix_retry";

/** Returns whether the most recent call to persistAiFixRetry failed to write to the DB. */
export function getPersistAiFixRetryLastFailed(): boolean {
  return persistAiFixRetryLastFailed;
}

export async function getAiFixRetryMetrics(): Promise<{ retryCount: number; lastRetryAt: string | null }> {
  try {
    const [row] = await db.select().from(appMetrics).where(sql`${appMetrics.key} = ${AI_FIX_RETRY_METRIC_KEY}`);
    if (row) {
      return {
        retryCount: row.count,
        lastRetryAt: row.lastAt ? row.lastAt.toISOString() : null,
      };
    }
  } catch (err) {
    console.warn("[accessibility-engine] Failed to read ai_fix_retry metric from DB, falling back to in-memory:", err);
  }
  return { retryCount: aiFixRetryCount, lastRetryAt: aiFixRetryLastAt };
}

async function persistAiFixRetry(timestamp: string): Promise<void> {
  try {
    await db
      .insert(appMetrics)
      .values({ key: AI_FIX_RETRY_METRIC_KEY, count: 1, lastAt: new Date(timestamp) })
      .onConflictDoUpdate({
        target: appMetrics.key,
        set: {
          count: sql`${appMetrics.count} + 1`,
          lastAt: new Date(timestamp),
        },
      });
    persistAiFixRetryLastFailed = false;
  } catch (err) {
    persistAiFixRetryLastFailed = true;
    console.warn("[accessibility-engine] Failed to persist ai_fix_retry metric to DB:", err);
  }
}

const imageItemSchema = z.object({
  label: z.string(),
  src: z.string().optional(),
  originalIndex: z.number(),
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
  imageItems: z.array(imageItemSchema).optional(),
  fixNotes: z.string().optional(),
  tagCounts: z.record(z.number()).optional(),
});

export interface ImageItem {
  label: string;
  src?: string;
  originalIndex: number;
}

export interface ComplianceIssue {
  criterion: string;
  title: string;
  level: "A" | "AA" | "AAA";
  status: "pass" | "fail" | "fixed" | "warning" | "accepted";
  description: string;
  details: string;
  justification?: string;
  previousStatus?: "fail" | "warning";
  imageItems?: ImageItem[];
  fixNotes?: string;
  tagCounts?: Record<string, number>;
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
  contentFidelity?: ContentFidelityReport;
  wasRetried?: boolean;
  elementsFixed?: number;
  noFixReason?: string;
  /** Set when the source document exceeded the chunk cap and trailing content was not converted. */
  truncationWarning?: string;
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

/**
 * Normalise an image src value for comparison:
 * 1. Replace literal `+` with `%20` so space-encoded filenames are decoded correctly.
 * 2. Percent-decode the result.
 * 3. Replace any remaining `+` (from `%2B`) with a space for uniform treatment.
 * 4. Apply NFC Unicode normalisation so NFC/NFD variants match.
 * 5. Lowercase for case-insensitive comparison.
 */
function normalizeImageSrc(src: string): string {
  const withPlusAsSpace = src.replace(/\+/g, "%20");
  let decoded: string;
  try {
    decoded = decodeURIComponent(withPlusAsSpace);
  } catch {
    try {
      decoded = decodeURIComponent(src);
    } catch {
      decoded = src;
    }
  }
  return decoded.replace(/\+/g, " ").normalize("NFC").toLowerCase();
}

export function injectImageData(html: string, images: ExtractedImage[]): string {
  if (images.length === 0) return html;

  const imageMap = new Map<string, string>();
  for (const img of images) {
    imageMap.set(normalizeImageSrc(img.name), img.dataUrl);
  }

  return html.replace(
    new RegExp(`<img\\s(${ATTR_PATTERN}?)src\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))(${ATTR_PATTERN}?)>`, "gi"),
    (match, before: string, dq: string | undefined, sq: string | undefined, uq: string | undefined, after: string) => {
      const src = dq ?? sq ?? uq ?? "";
      if (src.startsWith("data:")) return match;

      const srcNorm = normalizeImageSrc(src);
      const dataUrl = imageMap.get(srcNorm);
      if (dataUrl) {
        return `<img ${before}src="${dataUrl}"${after}>`;
      }

      for (const [name, url] of imageMap) {
        if (srcNorm.includes(name) || name.includes(srcNorm)) {
          return `<img ${before}src="${url}"${after}>`;
        }
      }

      return `<img ${before}src="${TRANSPARENT_PIXEL}"${after}>`;
    }
  );
}

function escapeHtmlAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}

function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function escapeHtmlText(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function ensureAltText(html: string, images: ExtractedImage[]): string {
  const imageMetaMap = new Map<string, ExtractedImage>();
  for (const img of images) {
    imageMetaMap.set(img.dataUrl, img);
  }

  const weakAltPatterns = /^(image|photo|picture|img|icon|graphic|figure|untitled|undefined|null)$/i;
  const altAttrRegex = /(?:^|\s)alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

  return html.replace(
    new RegExp(`<img\\s(${ATTR_PATTERN}?)>`, "gi"),
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
        const cleanName = safeDecodeURIComponent(src).replace(/[_-]/g, " ").replace(/\.[^.]+$/, "");
        altText = `Image: ${escapeHtmlAttr(cleanName)}`;
      } else if (src.startsWith("data:")) {
        const meta = imageMetaMap.get(src);
        if (meta) {
          const cleanName = safeDecodeURIComponent(meta.name).replace(/[_-]/g, " ").replace(/\.[^.]+$/, "");
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

export function ensureMissingImages(html: string, images: ExtractedImage[]): string {
  if (images.length === 0) return html;

  const matchedDataUrls = new Set<string>();
  const matchedNames = new Set<string>();
  const imgTagRegex = new RegExp(`<img\\s${ATTR_PATTERN}?src\\s*=\\s*(?:"([^"]*)"|'([^']*)')${ATTR_PATTERN}>`, "gi");
  let tagMatch;
  while ((tagMatch = imgTagRegex.exec(html)) !== null) {
    const src = tagMatch[1] ?? tagMatch[2] ?? "";
    if (src.startsWith("data:")) {
      matchedDataUrls.add(src);
    } else {
      matchedNames.add(normalizeImageSrc(src));
    }
  }

  const missingImages = images.filter(
    (img) => !matchedDataUrls.has(img.dataUrl) && !matchedNames.has(normalizeImageSrc(img.name))
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

  const hasLang = new RegExp(`<html${ATTR_PATTERN}\\slang\\s*=`, "i").test(html);
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
  const headingOrderInfo = checkHeadingOrder(html);
  const firstHeadingIsH1 = headingOrderInfo.levels.length === 0 || headingOrderInfo.levels[0] === 1;
  issues.push({
    criterion: "2.4.6",
    title: "Headings and Labels",
    level: "AA",
    status: !hasH1 ? "fail" : !firstHeadingIsH1 ? "warning" : "pass",
    description: "The document needs clear headings to help users navigate and find information, and the topmost heading must be an H1 so the hierarchy starts correctly.",
    details: !hasH1
      ? "The document is missing a main heading, making it harder to navigate."
      : !firstHeadingIsH1
        ? `The document's first heading is an H${headingOrderInfo.levels[0]}, not an H1. The heading hierarchy should start at H1 so the main title is properly identified.`
        : `The document has ${h1Count} main heading(s) providing clear structure.`,
  });

  const hasMain =
    /<main[\s>]/i.test(html) ||
    /role\s*=\s*["']main["']/i.test(html);
  const hasOtherLandmarks =
    /<header[\s>]/i.test(html) ||
    /<nav[\s>]/i.test(html) ||
    /<footer[\s>]/i.test(html);

  let bypassDetails: string;
  if (hasMain) {
    bypassDetails = "The document is organized into clear, labeled sections.";
  } else if (hasOtherLandmarks) {
    bypassDetails =
      "This document contains header, navigation, or footer sections but has no main content area. " +
      "All body content appears to be inside landmark elements, so no <main> region could be identified. " +
      "Add a <main> element (or role=\"main\" on a wrapper) to clearly mark where the primary content begins, " +
      "so screen reader users can skip directly to it.";
  } else {
    bypassDetails = "The document could be better organized into labeled sections for easier navigation.";
  }

  issues.push({
    criterion: "2.4.1",
    title: "Bypass Blocks",
    level: "A",
    status: hasMain ? "pass" : "warning",
    description: "The document should have clear sections so users can skip to the content they need.",
    details: bypassDetails,
  });

  const imgTags = html.match(new RegExp(`<img\\s${ATTR_PATTERN}>`, "gi")) || [];
  const imgsWithoutAlt: Array<{ tag: string; originalIndex: number }> = [];
  imgTags.forEach((tag, originalIndex) => {
    if (!/\salt\s*=\s*["'][^"']*["']/i.test(tag)) {
      imgsWithoutAlt.push({ tag, originalIndex });
    }
  });

  let altDetails: string;
  let imageItems: ImageItem[] | undefined;
  if (imgTags.length === 0) {
    altDetails = "No images were found in the document.";
  } else if (imgsWithoutAlt.length === 0) {
    altDetails = `All ${imgTags.length} image(s) have text descriptions.`;
  } else {
    const failingImageDescriptions = imgsWithoutAlt.map(({ tag, originalIndex: _originalIndex }, idx) => {
      const srcMatch = tag.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? "") : "";
      if (src && !src.startsWith("data:")) {
        const filename = safeDecodeURIComponent(src.split("/").pop() ?? src);
        return `Image ${idx + 1} ("${filename}")`;
      }
      return `Image ${idx + 1} (no src)`;
    });
    altDetails = `${imgsWithoutAlt.length} of ${imgTags.length} image(s) are missing text descriptions: ${failingImageDescriptions.join(", ")}.`;

    imageItems = imgsWithoutAlt.map(({ tag, originalIndex }, idx) => {
      const srcMatch = tag.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? "") : "";
      const isDataUrl = src.startsWith("data:");
      if (src && !isDataUrl) {
        const filename = safeDecodeURIComponent(src.split("/").pop() ?? src);
        return { label: `Image ${idx + 1} ("${filename}")`, src, originalIndex };
      }
      return { label: `Image ${idx + 1} (no src)`, originalIndex };
    });
  }

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
    details: altDetails,
    imageItems,
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

  const parsedDoc = parseHtml(html);
  const allTableNodes = parsedDoc.querySelectorAll("table");
  if (allTableNodes.length > 0) {
    const tablesWithoutTh = allTableNodes.filter((table) => {
      const allThs = table.querySelectorAll("th");
      const directThs = allThs.filter((th) => {
        let el = th.parentNode;
        while (el && el !== table) {
          if (el.tagName?.toLowerCase() === "table") return false;
          el = el.parentNode;
        }
        return true;
      });
      return directThs.length === 0;
    });
    const allHaveHeaders = tablesWithoutTh.length === 0;

    let failingTableDescriptions: string[] = [];
    if (!allHaveHeaders) {
      failingTableDescriptions = tablesWithoutTh.map((table) => {
        const tableIndex = allTableNodes.indexOf(table) + 1;
        const captionEl = table.querySelector("caption");
        const caption = captionEl?.text?.trim();
        const id = table.getAttribute("id");
        const rows = table.querySelectorAll("tr").length;
        const cols = Math.max(
          0,
          ...table.querySelectorAll("tr").map((tr) => tr.querySelectorAll("td, th").length)
        );
        const label = caption
          ? `caption: "${caption}"`
          : id
          ? `id="${id}"`
          : `${rows} row${rows !== 1 ? "s" : ""} × ${cols} col${cols !== 1 ? "s" : ""}`;
        return `Table ${tableIndex} (${label})`;
      });
    }

    issues.push({
      criterion: "1.3.1",
      title: "Table Headers",
      level: "A",
      status: allHaveHeaders ? "pass" : "fail",
      description: "Tables must have clear headers so users understand what each column or row means.",
      details: allHaveHeaders
        ? `Found ${allTableNodes.length} table(s) with properly labeled headers.`
        : `Found ${tablesWithoutTh.length} of ${allTableNodes.length} table(s) without labeled headers: ${failingTableDescriptions.join("; ")}.`,
    });

    const tablesWithTdOnlyFirstRow = allTableNodes.filter((table) => {
      const allRows = table.querySelectorAll("tr");
      const firstDirectRow = allRows.find((row) => {
        let el = row.parentNode;
        while (el && el !== table) {
          if (el.tagName?.toLowerCase() === "table") return false;
          el = el.parentNode;
        }
        return true;
      });
      if (!firstDirectRow) return false;
      const tds = firstDirectRow.querySelectorAll("td");
      const ths = firstDirectRow.querySelectorAll("th");
      return tds.length > 0 && ths.length === 0;
    });

    if (tablesWithTdOnlyFirstRow.length > 0) {
      issues.push({
        criterion: "1.3.1",
        title: "Table Header Markup",
        level: "A",
        status: "warning",
        description: "Table header cells should use <th> instead of <td> so screen readers can identify them as headers.",
        details: `Found ${tablesWithTdOnlyFirstRow.length} table(s) whose first row uses only <td> cells. If these cells act as column headers, replace them with <th scope="col"> for proper accessibility.`,
      });
    }

    const tablesWithAriaRoleHeaders = allTableNodes.filter((table) => {
      const tds = table.querySelectorAll("td");
      return tds.some((td) => {
        const role = td.getAttribute("role");
        return role === "columnheader" || role === "rowheader";
      });
    });

    if (tablesWithAriaRoleHeaders.length > 0) {
      issues.push({
        criterion: "1.3.1",
        title: "ARIA Role on Table Data Cell",
        level: "A",
        status: "warning",
        description: "Using role=\"columnheader\" or role=\"rowheader\" on <td> elements indicates headers that should instead use native <th> markup.",
        details: `Found ${tablesWithAriaRoleHeaders.length} table(s) with <td> cells using ARIA header roles. Replace these cells with <th scope="col"> or <th scope="row"> for proper semantic markup.`,
      });
    }

    // 1.3.1 – Duplicate table captions
    const captionMap = new Map<string, number[]>();
    allTableNodes.forEach((table, idx) => {
      const captionEl = table.querySelector("caption");
      if (captionEl) {
        const normalized = captionEl.text.trim().toLowerCase();
        if (normalized) {
          const group = captionMap.get(normalized) ?? [];
          group.push(idx + 1);
          captionMap.set(normalized, group);
        }
      }
    });
    const duplicateCaptionGroups = [...captionMap.entries()].filter(([, indices]) => indices.length > 1);
    if (duplicateCaptionGroups.length > 0) {
      const groupDescriptions = duplicateCaptionGroups.map(([text, indices]) => {
        const tableList = indices.map((n) => `Table ${n}`).join(", ");
        return `${tableList} share the caption "${text}"`;
      });
      issues.push({
        criterion: "1.3.1",
        title: "Duplicate Table Captions",
        level: "A",
        status: "warning",
        description: "Each table should have a unique caption so screen reader users can distinguish between tables.",
        details: `Found ${duplicateCaptionGroups.length} group(s) of tables with duplicate captions: ${groupDescriptions.join("; ")}.`,
      });
    }
  }

  // 4.1.2 – ARIA role="button" on non-button elements
  const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset", "image"]);
  const buttonRoleNodes = parsedDoc.querySelectorAll("[role='button']");
  const nonButtonsWithButtonRole = buttonRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "button") return false;
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return !BUTTON_INPUT_TYPES.has(type);
    }
    return true;
  });
  if (nonButtonsWithButtonRole.length > 0) {
    const buttonTagCounts: Record<string, number> = {};
    nonButtonsWithButtonRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      buttonTagCounts[tag] = (buttonTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(buttonTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "4.1.2",
      title: "ARIA Button Role on Non-Button Element",
      level: "A",
      status: "warning",
      description: "Using role=\"button\" on a non-button element (e.g. <div> or <span>) is fragile and error-prone. Use a native <button> element instead.",
      details: `Found ${nonButtonsWithButtonRole.length} element(s) with role="button" that are not native button elements (e.g. ${tagList}). Replace them with <button> for built-in keyboard and accessibility support.`,
      tagCounts: buttonTagCounts,
    });
  }

  // 1.3.1 – ARIA role="heading" on non-heading elements
  const headingRoleNodes = parsedDoc.querySelectorAll("[role='heading']");
  const nonHeadingsWithHeadingRole = headingRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return !/^h[1-6]$/.test(tag ?? "");
  });
  if (nonHeadingsWithHeadingRole.length > 0) {
    const headingTagCounts: Record<string, number> = {};
    nonHeadingsWithHeadingRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      headingTagCounts[tag] = (headingTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(headingTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA Heading Role on Non-Heading Element",
      level: "A",
      status: "warning",
      description: "Using role=\"heading\" on a non-heading element (e.g. <div> or <span>) is a misuse of ARIA. Use native <h1>–<h6> elements instead.",
      details: `Found ${nonHeadingsWithHeadingRole.length} element(s) with role="heading" that are not native heading elements (e.g. ${tagList}). Replace them with the appropriate <h1>–<h6> element for proper document structure.`,
      tagCounts: headingTagCounts,
    });
  }

  // 4.1.2 – ARIA role="link" on non-anchor elements
  const linkRoleNodes = parsedDoc.querySelectorAll("[role='link']");
  const nonAnchorsWithLinkRole = linkRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "a";
  });
  if (nonAnchorsWithLinkRole.length > 0) {
    const linkTagCounts: Record<string, number> = {};
    nonAnchorsWithLinkRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      linkTagCounts[tag] = (linkTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(linkTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "4.1.2",
      title: "ARIA Link Role on Non-Anchor Element",
      level: "A",
      status: "warning",
      description: "Using role=\"link\" on a non-anchor element (e.g. <div> or <span>) is a misuse of ARIA. Use a native <a> element with an href attribute instead.",
      details: `Found ${nonAnchorsWithLinkRole.length} element(s) with role="link" that are not native anchor elements (e.g. ${tagList}). Replace them with <a href="..."> for built-in keyboard and accessibility support.`,
      tagCounts: linkTagCounts,
    });
  }

  // 4.1.2 – ARIA role="checkbox" on non-input elements
  const checkboxRoleNodes = parsedDoc.querySelectorAll("[role='checkbox']");
  const nonCheckboxesWithCheckboxRole = checkboxRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return type !== "checkbox";
    }
    return true;
  });
  if (nonCheckboxesWithCheckboxRole.length > 0) {
    const checkboxTagCounts: Record<string, number> = {};
    nonCheckboxesWithCheckboxRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      checkboxTagCounts[tag] = (checkboxTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(checkboxTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "4.1.2",
      title: "ARIA Checkbox Role on Non-Input Element",
      level: "A",
      status: "warning",
      description: "Using role=\"checkbox\" on a non-input element (e.g. <div> or <span>) is a misuse of ARIA. Use a native <input type=\"checkbox\"> instead.",
      details: `Found ${nonCheckboxesWithCheckboxRole.length} element(s) with role="checkbox" that are not native checkbox inputs (e.g. ${tagList}). Replace them with <input type="checkbox"> for built-in keyboard and accessibility support.`,
      tagCounts: checkboxTagCounts,
    });
  }

  // 4.1.2 – ARIA role="radio" on non-input elements
  const radioRoleNodes = parsedDoc.querySelectorAll("[role='radio']");
  const nonRadiosWithRadioRole = radioRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return type !== "radio";
    }
    return true;
  });
  if (nonRadiosWithRadioRole.length > 0) {
    const radioTagCounts: Record<string, number> = {};
    nonRadiosWithRadioRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      radioTagCounts[tag] = (radioTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(radioTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "4.1.2",
      title: "ARIA Radio Role on Non-Input Element",
      level: "A",
      status: "warning",
      description: "Using role=\"radio\" on a non-input element (e.g. <div> or <span>) is a misuse of ARIA. Use a native <input type=\"radio\"> instead.",
      details: `Found ${nonRadiosWithRadioRole.length} element(s) with role="radio" that are not native radio inputs (e.g. ${tagList}). Replace them with <input type="radio"> for built-in keyboard and accessibility support.`,
      tagCounts: radioTagCounts,
    });
  }

  // 1.3.1 – ARIA role="list" on non-list elements
  const listRoleNodes = parsedDoc.querySelectorAll("[role='list']");
  const nonListsWithListRole = listRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "ul" && tag !== "ol";
  });
  if (nonListsWithListRole.length > 0) {
    const listTagCounts: Record<string, number> = {};
    nonListsWithListRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      listTagCounts[tag] = (listTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(listTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA List Role on Non-List Element",
      level: "A",
      status: "warning",
      description: "Using role=\"list\" on a non-list element (e.g. <div>) is a misuse of ARIA. Use a native <ul> or <ol> element instead.",
      details: `Found ${nonListsWithListRole.length} element(s) with role="list" that are not native list elements (e.g. ${tagList}). Replace them with <ul> or <ol> for proper semantics.`,
      tagCounts: listTagCounts,
    });
  }

  // 1.3.1 – ARIA role="listitem" on non-listitem elements
  const listitemRoleNodes = parsedDoc.querySelectorAll("[role='listitem']");
  const nonListitemsWithListitemRole = listitemRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "li";
  });
  if (nonListitemsWithListitemRole.length > 0) {
    const listitemTagCounts: Record<string, number> = {};
    nonListitemsWithListitemRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      listitemTagCounts[tag] = (listitemTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(listitemTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA Listitem Role on Non-Listitem Element",
      level: "A",
      status: "warning",
      description: "Using role=\"listitem\" on a non-listitem element (e.g. <div> or <span>) is a misuse of ARIA. Use a native <li> element inside a <ul> or <ol> instead.",
      details: `Found ${nonListitemsWithListitemRole.length} element(s) with role="listitem" that are not native list item elements (e.g. ${tagList}). Replace them with <li> for proper semantics.`,
      tagCounts: listitemTagCounts,
    });
  }

  // 1.3.1 – ARIA role="listbox" on non-select elements
  const listboxRoleNodes = parsedDoc.querySelectorAll("[role='listbox']");
  const nonSelectsWithListboxRole = listboxRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "select";
  });
  if (nonSelectsWithListboxRole.length > 0) {
    const listboxTagCounts: Record<string, number> = {};
    nonSelectsWithListboxRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      listboxTagCounts[tag] = (listboxTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(listboxTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA Listbox Role on Non-Select Element",
      level: "A",
      status: "warning",
      description: "Using role=\"listbox\" on a non-select element (e.g. <div>) is a misuse of ARIA. Use a native <select> element instead.",
      details: `Found ${nonSelectsWithListboxRole.length} element(s) with role="listbox" that are not native select elements (e.g. ${tagList}). Replace them with <select> for proper semantics.`,
      tagCounts: listboxTagCounts,
    });
  }

  // 4.1.2 – ARIA role="slider" on non-input elements
  const sliderRoleNodes = parsedDoc.querySelectorAll("[role='slider']");
  const nonSlidersWithSliderRole = sliderRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return type !== "range";
    }
    return true;
  });
  if (nonSlidersWithSliderRole.length > 0) {
    const sliderTagCounts: Record<string, number> = {};
    nonSlidersWithSliderRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      sliderTagCounts[tag] = (sliderTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(sliderTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "4.1.2",
      title: "ARIA Slider Role on Non-Input Element",
      level: "A",
      status: "warning",
      description: "Using role=\"slider\" on a non-input element (e.g. <div>) is a misuse of ARIA. Use a native <input type=\"range\"> instead.",
      details: `Found ${nonSlidersWithSliderRole.length} element(s) with role="slider" that are not native range inputs (e.g. ${tagList}). Replace them with <input type="range"> for built-in keyboard and accessibility support.`,
      tagCounts: sliderTagCounts,
    });
  }

  // 4.1.2 – ARIA role="spinbutton" on non-input elements
  const spinbuttonRoleNodes = parsedDoc.querySelectorAll("[role='spinbutton']");
  const nonSpinbuttonsWithSpinbuttonRole = spinbuttonRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return type !== "number";
    }
    return true;
  });
  if (nonSpinbuttonsWithSpinbuttonRole.length > 0) {
    const spinbuttonTagCounts: Record<string, number> = {};
    nonSpinbuttonsWithSpinbuttonRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      spinbuttonTagCounts[tag] = (spinbuttonTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(spinbuttonTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "4.1.2",
      title: "ARIA Spinbutton Role on Non-Input Element",
      level: "A",
      status: "warning",
      description: "Using role=\"spinbutton\" on a non-input element (e.g. <div>) is a misuse of ARIA. Use a native <input type=\"number\"> instead.",
      details: `Found ${nonSpinbuttonsWithSpinbuttonRole.length} element(s) with role="spinbutton" that are not native number inputs (e.g. ${tagList}). Replace them with <input type="number"> for built-in keyboard and accessibility support.`,
      tagCounts: spinbuttonTagCounts,
    });
  }

  // 4.1.2 – ARIA role="switch" on non-input elements
  const switchRoleNodes = parsedDoc.querySelectorAll("[role='switch']");
  const nonSwitchesWithSwitchRole = switchRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return type !== "checkbox";
    }
    return true;
  });
  if (nonSwitchesWithSwitchRole.length > 0) {
    const switchTagCounts: Record<string, number> = {};
    nonSwitchesWithSwitchRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      switchTagCounts[tag] = (switchTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(switchTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "4.1.2",
      title: "ARIA Switch Role on Non-Input Element",
      level: "A",
      status: "warning",
      description: "Using role=\"switch\" on a non-input element (e.g. <div>) is a misuse of ARIA. Use a native <input type=\"checkbox\"> styled as a toggle switch instead.",
      details: `Found ${nonSwitchesWithSwitchRole.length} element(s) with role="switch" that are not native checkbox inputs (e.g. ${tagList}). Replace them with <input type="checkbox"> for built-in keyboard and accessibility support.`,
      tagCounts: switchTagCounts,
    });
  }

  // 1.3.1 – ARIA role="treeitem" on non-li/non-anchor elements
  const treeitemRoleNodes = parsedDoc.querySelectorAll("[role='treeitem']");
  const nonTreeitemsWithTreeitemRole = treeitemRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "li" && tag !== "a";
  });
  if (nonTreeitemsWithTreeitemRole.length > 0) {
    const treeitemTagCounts: Record<string, number> = {};
    nonTreeitemsWithTreeitemRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      treeitemTagCounts[tag] = (treeitemTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(treeitemTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA Treeitem Role on Non-List/Anchor Element",
      level: "A",
      status: "warning",
      description: "Using role=\"treeitem\" on a non-list or non-anchor element (e.g. <div>) is a misuse of ARIA. Use a native <li> or <a> element within a tree structure instead.",
      details: `Found ${nonTreeitemsWithTreeitemRole.length} element(s) with role="treeitem" that are not native list item or anchor elements (e.g. ${tagList}). Replace them with <li> or <a> for proper semantics.`,
      tagCounts: treeitemTagCounts,
    });
  }

  // 1.3.1 – ARIA role="combobox" on non-select/non-input elements
  const comboboxRoleNodes = parsedDoc.querySelectorAll("[role='combobox']");
  const nonComboboxWithComboboxRole = comboboxRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "select" && tag !== "input";
  });
  if (nonComboboxWithComboboxRole.length > 0) {
    const comboboxTagCounts: Record<string, number> = {};
    nonComboboxWithComboboxRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      comboboxTagCounts[tag] = (comboboxTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(comboboxTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA Combobox Role on Non-Combobox Element",
      level: "A",
      status: "warning",
      description: "Using role=\"combobox\" on a non-interactive element (e.g. <div>) is a misuse of ARIA. Use a native <select> or <input> element with an associated listbox instead.",
      details: `Found ${nonComboboxWithComboboxRole.length} element(s) with role="combobox" that are not native combobox elements (e.g. ${tagList}). Replace them with <select> or <input> for proper semantics.`,
      tagCounts: comboboxTagCounts,
    });
  }

  // 1.3.1 – ARIA role="grid" on non-table elements
  const gridRoleNodes = parsedDoc.querySelectorAll("[role='grid']");
  const nonTableWithGridRole = gridRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "table";
  });
  if (nonTableWithGridRole.length > 0) {
    const gridTagCounts: Record<string, number> = {};
    nonTableWithGridRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      gridTagCounts[tag] = (gridTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(gridTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA Grid Role on Non-Table Element",
      level: "A",
      status: "warning",
      description: "Using role=\"grid\" on a non-table element (e.g. <div>) is a misuse of ARIA. Use a native <table> element instead.",
      details: `Found ${nonTableWithGridRole.length} element(s) with role="grid" that are not native table elements (e.g. ${tagList}). Replace them with <table> for proper semantics.`,
      tagCounts: gridTagCounts,
    });
  }

  // 1.3.1 – ARIA role="tab" on non-button/non-anchor elements
  const tabRoleNodes = parsedDoc.querySelectorAll("[role='tab']");
  const nonInteractiveWithTabRole = tabRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "button" && tag !== "a";
  });
  if (nonInteractiveWithTabRole.length > 0) {
    const tabTagCounts: Record<string, number> = {};
    nonInteractiveWithTabRole.forEach((el) => {
      const tag = `<${el.tagName?.toLowerCase()}>`;
      tabTagCounts[tag] = (tabTagCounts[tag] ?? 0) + 1;
    });
    const tagList = Object.keys(tabTagCounts).slice(0, 5).join(", ");
    issues.push({
      criterion: "1.3.1",
      title: "ARIA Tab Role on Non-Interactive Element",
      level: "A",
      status: "warning",
      description: "Using role=\"tab\" on a non-interactive element (e.g. <div> or <span>) is a misuse of ARIA. Use a native <button> or <a> element instead.",
      details: `Found ${nonInteractiveWithTabRole.length} element(s) with role="tab" that are not native interactive elements (e.g. ${tagList}). Replace them with <button> or <a> for proper semantics.`,
      tagCounts: tabTagCounts,
    });
  }

  // 2.4.6 / 1.3.1 – Heading order: detect skipped heading levels
  const headingOrder = headingOrderInfo;
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

  // 2.4.4 – Vague link text
  const vaguePattern = /^(click here|here|read more|more|learn more|link|this link|this|details|info|more info|click|download|view|see more|continue)$/i;
  const linkTextRegex = new RegExp(`<a\\s${ATTR_PATTERN}>([\\s\\S]*?)<\\/a>`, "gi");
  const vagueLinks: string[] = [];
  let vagueMatch: RegExpExecArray | null;
  while ((vagueMatch = linkTextRegex.exec(html)) !== null) {
    const linkText = vagueMatch[1].replace(/<[^>]+>/g, "").trim();
    if (vaguePattern.test(linkText)) vagueLinks.push(`"${linkText}"`);
  }
  if (vagueLinks.length > 0) {
    issues.push({
      criterion: "2.4.4",
      title: "Link Purpose",
      level: "A",
      status: "warning",
      description: "Link text should describe where the link goes or what it does, so users can understand it without surrounding context.",
      details: `Found ${vagueLinks.length} link(s) with vague text: ${vagueLinks.slice(0, 5).join(", ")}. Replace with descriptive text like "Download the BSU Accessibility Guide".`,
    });
  }

  // 2.4.6 – Empty headings
  const emptyHeadings: string[] = [];
  const headingContentRegex = new RegExp(`<h([1-6])(?:${ATTR_PATTERN})>([\\s\\S]*?)<\\/h[1-6]>`, "gi");
  let hcMatch: RegExpExecArray | null;
  while ((hcMatch = headingContentRegex.exec(html)) !== null) {
    const text = hcMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!text) emptyHeadings.push(`<h${hcMatch[1]}>`);
  }
  if (emptyHeadings.length > 0) {
    issues.push({
      criterion: "2.4.6",
      title: "Empty Headings",
      level: "AA",
      status: "fail",
      description: "Headings must contain text. Empty headings confuse screen reader users who rely on headings to navigate documents.",
      details: `Found ${emptyHeadings.length} empty heading element(s): ${emptyHeadings.slice(0, 5).join(", ")}.`,
    });
  }

  // 1.3.1 – Fake lists (paragraphs using bullet characters instead of <ul>/<li>)
  const fakeBulletRegex = new RegExp(`<p${ATTR_PATTERN}>\\s*[•·▪▸►▶→✓✗⚫●○▷◆◇▼▽\\-\\*]{1}\\s+[^<\\s]`, "gi");
  const fakeBulletMatches = html.match(fakeBulletRegex) || [];
  if (fakeBulletMatches.length >= 3) {
    issues.push({
      criterion: "1.3.1",
      title: "List Markup",
      level: "A",
      status: "warning",
      description: "Content formatted as a list should use proper <ul> or <ol> markup so screen readers can announce it correctly as a list.",
      details: `Found ${fakeBulletMatches.length} paragraph(s) that appear to be list items (using bullet characters) but aren't marked up with <ul>/<li>. Convert these to proper list markup.`,
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

async function runAiAudit(html: string, signal?: AbortSignal): Promise<ComplianceIssue[]> {
  const AI_AUDIT_CHUNK_SIZE = 15000;
  const htmlToAudit = html.length > AI_AUDIT_CHUNK_SIZE ? html.substring(0, AI_AUDIT_CHUNK_SIZE) : html;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
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
  }, { signal } as any);

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

// ---------------------------------------------------------------------------
// Content Fidelity Review
//
// The compliance report above measures WCAG conformance, not whether the
// underlying academic content survived the conversion intact. This section
// adds a separate, advisory-only review that checks for text loss, broken
// sentence transitions introduced during chunked remediation, OCR/source
// quality concerns, and a plain-language summary of the heading structure.
// It never blocks export/download — it only surfaces findings for faculty.
// ---------------------------------------------------------------------------

export interface ContentFidelityFinding {
  type: "text-coverage" | "sentence-continuity" | "ocr-quality" | "heading-structure";
  status: "ok" | "warning";
  message: string;
  details?: string;
}

export interface ContentFidelityReport {
  textCoverageRatio: number;
  sourceWordCount: number;
  outputWordCount: number;
  ocrApplied: boolean;
  headingOutline: {
    levels: number[];
    hasSkippedLevels: boolean;
    skips: Array<{ from: number; to: number }>;
  };
  brokenTransitions: string[];
  overallStatus: "ok" | "warning";
  findings: ContentFidelityFinding[];
}

const contentFidelityFindingSchema = z.object({
  type: z.enum(["text-coverage", "sentence-continuity", "ocr-quality", "heading-structure"]),
  status: z.enum(["ok", "warning"]),
  message: z.string(),
  details: z.string().optional(),
});

export const contentFidelityReportSchema = z.object({
  textCoverageRatio: z.number(),
  sourceWordCount: z.number(),
  outputWordCount: z.number(),
  ocrApplied: z.boolean(),
  headingOutline: z.object({
    levels: z.array(z.number()),
    hasSkippedLevels: z.boolean(),
    skips: z.array(z.object({ from: z.number(), to: z.number() })),
  }),
  brokenTransitions: z.array(z.string()),
  overallStatus: z.enum(["ok", "warning"]),
  findings: z.array(contentFidelityFindingSchema),
});

const DEFAULT_TEXT_COVERAGE_WARNING_THRESHOLD = 0.85;

/** Reads the minimum acceptable text-coverage ratio (0-1) from the
 *  CONTENT_FIDELITY_COVERAGE_THRESHOLD env var, falling back to a sane default. */
export function getTextCoverageWarningThreshold(): number {
  const v = parseFloat(process.env.CONTENT_FIDELITY_COVERAGE_THRESHOLD ?? "");
  return isNaN(v) || v <= 0 || v > 1 ? DEFAULT_TEXT_COVERAGE_WARNING_THRESHOLD : v;
}

/** Strips HTML tags/scripts/styles down to plain, whitespace-normalised text. */
export function stripHtmlToPlainText(html: string): string {
  try {
    // Insert a newline after common block-level closing tags before parsing so
    // that adjacent blocks (e.g. "</p><p>") don't get their text concatenated
    // without a separator once tags are stripped — that would silently
    // undercount words and skew the text-coverage ratio.
    const withBlockBreaks = html.replace(
      /<\/(p|div|li|h[1-6]|tr|td|th|section|article|blockquote|ul|ol|table)>/gi,
      "</$1>\n"
    );
    const root = parseHtml(withBlockBreaks);
    root.querySelectorAll("script, style").forEach((el) => el.remove());
    return root.textContent.replace(/\s+/g, " ").trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Compares the word count of the originally-extracted source text against the
 * word count of the final accessible HTML to estimate how much content may
 * have been lost or truncated during AI remediation.
 */
export function computeTextCoverage(
  sourceText: string,
  accessibleHtml: string
): { ratio: number; sourceWordCount: number; outputWordCount: number } {
  const outputText = stripHtmlToPlainText(accessibleHtml);
  const sourceWordCount = countWords(sourceText);
  const outputWordCount = countWords(outputText);
  const ratio =
    sourceWordCount > 0
      ? Math.min(1, outputWordCount / sourceWordCount)
      : outputWordCount > 0
        ? 1
        : 0;
  return { ratio, sourceWordCount, outputWordCount };
}

/**
 * Heuristically flags block-level elements (paragraphs, list items, table
 * cells) that end without terminal punctuation immediately before a block
 * that begins with a lowercase letter — a common signature of a sentence
 * that was cut off or split awkwardly across a chunk boundary during
 * remediation. Short fragments (labels, captions) are ignored to reduce
 * false positives.
 */
export function detectBrokenTransitions(html: string): string[] {
  let blocks: string[] = [];
  try {
    const root = parseHtml(html);
    blocks = root
      .querySelectorAll("p, li, td, th, blockquote")
      .map((el) => el.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  } catch {
    return [];
  }

  const endsMidSentence = /[a-z,;:\-]$/;
  const startsLowercaseContinuation = /^[a-z]/;
  const issues: string[] = [];

  for (let i = 0; i < blocks.length - 1; i++) {
    const cur = blocks[i];
    const next = blocks[i + 1];
    if (cur.length < 20 || next.length < 5) continue;
    if (endsMidSentence.test(cur) && startsLowercaseContinuation.test(next)) {
      issues.push(`"...${cur.slice(-40)}" \u2192 "${next.slice(0, 40)}..."`);
    }
    if (issues.length >= 10) break;
  }

  return issues;
}

/** Produces a full heading outline (not just pass/fail) for a plain-language summary. */
export function summarizeHeadingStructure(html: string): {
  levels: number[];
  hasSkippedLevels: boolean;
  skips: Array<{ from: number; to: number }>;
  headingCount: number;
} {
  const order = checkHeadingOrder(html);
  return { ...order, headingCount: order.levels.length };
}

/**
 * Builds the advisory Content Fidelity report for a completed conversion.
 * This is separate from — and never affects — the WCAG compliance report or
 * the ability to export/download the document.
 */
export function buildContentFidelityReport(
  sourceText: string,
  accessibleHtml: string,
  ocrApplied: boolean
): ContentFidelityReport {
  const findings: ContentFidelityFinding[] = [];

  const { ratio, sourceWordCount, outputWordCount } = computeTextCoverage(sourceText, accessibleHtml);
  const threshold = getTextCoverageWarningThreshold();
  const coverageOk = sourceWordCount === 0 || ratio >= threshold;
  findings.push({
    type: "text-coverage",
    status: coverageOk ? "ok" : "warning",
    message: coverageOk
      ? "The converted document appears to contain all of the original text."
      : `The converted document may be missing some content — it contains about ${Math.round(ratio * 100)}% of the original word count. Please review the full document.`,
    details: `Source: ~${sourceWordCount} words. Converted output: ~${outputWordCount} words.`,
  });

  const brokenTransitions = detectBrokenTransitions(accessibleHtml);
  findings.push({
    type: "sentence-continuity",
    status: brokenTransitions.length > 0 ? "warning" : "ok",
    message:
      brokenTransitions.length > 0
        ? `Found ${brokenTransitions.length} spot(s) where a sentence may have been cut off or split awkwardly during conversion. Please review these sections.`
        : "No obvious broken sentence transitions were detected.",
  });

  findings.push({
    type: "ocr-quality",
    status: ocrApplied ? "warning" : "ok",
    message: ocrApplied
      ? "This document appeared to be a scanned/image-based file, so text was extracted using OCR. Please double-check the converted text for accuracy, especially on pages with complex layouts, handwriting, or unusual fonts."
      : "This document's text was extracted directly from the source file (no OCR was needed).",
  });

  const headingOutline = summarizeHeadingStructure(accessibleHtml);
  findings.push({
    type: "heading-structure",
    status: headingOutline.hasSkippedLevels ? "warning" : "ok",
    message: headingOutline.hasSkippedLevels
      ? `The document has ${headingOutline.headingCount} heading(s), but some heading levels are skipped (e.g. jumping from an H${headingOutline.skips[0]?.from} to an H${headingOutline.skips[0]?.to}), which can be confusing for screen reader users.`
      : `The document has ${headingOutline.headingCount} heading(s) with a consistent structure.`,
  });

  const overallStatus = findings.some((f) => f.status === "warning") ? "warning" : "ok";

  return {
    textCoverageRatio: ratio,
    sourceWordCount,
    outputWordCount,
    ocrApplied,
    headingOutline: {
      levels: headingOutline.levels,
      hasSkippedLevels: headingOutline.hasSkippedLevels,
      skips: headingOutline.skips,
    },
    brokenTransitions,
    overallStatus,
    findings,
  };
}

export function applyAriaLinkRoleFix(html: string): string {
  const root = parseHtml(html);
  let result = html;

  const linkRoleNodes = root.querySelectorAll("[role='link']");
  const nonAnchors = linkRoleNodes.filter((el) => el.tagName?.toLowerCase() !== "a");

  for (const el of nonAnchors) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "div";
    const openTagMatch = outerHtml.match(new RegExp(`^<${escapeRegex(tag)}(${ATTR_PATTERN})>`, "i"));
    if (!openTagMatch) continue;
    const innerHtml = outerHtml.slice(
      openTagMatch[0].length,
      outerHtml.lastIndexOf(`</${tag}>`)
    );
    let attrs = openTagMatch[1]
      .replace(/\s*role\s*=\s*["']link["']/gi, "")
      .trim();
    if (!/\bhref\s*=/i.test(attrs)) {
      attrs = attrs ? `href="#" ${attrs}` : `href="#"`;
    }
    const replacement = `<a${attrs ? " " + attrs : ""}>${innerHtml}</a>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

export function applyAriaCheckboxRoleFix(html: string): string {
  const root = parseHtml(html);
  let result = html;

  const checkboxRoleNodes = root.querySelectorAll("[role='checkbox']");
  const wrongElements = checkboxRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return type !== "checkbox";
    }
    return true;
  });

  for (const el of wrongElements) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "";

    if (tag === "input") {
      const replacement = outerHtml
        .replace(/\s*role\s*=\s*["']checkbox["']/gi, "")
        .replace(/\s*type\s*=\s*["'][^"']*["']/gi, "")
        .replace(/^<input/i, '<input type="checkbox"');
      result = result.replace(outerHtml, replacement);
    } else {
      const innerHtml = el.innerHTML ?? "";
      if (innerHtml.includes("<")) {
        result = result.replace(outerHtml, `<label><input type="checkbox"> ${innerHtml}</label>`);
      } else {
        const labelText = innerHtml.trim();
        const ariaLabel = labelText ? ` aria-label="${labelText.replace(/"/g, "&quot;")}"` : "";
        result = result.replace(outerHtml, `<input type="checkbox"${ariaLabel}>`);
      }
    }
  }

  return result;
}

export function applyAriaRadioRoleFix(html: string): string {
  const root = parseHtml(html);
  let result = html;

  const radioRoleNodes = root.querySelectorAll("[role='radio']");
  const wrongElements = radioRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return type !== "radio";
    }
    return true;
  });

  for (const el of wrongElements) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "";

    if (tag === "input") {
      const replacement = outerHtml
        .replace(/\s*role\s*=\s*["']radio["']/gi, "")
        .replace(/\s*type\s*=\s*["'][^"']*["']/gi, "")
        .replace(/^<input/i, '<input type="radio"');
      result = result.replace(outerHtml, replacement);
    } else {
      const innerHtml = el.innerHTML ?? "";
      if (innerHtml.includes("<")) {
        result = result.replace(outerHtml, `<label><input type="radio"> ${innerHtml}</label>`);
      } else {
        const labelText = innerHtml.trim();
        const ariaLabel = labelText ? ` aria-label="${labelText.replace(/"/g, "&quot;")}"` : "";
        result = result.replace(outerHtml, `<input type="radio"${ariaLabel}>`);
      }
    }
  }

  return result;
}

export function applyAriaListRoleFix(html: string): string {
  const root = parseHtml(html);
  let result = html;

  const listRoleNodes = root.querySelectorAll("[role='list']");
  const nonLists = listRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return tag !== "ul" && tag !== "ol";
  });

  for (const el of nonLists) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "div";
    const openTagMatch = outerHtml.match(new RegExp(`^<${escapeRegex(tag)}(${ATTR_PATTERN})>`, "i"));
    if (!openTagMatch) continue;
    const innerHtml = outerHtml.slice(
      openTagMatch[0].length,
      outerHtml.lastIndexOf(`</${tag}>`)
    );
    const attrs = openTagMatch[1]
      .replace(/\s*role\s*=\s*["']list["']/gi, "")
      .trim();
    const replacement = `<ul${attrs ? " " + attrs : ""}>${innerHtml}</ul>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

export function applyAriaListitemRoleFix(html: string): string {
  const root = parseHtml(html);
  let result = html;

  const listitemRoleNodes = root.querySelectorAll("[role='listitem']");
  const nonListitems = listitemRoleNodes.filter((el) => el.tagName?.toLowerCase() !== "li");

  for (const el of nonListitems) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "div";
    const openTagMatch = outerHtml.match(new RegExp(`^<${escapeRegex(tag)}(${ATTR_PATTERN})>`, "i"));
    if (!openTagMatch) continue;
    const innerHtml = outerHtml.slice(
      openTagMatch[0].length,
      outerHtml.lastIndexOf(`</${tag}>`)
    );
    const attrs = openTagMatch[1]
      .replace(/\s*role\s*=\s*["']listitem["']/gi, "")
      .trim();
    const replacement = `<li${attrs ? " " + attrs : ""}>${innerHtml}</li>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

export function applyAriaRoleHeaderFix(html: string): string {
  const root = parseHtml(html);
  let result = html;

  const columnHeaders = root.querySelectorAll('td[role="columnheader"]');
  const rowHeaders = root.querySelectorAll('td[role="rowheader"]');

  const entries: Array<{ outerHtml: string; scope: "col" | "row" }> = [
    ...Array.from(columnHeaders).map((td) => ({ outerHtml: td.outerHTML, scope: "col" as const })),
    ...Array.from(rowHeaders).map((td) => ({ outerHtml: td.outerHTML, scope: "row" as const })),
  ];

  for (const { outerHtml, scope } of entries) {
    const openTagMatch = outerHtml.match(new RegExp(`^<td(${ATTR_PATTERN})>`, "i"));
    if (!openTagMatch) continue;
    const innerHtml = outerHtml.slice(openTagMatch[0].length, outerHtml.lastIndexOf("</td>"));
    const attrs = openTagMatch[1]
      .replace(/\s*role="(?:columnheader|rowheader)"/gi, "")
      .trim();
    const newOpenTag = `<th scope="${scope}"${attrs ? " " + attrs : ""}>`;
    const replacement = `${newOpenTag}${innerHtml}</th>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

export function applyLangAttributeFix(html: string): string {
  if (new RegExp(`<html${ATTR_PATTERN}\\slang\\s*=`, "i").test(html)) return html;
  return html.replace(new RegExp(`<html(${ATTR_PATTERN})>`, "i"), (_match, attrs: string) => `<html${attrs} lang="en">`);
}

/**
 * Ensures the document's heading hierarchy starts at H1. If the topmost
 * heading is anything else (e.g. H2), every heading in the document is
 * shifted down by the same offset so the first heading becomes H1 and the
 * relative structure of subsequent headings is preserved (no new skips are
 * introduced relative to the corrected top level). Levels are clamped to the
 * valid 1–6 range. Documents that already start at H1, or that have no
 * headings at all, are returned unchanged.
 */
export function applyHeadingHierarchyFix(html: string): string {
  const firstHeadingMatch = html.match(/<h([1-6])(?=[\s>/])/i);
  if (!firstHeadingMatch) return html;

  const firstLevel = parseInt(firstHeadingMatch[1], 10);
  if (firstLevel === 1) return html;

  const delta = firstLevel - 1;

  return html.replace(/<(\/?)h([1-6])(?=[\s>/])/gi, (_match, closing: string, level: string) => {
    const newLevel = Math.max(1, Math.min(6, parseInt(level, 10) - delta));
    return `<${closing}h${newLevel}`;
  });
}

/**
 * Returns the level (1-6) of the first heading element in the document, or
 * null when the document has no headings. Used alongside
 * `applyHeadingHierarchyFix` to detect (without changing its logic) whether
 * that fixer actually renumbered anything, so the change can be surfaced to
 * faculty in the compliance report.
 */
function getFirstHeadingLevel(html: string): number | null {
  const firstHeadingMatch = html.match(/<h([1-6])(?=[\s>/])/i);
  return firstHeadingMatch ? parseInt(firstHeadingMatch[1], 10) : null;
}

/**
 * When `applyHeadingHierarchyFix` renumbered the document's headings (i.e.
 * the topmost heading was not already an H1), attaches a `fixNotes`
 * explanation to the "2.4.6 / Headings and Labels" issue so faculty can see
 * that the auto-fixer changed their heading structure, rather than only
 * seeing a silent "pass".
 */
function applyHeadingHierarchyFixNotes(
  issues: ComplianceIssue[],
  preFixFirstHeadingLevel: number | null
): void {
  if (!preFixFirstHeadingLevel || preFixFirstHeadingLevel === 1) return;

  const delta = preFixFirstHeadingLevel - 1;
  const headingIssueIdx = issues.findIndex(
    (iss) => iss.criterion === "2.4.6" && iss.title === "Headings and Labels"
  );
  if (headingIssueIdx < 0) return;

  issues[headingIssueIdx] = {
    ...issues[headingIssueIdx],
    fixNotes: `Heading levels were automatically renumbered: the document's topmost heading was an H${preFixFirstHeadingLevel} instead of H1, so every heading was shifted by ${delta} level${delta === 1 ? "" : "s"} to close the gap and restore a valid hierarchy. Review the heading levels to confirm they still reflect your intended document structure.`,
  };
}

const BYPASS_LANDMARK_TAGS = new Set(["header", "nav", "footer"]);
const BYPASS_LANDMARK_ROLES = new Set(["banner", "navigation", "contentinfo"]);

function isBypassLandmarkNode(node: any): boolean {
  if (BYPASS_LANDMARK_TAGS.has(node.tagName?.toLowerCase() ?? "")) return true;
  const role = (node.getAttribute?.("role") ?? "").toLowerCase().trim();
  return BYPASS_LANDMARK_ROLES.has(role);
}

/**
 * Returns true when the document body contains at least one landmark element
 * (header/nav/footer or their ARIA role equivalents) but has no non-landmark
 * content — i.e. there is nothing to wrap in a <main> element.
 */
export function isAllLandmarksNoContent(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;

  const inner = bodyMatch[1];
  const root = parseHtml(inner);
  const children = root.childNodes;

  const hasAnyLandmark = children.some((n) => isBypassLandmarkNode(n));
  if (!hasAnyLandmark) return false;

  const nonLandmarkContent = children
    .filter((n) => !isBypassLandmarkNode(n))
    .map((n) => (n as any).outerHTML ?? (n as any).rawText ?? "")
    .join("")
    .trim();

  return nonLandmarkContent === "";
}

export function applyBypassBlocksFix(html: string): string {
  if (/<main[\s>]/i.test(html) || /role\s*=\s*["']main["']/i.test(html)) return html;

  const landmarkTags = BYPASS_LANDMARK_TAGS;
  const landmarkRoles = BYPASS_LANDMARK_ROLES;

  function isLandmarkNode(node: any): boolean {
    if (landmarkTags.has(node.tagName?.toLowerCase() ?? "")) return true;
    const role = (node.getAttribute?.("role") ?? "").toLowerCase().trim();
    return landmarkRoles.has(role);
  }

  return html.replace(new RegExp(`(<body${ATTR_PATTERN}>)([\\s\\S]*?)(<\\/body>)`, "i"), (_match, open, inner, close) => {
    const root = parseHtml(inner);
    const children = root.childNodes;

    const hasTopLevelLandmarks = children.some((node) => isLandmarkNode(node));

    if (!hasTopLevelLandmarks) {
      return `${open}<main>${inner}</main>${close}`;
    }

    // Separate into landmark elements (header/nav/footer or ARIA role equivalents)
    // and non-landmark content. All non-landmark content is grouped into a single
    // <main> placed at the position of the first non-landmark child; landmark
    // elements remain as siblings.
    const parts: Array<{ isLandmark: boolean; html: string }> = [];
    for (const node of children) {
      const nodeStr: string = (node as any).outerHTML ?? (node as any).rawText ?? "";
      parts.push({ isLandmark: isLandmarkNode(node), html: nodeStr });
    }

    const nonLandmarkHtml = parts
      .filter((p) => !p.isLandmark)
      .map((p) => p.html)
      .join("");

    let newBody = "";
    let mainWritten = false;

    for (const part of parts) {
      if (part.isLandmark) {
        newBody += part.html;
      } else if (!mainWritten) {
        if (nonLandmarkHtml.trim()) {
          newBody += `<main>${nonLandmarkHtml}</main>`;
        }
        mainWritten = true;
      }
      // Subsequent non-landmark nodes are already included inside <main> above.
    }

    if (!mainWritten && nonLandmarkHtml.trim()) {
      newBody += `<main>${nonLandmarkHtml}</main>`;
    }

    return `${open}${newBody}${close}`;
  });
}

export function extractPageTitleInfo(html: string): { title: string; headingLevel: "h1" | "h2" | null } {
  const h1Match = html.match(new RegExp(`<h1${ATTR_PATTERN}>([\\s\\S]*?)<\\/h1>`, "i"));
  if (h1Match) {
    const text = h1Match[1].replace(/<[^>]+>/g, "").trim();
    if (text) return { title: text, headingLevel: "h1" };
  }
  const h2Match = html.match(new RegExp(`<h2${ATTR_PATTERN}>([\\s\\S]*?)<\\/h2>`, "i"));
  if (h2Match) {
    const text = h2Match[1].replace(/<[^>]+>/g, "").trim();
    if (text) return { title: text, headingLevel: "h2" };
  }
  return { title: "Document", headingLevel: null };
}

export function applyPageTitleFix(html: string): string {
  function getTitle(): string {
    return extractPageTitleInfo(html).title;
  }

  if (/<title>\s*<\/title>/i.test(html)) {
    return html.replace(/<title>\s*<\/title>/i, `<title>${getTitle()}</title>`);
  }
  if (!/<title>[^<]+<\/title>/i.test(html)) {
    const title = getTitle();
    if (new RegExp(`<head${ATTR_PATTERN}>`, "i").test(html)) {
      return html.replace(new RegExp(`(<head${ATTR_PATTERN}>)`, "i"), `$1<title>${title}</title>`);
    }
    return html.replace(new RegExp(`(<html${ATTR_PATTERN}>)`, "i"), `$1<head><title>${title}</title></head>`);
  }
  return html;
}

function replaceAriaRoleElements(
  html: string,
  roleValue: string,
  isAllowedTag: (tag: string) => boolean,
  newTag: string,
  buildOpenTag: (attrs: string) => string
): string {
  const root = parseHtml(html);
  let result = html;

  const nodes = root.querySelectorAll(`[role='${roleValue}']`);
  const targets = nodes.filter((el) => !isAllowedTag(el.tagName?.toLowerCase() ?? ""));

  for (const el of targets) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "div";
    const openTagRegex = new RegExp(`^<${escapeRegex(tag)}(${ATTR_PATTERN})>`, "i");
    const openTagMatch = outerHtml.match(openTagRegex);
    if (!openTagMatch) continue;
    const closeTagIdx = outerHtml.lastIndexOf(`</${tag}>`);
    if (closeTagIdx === -1) continue;
    const innerHtml = outerHtml.slice(openTagMatch[0].length, closeTagIdx);
    const attrs = openTagMatch[1]
      .replace(new RegExp(`\\s*role\\s*=\\s*["']${escapeRegex(roleValue)}["']`, "gi"), "")
      .trim();
    const replacement = `${buildOpenTag(attrs)}${innerHtml}</${newTag}>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

export function applyAriaButtonRoleFix(html: string): string {
  const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset", "image"]);
  const root = parseHtml(html);
  let result = html;

  const buttonRoleNodes = root.querySelectorAll("[role='button']");
  const targets = buttonRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "button") return false;
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return !BUTTON_INPUT_TYPES.has(type);
    }
    return true;
  });

  for (const el of targets) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "div";

    if (tag === "input") {
      const replacement = outerHtml.replace(/\s*role\s*=\s*["']button["']/gi, "");
      result = result.replace(outerHtml, replacement);
      continue;
    }

    const openTagMatch = outerHtml.match(new RegExp(`^<${escapeRegex(tag)}(${ATTR_PATTERN})>`, "i"));
    if (!openTagMatch) continue;
    const closeTagIdx = outerHtml.lastIndexOf(`</${tag}>`);
    if (closeTagIdx === -1) continue;
    const innerHtml = outerHtml.slice(openTagMatch[0].length, closeTagIdx);
    const attrs = openTagMatch[1]
      .replace(/\s*role\s*=\s*["']button["']/gi, "")
      .trim();
    const replacement = `<button${attrs ? " " + attrs : ""}>${innerHtml}</button>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

export function applyAriaHeadingRoleFix(html: string): string {
  const root = parseHtml(html);
  let result = html;

  const headingRoleNodes = root.querySelectorAll("[role='heading']");
  const targets = headingRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return !/^h[1-6]$/.test(tag ?? "");
  });

  if (targets.length === 0) return result;

  // Walk the DOM in document order (DFS pre-order) to assign a stable ordinal
  // to every node.  Using node object identity as the key means the mapping is
  // correct even when multiple elements share the same outerHTML string.
  const nodeOrder = new Map<object, number>();
  let ordinal = 0;
  function walkDocumentOrder(node: { childNodes?: object[] }): void {
    nodeOrder.set(node, ordinal++);
    for (const child of node.childNodes ?? []) {
      walkDocumentOrder(child as { childNodes?: object[] });
    }
  }
  walkDocumentOrder(root);

  // Seed the context pool with native headings (h1-h6).  As each target is
  // processed below it is also added to the pool so that later targets can
  // inherit context from earlier ARIA headings (explicit or inferred).
  const contextPool: Array<{ level: number; ordinal: number }> = [];
  for (let lvl = 1; lvl <= 6; lvl++) {
    for (const hEl of root.querySelectorAll(`h${lvl}`)) {
      const ord = nodeOrder.get(hEl);
      if (ord !== undefined) {
        contextPool.push({ level: lvl, ordinal: ord });
      }
    }
  }

  // Process targets in document order so each resolved element can contribute
  // context to those that follow.
  const sortedTargets = [...targets].sort(
    (a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0)
  );

  for (const el of sortedTargets) {
    const outerHtml = el.outerHTML;
    const tag = el.tagName?.toLowerCase() ?? "div";
    const openTagMatch = outerHtml.match(new RegExp(`^<${escapeRegex(tag)}(${ATTR_PATTERN})>`, "i"));
    if (!openTagMatch) continue;
    const closeTagIdx = outerHtml.lastIndexOf(`</${tag}>`);
    if (closeTagIdx === -1) continue;
    const innerHtml = outerHtml.slice(openTagMatch[0].length, closeTagIdx);

    const ariaLevel = el.getAttribute("aria-level");
    const targetOrdinal = nodeOrder.get(el) ?? -1;
    let level: number;
    if (ariaLevel) {
      level = Math.min(Math.max(parseInt(ariaLevel, 10) || 2, 1), 6);
    } else {
      // Infer from the last heading (native or ARIA) that precedes this element
      // in document order.  Falls back to h2 when no prior heading exists.
      const preceding = contextPool
        .filter((h) => h.ordinal < targetOrdinal)
        .sort((a, b) => b.ordinal - a.ordinal);
      level = preceding.length > 0 ? preceding[0].level : 2;
    }

    // Register this element so later siblings can use its resolved level.
    if (targetOrdinal >= 0) {
      contextPool.push({ level, ordinal: targetOrdinal });
    }

    const headingTag = `h${level}`;
    const attrs = openTagMatch[1]
      .replace(/\s*role\s*=\s*["']heading["']/gi, "")
      .replace(/\s*aria-level\s*=\s*["'][^"']*["']/gi, "")
      .trim();
    const replacement = `<${headingTag}${attrs ? " " + attrs : ""}>${innerHtml}</${headingTag}>`;
    result = result.replace(outerHtml, replacement);
  }

  return result;
}

function countAriaButtonRoleTargets(html: string): number {
  const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset", "image"]);
  const root = parseHtml(html);
  const nodes = root.querySelectorAll("[role='button']");
  return nodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "button") return false;
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return !BUTTON_INPUT_TYPES.has(type);
    }
    return true;
  }).length;
}

function countAriaHeadingRoleTargets(html: string): number {
  const root = parseHtml(html);
  const nodes = root.querySelectorAll("[role='heading']");
  return nodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return !/^h[1-6]$/.test(tag ?? "");
  }).length;
}

export interface AriaHeadingFallbackAnalysis {
  fallbackCount: number;
  inferredCount: number;
}

export function analyzeAriaHeadingFallbacks(html: string): AriaHeadingFallbackAnalysis {
  const root = parseHtml(html);

  const headingRoleNodes = root.querySelectorAll("[role='heading']");
  const targets = headingRoleNodes.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    return !/^h[1-6]$/.test(tag ?? "");
  });

  if (targets.length === 0) return { fallbackCount: 0, inferredCount: 0 };

  const nodeOrder = new Map<object, number>();
  let ordinal = 0;
  function walkDocumentOrder(node: { childNodes?: object[] }): void {
    nodeOrder.set(node, ordinal++);
    for (const child of node.childNodes ?? []) {
      walkDocumentOrder(child as { childNodes?: object[] });
    }
  }
  walkDocumentOrder(root);

  const contextPool: Array<{ level: number; ordinal: number }> = [];
  for (let lvl = 1; lvl <= 6; lvl++) {
    for (const hEl of root.querySelectorAll(`h${lvl}`)) {
      const ord = nodeOrder.get(hEl);
      if (ord !== undefined) {
        contextPool.push({ level: lvl, ordinal: ord });
      }
    }
  }

  const sortedTargets = [...targets].sort(
    (a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0)
  );

  let fallbackCount = 0;
  let inferredCount = 0;

  for (const el of sortedTargets) {
    const ariaLevel = el.getAttribute("aria-level");
    const targetOrdinal = nodeOrder.get(el) ?? -1;
    if (!ariaLevel) {
      const preceding = contextPool
        .filter((h) => h.ordinal < targetOrdinal)
        .sort((a, b) => b.ordinal - a.ordinal);
      if (preceding.length > 0) {
        inferredCount++;
        contextPool.push({ level: preceding[0].level, ordinal: targetOrdinal });
      } else {
        fallbackCount++;
        contextPool.push({ level: 2, ordinal: targetOrdinal });
      }
    } else {
      const level = Math.min(Math.max(parseInt(ariaLevel, 10) || 2, 1), 6);
      contextPool.push({ level, ordinal: targetOrdinal });
    }
  }

  return { fallbackCount, inferredCount };
}

export function applyAriaComboboxRoleFix(html: string): string {
  return replaceAriaRoleElements(
    html,
    "combobox",
    (tag) => tag === "select" || tag === "input",
    "select",
    (attrs) => `<select${attrs ? " " + attrs : ""}>`
  );
}

export function applyAriaGridRoleFix(html: string): string {
  return replaceAriaRoleElements(
    html,
    "grid",
    (tag) => tag === "table",
    "table",
    (attrs) => `<table${attrs ? " " + attrs : ""}>`
  );
}

export function applyAriaTabRoleFix(html: string): string {
  return replaceAriaRoleElements(
    html,
    "tab",
    (tag) => tag === "button" || tag === "a",
    "button",
    (attrs) => `<button${attrs ? " " + attrs : ""}>`
  );
}

function countAriaFixerTargets(html: string): number {
  const root = parseHtml(html);
  let count = 0;

  count += root.querySelectorAll('td[role="columnheader"], td[role="rowheader"]').length;

  count += root.querySelectorAll("[role='link']")
    .filter((el) => el.tagName?.toLowerCase() !== "a").length;

  count += root.querySelectorAll("[role='checkbox']")
    .filter((el) => {
      const tag = el.tagName?.toLowerCase();
      return tag !== "input" || (el.getAttribute("type") ?? "").toLowerCase() !== "checkbox";
    }).length;

  count += root.querySelectorAll("[role='radio']")
    .filter((el) => {
      const tag = el.tagName?.toLowerCase();
      return tag !== "input" || (el.getAttribute("type") ?? "").toLowerCase() !== "radio";
    }).length;

  count += root.querySelectorAll("[role='list']")
    .filter((el) => {
      const tag = el.tagName?.toLowerCase();
      return tag !== "ul" && tag !== "ol";
    }).length;

  count += root.querySelectorAll("[role='listitem']")
    .filter((el) => el.tagName?.toLowerCase() !== "li").length;

  count += root.querySelectorAll("[role='combobox']")
    .filter((el) => {
      const tag = el.tagName?.toLowerCase();
      return tag !== "select" && tag !== "input";
    }).length;

  count += root.querySelectorAll("[role='grid']")
    .filter((el) => el.tagName?.toLowerCase() !== "table").length;

  count += root.querySelectorAll("[role='tab']")
    .filter((el) => {
      const tag = el.tagName?.toLowerCase();
      return tag !== "button" && tag !== "a";
    }).length;

  return count;
}

export function fixAllAriaRoleMisuse(
  currentHtml: string,
  existingReport: ComplianceReport
): AccessibilityResult {
  const headingFallbackAnalysis = analyzeAriaHeadingFallbacks(currentHtml);

  const ariaFixers = [
    applyAriaRoleHeaderFix,
    applyAriaLinkRoleFix,
    applyAriaCheckboxRoleFix,
    applyAriaRadioRoleFix,
    applyAriaListRoleFix,
    applyAriaListitemRoleFix,
    applyAriaComboboxRoleFix,
    applyAriaGridRoleFix,
    applyAriaTabRoleFix,
  ];

  const elementsFixed = countAriaFixerTargets(currentHtml);
  const fixedHtml = ariaFixers.reduce((html, fixer) => fixer(html), currentHtml);

  const freshChecks = runDeterministicChecks(fixedHtml);
  const freshMap = new Map<string, ComplianceIssue>();
  for (const fi of freshChecks) {
    freshMap.set(`${fi.criterion}::${fi.title}`, fi);
  }

  const updatedIssues = existingReport.issues.map((issue) => {
    if (issue.status === "fixed") {
      return issue;
    }
    const key = `${issue.criterion}::${issue.title}`;
    const freshCheck = freshMap.get(key);
    if (freshCheck) {
      if (freshCheck.status === "pass" && (issue.status === "fail" || issue.status === "warning")) {
        return { ...freshCheck, status: "fixed" as const };
      }
      return { ...freshCheck };
    }
    if (issue.title.includes("ARIA") && (issue.status === "fail" || issue.status === "warning")) {
      return { ...issue, status: "fixed" as const, details: `Fixed: ${issue.details}` };
    }
    return issue;
  });

  const { fallbackCount, inferredCount } = headingFallbackAnalysis;
  if (fallbackCount > 0 || inferredCount > 0) {
    const parts: string[] = [];
    if (fallbackCount > 0) {
      parts.push(
        `${fallbackCount} heading${fallbackCount === 1 ? "" : "s"} had no aria-level and no surrounding heading context — defaulted to <h2>. Review these headings and adjust the level if needed.`
      );
    }
    if (inferredCount > 0) {
      parts.push(
        `${inferredCount} heading${inferredCount === 1 ? "" : "s"} had no aria-level and used the level of the nearest preceding heading. Verify the inferred level is correct.`
      );
    }
    const fixNotes = parts.join(" ");
    const headingIssueIdx = updatedIssues.findIndex(
      (iss) => iss.criterion === "1.3.1" && iss.title === "ARIA Heading Role on Non-Heading Element"
    );
    if (headingIssueIdx >= 0) {
      updatedIssues[headingIssueIdx] = { ...updatedIssues[headingIssueIdx], fixNotes };
    }
  }

  return { accessibleHtml: fixedHtml, complianceReport: buildComplianceReport(updatedIssues), elementsFixed };
}

export type DeterministicFixer = (html: string) => string;

const deterministicFixerRegistry: Record<string, DeterministicFixer> = {
  "1.3.1::ARIA Role on Table Data Cell": applyAriaRoleHeaderFix,
  "3.1.1::Language of Page": applyLangAttributeFix,
  "2.4.1::Bypass Blocks": applyBypassBlocksFix,
  "2.4.2::Page Titled": applyPageTitleFix,
  "2.4.6::Headings and Labels": applyHeadingHierarchyFix,
  "1.3.1::ARIA Combobox Role on Non-Combobox Element": applyAriaComboboxRoleFix,
  "1.3.1::ARIA Grid Role on Non-Table Element": applyAriaGridRoleFix,
  "1.3.1::ARIA Tab Role on Non-Interactive Element": applyAriaTabRoleFix,
  "4.1.2::ARIA Button Role on Non-Button Element": applyAriaButtonRoleFix,
  "1.3.1::ARIA Heading Role on Non-Heading Element": applyAriaHeadingRoleFix,
  "4.1.2::ARIA Link Role on Non-Anchor Element": applyAriaLinkRoleFix,
  "4.1.2::ARIA Checkbox Role on Non-Input Element": applyAriaCheckboxRoleFix,
  "4.1.2::ARIA Radio Role on Non-Input Element": applyAriaRadioRoleFix,
  "1.3.1::ARIA List Role on Non-List Element": applyAriaListRoleFix,
  "1.3.1::ARIA Listitem Role on Non-Listitem Element": applyAriaListitemRoleFix,
  "1.3.1::Duplicate Table Captions": fixDuplicateTableCaptions,
};

export function registerDeterministicFixer(key: string, fn: DeterministicFixer): void {
  deterministicFixerRegistry[key] = fn;
}

export function getDeterministicFixerKeys(): string[] {
  return Object.keys(deterministicFixerRegistry);
}

export function applyDeterministicReport(
  fixedHtml: string,
  issue: ComplianceIssue,
  issueIndex: number,
  updatedIssues: ComplianceIssue[]
): void {
  const deterministicIssues = runDeterministicChecks(fixedHtml);
  const deterministicMap = new Map<string, ComplianceIssue>();
  for (const di of deterministicIssues) {
    deterministicMap.set(`${di.criterion}::${di.title}`, di);
  }
  for (let i = 0; i < updatedIssues.length; i++) {
    const key = `${updatedIssues[i].criterion}::${updatedIssues[i].title}`;
    const freshCheck = deterministicMap.get(key);
    if (freshCheck && updatedIssues[i].status !== "fixed") {
      updatedIssues[i] = { ...freshCheck };
    }
  }
  if (issueIndex >= 0 && issueIndex < updatedIssues.length) {
    const targetIssue = updatedIssues[issueIndex];
    if (targetIssue.criterion === issue.criterion && targetIssue.title === issue.title) {
      const freshCheck = deterministicMap.get(`${issue.criterion}::${issue.title}`);
      if (freshCheck) {
        let updated: ComplianceIssue = freshCheck.status === "pass"
          ? { ...freshCheck, status: "fixed" }
          : { ...freshCheck };
        if (issue.criterion === "2.4.2" && updated.status === "fixed") {
          const { title, headingLevel } = extractPageTitleInfo(fixedHtml);
          if (headingLevel) {
            updated = { ...updated, details: `Title set to '${title}' from the first <${headingLevel}>` };
          }
        }
        updatedIssues[issueIndex] = updated;
      } else {
        updatedIssues[issueIndex] = { ...targetIssue, status: "fixed", details: `Fixed: ${targetIssue.details}` };
      }
    }
  }
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
  if (issue.title === "Fix all ARIA role misuse") {
    return fixAllAriaRoleMisuse(currentHtml, existingReport);
  }

  const registryKey = `${issue.criterion}::${issue.title}`;
  const deterministicFixer = deterministicFixerRegistry[registryKey];
  if (deterministicFixer) {
    const isHeadingFix = registryKey === "1.3.1::ARIA Heading Role on Non-Heading Element";
    const isButtonFix = registryKey === "4.1.2::ARIA Button Role on Non-Button Element";
    const isHeadingHierarchyFix = registryKey === "2.4.6::Headings and Labels";
    const headingFallbackAnalysis = isHeadingFix
      ? analyzeAriaHeadingFallbacks(currentHtml)
      : null;
    const preHeadingHierarchyFixLevel = isHeadingHierarchyFix
      ? getFirstHeadingLevel(currentHtml)
      : null;

    const isBypassFix = registryKey === "2.4.1::Bypass Blocks";
    const elementsFixed: number | undefined = isButtonFix
      ? countAriaButtonRoleTargets(currentHtml)
      : isHeadingFix
        ? countAriaHeadingRoleTargets(currentHtml)
        : undefined;

    const allLandmarksEdgeCase = isBypassFix && isAllLandmarksNoContent(currentHtml);

    const fixedHtml = deterministicFixer(currentHtml);
    const updatedIssues = [...existingReport.issues];
    applyDeterministicReport(fixedHtml, issue, issueIndex, updatedIssues);

    if (isHeadingFix && headingFallbackAnalysis && issueIndex >= 0 && issueIndex < updatedIssues.length) {
      const { fallbackCount, inferredCount } = headingFallbackAnalysis;
      const parts: string[] = [];
      if (fallbackCount > 0) {
        parts.push(
          `${fallbackCount} heading${fallbackCount === 1 ? "" : "s"} had no aria-level and no surrounding heading context — defaulted to <h2>. Review these headings and adjust the level if needed.`
        );
      }
      if (inferredCount > 0) {
        parts.push(
          `${inferredCount} heading${inferredCount === 1 ? "" : "s"} had no aria-level and used the level of the nearest preceding heading. Verify the inferred level is correct.`
        );
      }
      if (parts.length > 0) {
        updatedIssues[issueIndex] = {
          ...updatedIssues[issueIndex],
          fixNotes: parts.join(" "),
        };
      }
    }

    if (
      isHeadingHierarchyFix &&
      preHeadingHierarchyFixLevel &&
      preHeadingHierarchyFixLevel !== 1 &&
      issueIndex >= 0 &&
      issueIndex < updatedIssues.length
    ) {
      const delta = preHeadingHierarchyFixLevel - 1;
      updatedIssues[issueIndex] = {
        ...updatedIssues[issueIndex],
        fixNotes: `Heading levels were automatically renumbered: the document's topmost heading was an H${preHeadingHierarchyFixLevel} instead of H1, so every heading was shifted by ${delta} level${delta === 1 ? "" : "s"} to close the gap and restore a valid hierarchy. Review the heading levels to confirm they still reflect your intended document structure.`,
      };
    }

    const noFixReason: string | undefined = allLandmarksEdgeCase
      ? "This document contains only landmark elements (header, nav, footer) with no primary content outside them, so there is nothing to automatically wrap in a <main> region. " +
        "To fix this manually: add a <main> element around your primary page content, or add role=\"main\" to the landmark that holds the main information."
      : undefined;

    return { accessibleHtml: fixedHtml, complianceReport: buildComplianceReport(updatedIssues), elementsFixed, noFixReason };
  }

  const { stripped, uris } = stripDataUris(currentHtml);

  function buildSystemPrompt(strict: boolean): string {
    const base = `You are an accessibility expert specializing in ADA Title II compliance and WCAG 2.1 Level AA standards.

You will receive an accessible HTML document and a specific accessibility issue that needs to be fixed.
Your task is to modify the HTML to resolve ONLY the specified issue while preserving all other content and structure.

Rules:
1. Fix ONLY the specific issue described - do not make unrelated changes
2. Preserve all existing content, structure, and styling
3. Maintain the complete HTML document structure
4. Ensure the fix follows accessibility best practices
5. Preserve all img src attributes exactly as they are - do not modify, remove, or rewrite any src values
6. Output ONLY the complete fixed HTML document, no markdown, no code fences
7. Start with <!DOCTYPE html>`;
    if (!strict) return base;
    return `${base}
8. CRITICAL: You MUST output the ENTIRE document. Do NOT truncate or omit any part of the HTML. The response must include every element from <!DOCTYPE html> through to </html>, with <body> and </body> tags present and closed. Incomplete output is not acceptable.`;
  }

  async function callAi(strict: boolean): Promise<string> {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 16384,
      system: buildSystemPrompt(strict),
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
    return response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  }

  function validateOutput(rawOutput: string): boolean {
    if (!rawOutput || (!rawOutput.startsWith("<!DOCTYPE html>") && !rawOutput.startsWith("<!doctype html>"))) {
      return false;
    }
    const hasBody = /<body[\s>]/i.test(rawOutput);
    const hasClosingBody = /<\/body>/i.test(rawOutput);
    const hasClosingHtml = /<\/html>/i.test(rawOutput);
    return hasBody && hasClosingBody && hasClosingHtml;
  }

  let rawOutput = await callAi(false);
  let wasRetried = false;
  if (!validateOutput(rawOutput)) {
    aiFixRetryCount++;
    aiFixRetryLastAt = new Date().toISOString();
    void persistAiFixRetry(aiFixRetryLastAt);
    console.warn(
      `[accessibility-engine] AI returned incomplete HTML on first attempt — retrying with strict prompt. criterion="${issue.criterion}" title="${issue.title}" retryCount=${aiFixRetryCount}`
    );
    storage.logAiFixRetryEvent(issue.criterion, issue.title).catch((err) =>
      console.error("[accessibility-engine] Failed to persist retry event:", err)
    );
    rawOutput = await callAi(true);
    if (!validateOutput(rawOutput)) {
      throw new Error("AI failed to produce a valid HTML fix. Please try again.");
    }
    wasRetried = true;
    console.info(
      `[accessibility-engine] Fix applied after retry (initial AI response was incomplete). criterion="${issue.criterion}" title="${issue.title}"`
    );
  }

  const fixedHtml = restoreDataUris(rawOutput, uris);

  const updatedIssues = [...existingReport.issues];
  applyDeterministicReport(fixedHtml, issue, issueIndex, updatedIssues);
  return { accessibleHtml: fixedHtml, complianceReport: buildComplianceReport(updatedIssues), wasRetried };
}

export type ProgressCallback = (message: string) => Promise<void>;

interface PageChunk {
  text: string;
  startPage: number;
  endPage: number;
  /**
   * True when this chunk is a hard-split continuation of the same original
   * page/part as the previous chunk (i.e. the split exists only because the
   * text exceeded maxChunkSize, not because of a real page/section break).
   * Used by mergeChunksIntoDocument to avoid inserting a visual <hr> break
   * in the middle of what was originally one continuous page.
   */
  startsMidPage: boolean;
}

/**
 * Find the best place at or before `maxEnd` (and at or after `start`) to end a
 * chunk without cutting a word or sentence in half. Searches the entire
 * [start, maxEnd) window and prefers, in order: a paragraph break, the end of
 * a sentence, a line break, then any whitespace — so a boundary near the
 * start of the window is still chosen over cutting mid-sentence near the end.
 * A small minimum-progress floor prevents pathologically tiny chunks or
 * infinite loops on dense text; only when no boundary meets that floor do we
 * fall back to the hard `maxEnd` limit.
 */
export function findSplitPoint(text: string, start: number, maxEnd: number): number {
  if (maxEnd >= text.length) return text.length;

  const window = text.slice(start, maxEnd);
  // Search the ENTIRE [start, maxEnd) window — a sentence/paragraph boundary
  // near the start of the window is still strongly preferable to cutting
  // mid-sentence near the end. `minProgress` only exists as a floor to avoid
  // pathological tiny chunks (e.g. a stray blank line one character into the
  // window); it does not restrict which half of the window we search.
  const minProgress = Math.min(200, Math.floor(window.length * 0.1));

  const paragraphIdx = window.lastIndexOf("\n\n");
  if (paragraphIdx !== -1 && paragraphIdx + 2 >= minProgress) {
    return start + paragraphIdx + 2;
  }

  const sentenceRegex = /[.!?]["')\]]?\s/g;
  let lastSentenceEnd = -1;
  let sentenceMatch: RegExpExecArray | null;
  while ((sentenceMatch = sentenceRegex.exec(window)) !== null) {
    const end = sentenceMatch.index + sentenceMatch[0].length;
    if (end >= minProgress) lastSentenceEnd = end;
  }
  if (lastSentenceEnd !== -1) {
    return start + lastSentenceEnd;
  }

  const newlineIdx = window.lastIndexOf("\n");
  if (newlineIdx !== -1 && newlineIdx + 1 >= minProgress) {
    return start + newlineIdx + 1;
  }

  const spaceIdx = window.lastIndexOf(" ");
  if (spaceIdx !== -1 && spaceIdx + 1 >= minProgress) {
    return start + spaceIdx + 1;
  }

  // No safe boundary found anywhere in the search window that meets the
  // minimum-progress floor — fall back to the hard limit rather than
  // producing a pathologically tiny chunk or looping forever.
  return maxEnd;
}

export function splitTextByPages(text: string, maxChunkSize: number = 8000): PageChunk[] {
  const pageBreakRegex = /(?:^|\n)(?:[-=]{3,}|Page\s+\d+|---\s*Page\s*\d+\s*---|\f)/gi;
  const rawParts: { pageNum: number; text: string }[] = [];
  let lastIdx = 0;
  let currentPage = 1;
  let match: RegExpExecArray | null;

  const regex = new RegExp(pageBreakRegex.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      rawParts.push({ pageNum: currentPage, text: text.slice(lastIdx, match.index) });
    }
    currentPage++;
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    rawParts.push({ pageNum: currentPage, text: text.slice(lastIdx) });
  }
  if (rawParts.length === 0) {
    rawParts.push({ pageNum: 1, text });
  }

  // Hard-split any individual part that exceeds maxChunkSize so that a
  // document without page markers cannot become one unbounded chunk. Splits
  // land on a paragraph/sentence/whitespace boundary whenever possible so no
  // word or sentence is cut in half.
  const parts: { pageNum: number; text: string; isSplitContinuation: boolean }[] = [];
  for (const part of rawParts) {
    if (part.text.length <= maxChunkSize) {
      parts.push({ ...part, isSplitContinuation: false });
    } else {
      let offset = 0;
      let isContinuation = false;
      while (offset < part.text.length) {
        const hardEnd = Math.min(offset + maxChunkSize, part.text.length);
        let end = hardEnd < part.text.length ? findSplitPoint(part.text, offset, hardEnd) : hardEnd;
        if (end <= offset) end = hardEnd; // safety net: guarantee forward progress
        parts.push({ pageNum: part.pageNum, text: part.text.slice(offset, end), isSplitContinuation: isContinuation });
        offset = end;
        isContinuation = true;
      }
    }
  }

  const chunks: PageChunk[] = [];
  let currentChunk = "";
  let chunkStartPage = parts[0]?.pageNum ?? 1;
  let chunkStartsMidPage = parts[0]?.isSplitContinuation ?? false;

  for (const part of parts) {
    if (currentChunk.length + part.text.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        startPage: chunkStartPage,
        endPage: part.isSplitContinuation ? part.pageNum : part.pageNum - 1,
        startsMidPage: chunkStartsMidPage,
      });
      currentChunk = part.text;
      chunkStartPage = part.pageNum;
      chunkStartsMidPage = part.isSplitContinuation;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + part.text;
    }
  }
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      startPage: chunkStartPage,
      endPage: parts[parts.length - 1]?.pageNum ?? 1,
      startsMidPage: chunkStartsMidPage,
    });
  }

  return chunks;
}

/**
 * Assigns each image/table to exactly ONE chunk, in chunk order.
 *
 * Chunk `startPage`/`endPage` ranges can legitimately overlap by one page
 * number when a single oversized page is hard-split across multiple chunks
 * (`startsMidPage`): the closing chunk's `endPage` and the next chunk's
 * `startPage` are both that same page. A naive per-chunk page-range filter
 * would therefore attach that page's images/tables to BOTH chunks, causing
 * duplicated structural content in the merged output. Assigning greedily in
 * chunk order and removing already-assigned items guarantees each image or
 * table appears in exactly one chunk's structural data.
 */
function assignItemsToChunks<T extends { pageNumber: number }>(
  items: T[],
  chunks: { startPage: number; endPage: number }[]
): T[][] {
  const remaining = [...items];
  const assigned: T[][] = [];
  for (const chunk of chunks) {
    const forThisChunk: T[] = [];
    for (let i = remaining.length - 1; i >= 0; i--) {
      const item = remaining[i];
      if (item.pageNumber >= chunk.startPage && item.pageNumber <= chunk.endPage) {
        forThisChunk.unshift(item);
        remaining.splice(i, 1);
      }
    }
    assigned.push(forThisChunk);
  }
  return assigned;
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
      const cellRegex = new RegExp(`<(?:td|th)${ATTR_PATTERN}>([\\s\\S]*?)<\\/(?:td|th)>`, "gi");
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
    .map((t, _i) => {
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

/** Extract a heading outline from generated HTML to pass as context to continuation chunks. */
function extractHeadingOutline(html: string): string {
  const headingRegex = new RegExp(`<h([1-6])(?:${ATTR_PATTERN})>([\\s\\S]*?)<\\/h[1-6]>`, "gi");
  const headings: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const text = match[2].replace(/<[^>]+>/g, "").trim().slice(0, 80);
    if (text) headings.push(`${"  ".repeat(level - 1)}H${level}: ${text}`);
  }
  if (headings.length === 0) return "";
  return `HEADING OUTLINE FROM PREVIOUS SECTIONS (maintain this hierarchy — do NOT restart at h1):\n${headings.join("\n")}`;
}

/**
 * Use Claude vision (Haiku) to generate descriptive alt text for images that currently
 * have weak or generic descriptions (e.g. "Document image", filename-based text, empty).
 */
async function generateVisionAltText(
  html: string,
  _images: ExtractedImage[],
  signal?: AbortSignal
): Promise<string> {
  const weakAltPattern = /^(document image|image[\s:\-]*\S{0,30}|photo|picture|img|icon|graphic|figure|untitled|\s*)$/i;

  const candidates: Array<{ dataUrl: string }> = [];
  const imgTagRegex = new RegExp(`<img\\s(${ATTR_PATTERN})>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = imgTagRegex.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src="(data:[^"]+)"/i);
    const altMatch = attrs.match(/alt="([^"]*)"/i);
    if (!srcMatch) continue;
    const currentAlt = altMatch?.[1] ?? "";
    if (!currentAlt || weakAltPattern.test(currentAlt.trim())) {
      candidates.push({ dataUrl: srcMatch[1] });
    }
  }

  if (candidates.length === 0) return html;

  const MAX_VISION = 8;
  const visionLimit = pLimit(3);
  const altMap = new Map<string, string>();

  await Promise.all(
    candidates.slice(0, MAX_VISION).map(({ dataUrl }) =>
      visionLimit(async () => {
        if (signal?.aborted) return;
        try {
          const mediaTypeMatch = dataUrl.match(/^data:([^;]+);/);
          const mediaType = (mediaTypeMatch?.[1] ?? "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
          const data = dataUrl.split(",")[1] ?? "";
          if (!data) return;
          const resp = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 150,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data } },
                { type: "text", text: "Write a concise, specific alt text for this image (1-2 sentences for screen reader users). Focus on what the image shows and its relevance to a document. Output ONLY the alt text, no quotes, no labels." },
              ],
            }],
          }, { signal } as any);
          const alt = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
          if (alt) altMap.set(dataUrl, alt);
        } catch {
          // Vision failed for this image — keep existing alt text
        }
      })
    )
  );

  if (altMap.size === 0) return html;

  return html.replace(new RegExp(`<img\\s(${ATTR_PATTERN})>`, "gi"), (fullMatch: string, attrs: string) => {
    const srcMatch = attrs.match(/src="(data:[^"]+)"/i);
    if (!srcMatch) return fullMatch;
    const newAlt = altMap.get(srcMatch[1]);
    if (!newAlt) return fullMatch;
    const escaped = escapeHtmlAttr(newAlt);
    if (/\salt\s*=\s*"/i.test(attrs)) {
      return `<img ${attrs.replace(/(\salt\s*=\s*")[^"]*(")/i, `$1${escaped}$2`)}>`;
    }
    return `<img ${attrs} alt="${escaped}">`;
  });
}

export function mergeChunksIntoDocument(
  chunks: string[],
  metadata: { title?: string; author?: string; subject?: string },
  startsMidPageFlags: boolean[] = []
): string {
  if (chunks.length === 1) return chunks[0];

  const bodyContents: { content: string; startsMidPage: boolean }[] = [];
  let headContent = "";
  let lang = "en";

  chunks.forEach((chunk, i) => {
    const startsMidPage = startsMidPageFlags[i] ?? false;
    const langMatch = chunk.match(new RegExp(`<html${ATTR_PATTERN}\\slang=["']([^"']+)["']`, "i"));
    if (langMatch) lang = langMatch[1];

    const headMatch = chunk.match(new RegExp(`<head${ATTR_PATTERN}>([\\s\\S]*?)<\\/head>`, "i"));
    if (headMatch && !headContent) headContent = headMatch[1];

    const bodyMatch = chunk.match(new RegExp(`<body${ATTR_PATTERN}>([\\s\\S]*?)<\\/body>`, "i"));
    if (bodyMatch) {
      bodyContents.push({ content: bodyMatch[1], startsMidPage });
    } else {
      const cleaned = chunk
        .replace(new RegExp(`<!DOCTYPE${ATTR_PATTERN}>`, "i"), "")
        .replace(new RegExp(`<html${ATTR_PATTERN}>`, "i"), "")
        .replace(/<\/html>/i, "")
        .replace(new RegExp(`<head${ATTR_PATTERN}>[\\s\\S]*?<\\/head>`, "i"), "")
        .replace(new RegExp(`<body${ATTR_PATTERN}>`, "i"), "")
        .replace(/<\/body>/i, "")
        .trim();
      bodyContents.push({ content: cleaned, startsMidPage });
    }
  });

  const documentTitle = metadata.title || "Accessible Document";
  if (!headContent) {
    headContent = `<meta charset="utf-8"><title>${escapeHtmlText(documentTitle)}</title>`;
  }

  // Only insert a visual <hr> between chunks that represent a real
  // page/section break. Chunks produced by hard-splitting one oversized
  // page (startsMidPage) are joined with plain whitespace so the reader
  // doesn't see a spurious divider in the middle of continuous prose.
  let mergedBody = "";
  let isFirst = true;
  for (const item of bodyContents) {
    if (!item.content.trim()) continue;
    if (isFirst) {
      mergedBody = item.content;
      isFirst = false;
    } else {
      const separator = item.startsMidPage ? "\n\n" : "\n\n<hr aria-hidden=\"true\">\n\n";
      mergedBody += separator + item.content;
    }
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headContent}
</head>
<body>
<main id="main-content">
${mergedBody}
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
  _pageCount?: number,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  ocrApplied = false
): Promise<AccessibilityResult> {
  const documentTitle = metadata.title || originalFilename.replace(/\.pdf$/i, "");

  const CHUNK_THRESHOLD = 12000;
  // Large enough that virtually no real document gets silently truncated;
  // if a document still exceeds this, we surface a warning instead of
  // dropping content without telling the user (see truncationWarning below).
  const MAX_CHUNKS = 60;
  const allChunks = splitTextByPages(extractedText, CHUNK_THRESHOLD);
  let truncationWarning: string | undefined;
  if (allChunks.length > MAX_CHUNKS) {
    const droppedChars = allChunks.slice(MAX_CHUNKS).reduce((sum, c) => sum + c.text.length, 0);
    truncationWarning = `This document was very large (${allChunks.length} sections). Only the first ${MAX_CHUNKS} sections were converted; approximately ${droppedChars.toLocaleString()} characters at the end of the document were not processed.`;
    console.warn(`[accessibility-engine] Document split into ${allChunks.length} chunks; capping at ${MAX_CHUNKS} to limit AI API usage. ${droppedChars} trailing characters were dropped.`);
  }
  const chunks = allChunks.slice(0, MAX_CHUNKS);
  const needsChunking = chunks.length > 1;

  const systemPrompt = `You are an accessibility expert specializing in ADA Title II compliance and WCAG 2.1 Level AA standards.

Your task is to convert extracted PDF content into a fully accessible HTML document. Follow these rules:

1. DOCUMENT STRUCTURE: Use proper HTML5 semantic elements (header, nav, main, article, section, aside, footer)
2. HEADINGS: Create a logical heading hierarchy (h1-h6) based on the content structure. Never skip heading levels. Never output empty heading tags.
3. LISTS: Convert ANY content with leading bullets (•, -, *, numbers) into proper <ul>/<ol>/<li> elements — NOT paragraphs with bullet characters.
4. TABLES: Reproduce EVERY table from the structural data below with ALL rows and ALL cells:
   a. Use <table> with a descriptive <caption>, <thead>, and <tbody>
   b. Header cells MUST use <th scope="col"> (column) or <th scope="row"> (row)
   c. Use colspan/rowspan for merged cells
   d. Include ALL data — never truncate, summarize, or omit any cell (empty cells → empty <td>)
5. LANGUAGE: Include lang="en" on the <html> element
6. LINKS: All links MUST have descriptive anchor text that explains the destination or action.
   NEVER use vague text: "click here", "here", "read more", "more", "learn more", "view", "open", "this", "link", "document", "PDF", "page", or bare URLs as link text.
   GOOD examples: "Download the 2024 Accessibility Report (PDF)", "View course syllabus", "Email Professor Smith"
7. IMAGES: Include an <img> for EVERY image in the structural data. Every <img> MUST have a specific, descriptive alt attribute describing what the image shows. Set src to exactly the image name.
8. READING ORDER: DOM order must match logical linear reading order. No absolute positioning.
9. CONTRAST: Use only high-contrast color combinations. Safe defaults: body text #1a1a1a on #ffffff; headings #111111 on #ffffff; code/pre #1a1a1a on #f5f5f5.
   NEVER use light gray text (e.g. #888, #999, #aaa, #777) on white — these fail 4.5:1. When in doubt use #000000 on #ffffff.
10. LANDMARKS: Use ARIA landmarks where appropriate.
11. PAGE TITLE: Include a descriptive <title> element.
12. PARSING (WCAG 4.1.1): Every id attribute must be unique within the document. All elements must be properly nested and closed. No <p> inside <p>, no <li> outside <ul>/<ol>.
13. INTERACTIVE ELEMENTS (WCAG 4.1.2): Every <button> must have descriptive visible text or aria-label. Every <input> must have an associated <label> or aria-label. Every <a> must have descriptive text — not just an icon or image without alt text.

Output ONLY the complete HTML document, no markdown, no code fences. Start with <!DOCTYPE html>.
Include inline CSS for basic readable styling that meets contrast requirements.`;

  if (onProgress) await onProgress("Analyzing document structure…");

  const chunkLimit = pLimit(4);

  // Precompute a strict partition of images/tables across chunks so that a
  // page split mid-way across two chunks (startsMidPage) never causes the
  // same image or table to be injected into both chunks. See
  // assignItemsToChunks() for why per-chunk page-range filtering alone is
  // unsafe here.
  const imagesByChunk = assignItemsToChunks(images, chunks);
  const tablesByChunk = assignItemsToChunks(tables, chunks);

  async function processChunk(chunk: PageChunk, index: number, headingOutline: string, previousTail: string): Promise<string> {
    if (signal?.aborted) throw new Error("aborted");

    const chunkImages = imagesByChunk[index] ?? [];
    const chunkTables = tablesByChunk[index] ?? [];
    const structuralSummary = buildStructuralSummary(chunkImages, chunkTables);
    const isFirst = index === 0;

    const continuationSystemPrompt = `You are an accessibility expert continuing the conversion of a multi-page PDF document into accessible HTML.

You are receiving a CONTINUATION chunk. The previous sections have already been converted.
Convert THIS chunk into accessible HTML content that will be merged with the previous sections.

Follow the same WCAG 2.1 Level AA rules:
- Proper semantic HTML5 elements
- Logical heading hierarchy — continue from where the previous section left off. Do NOT restart at h1.
- Use <ul>/<ol>/<li> for any bulleted or numbered items, NOT paragraph tags with bullet characters
- Tables: <table><caption><thead><tbody> with <th scope="col|row"> for all header cells
- TABLES: Reproduce EVERY table with ALL rows and ALL cell data — never truncate or omit
- No absolute positioning. No empty heading tags.
- LINKS: Descriptive anchor text only. NEVER use "click here", "here", "read more", "learn more", "view", "open", "this", "link", "document", "PDF", or bare URLs as link text.
- CONTRAST: Use #1a1a1a on #ffffff for body text. NEVER use light gray (#888, #999, #aaa, #777) on white.
- PARSING: All ids must be unique. Elements must be properly nested and closed.
- INTERACTIVE ELEMENTS: Every <button> needs descriptive text or aria-label. Every <input> needs a <label> or aria-label.
- FIDELITY: Convert every word of the text under "EXTRACTED TEXT (CONTINUATION)" below, from its very first word to its very last word. Do NOT drop, summarize, or truncate the first or last sentence of the chunk, and do not insert ellipses or "content omitted" markers.

${headingOutline}
${previousTail ? `\nThe previous section ended with this text (shown ONLY so you know where continuity picks up — do NOT repeat, rephrase, or output this text again):\n"...${previousTail}"\n` : ""}
Output ONLY the <body> content (no <!DOCTYPE>, no <html>, no <head>).
Do not repeat content that was already converted in previous sections, but make sure every word of the new EXTRACTED TEXT (CONTINUATION) below appears in your output exactly once.`;

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
${needsChunking ? `\nThis is chunk ${index + 1} of ${chunks.length} (pages ${chunk.startPage}–${chunk.endPage}).` : ""}

--- EXTRACTED TEXT ---
${chunk.text}
${structuralSummary}`
            : `Continue converting this PDF document.

Document title: ${documentTitle}
This is chunk ${index + 1} of ${chunks.length} (pages ${chunk.startPage}–${chunk.endPage}).

--- EXTRACTED TEXT (CONTINUATION) ---
${chunk.text}
${structuralSummary}`,
        },
      ],
    }, { signal } as any);

    const rawHtml = response.content[0]?.type === "text" ? response.content[0].text : "";
    let chunkHtml = injectImageData(rawHtml, chunkImages);
    chunkHtml = ensureMissingImages(chunkHtml, chunkImages);
    chunkHtml = ensureAltText(chunkHtml, chunkImages);
    chunkHtml = ensureMissingTables(chunkHtml, chunkTables);

    return chunkHtml;
  }

  let chunkHtmlParts: string[];

  // A short trailing snippet of each chunk's raw extracted text, used as
  // read-only context for the next chunk so the model can pick up the
  // narrative thread correctly without being told to repeat it verbatim.
  const trailingContext = (text: string) => text.slice(-400).trim();

  if (needsChunking) {
    // Process chunk 0 first so we can extract the heading tree as context for all subsequent chunks
    if (onProgress) await onProgress(`Converting section 1 of ${chunks.length}…`);
    const chunk0Html = await processChunk(chunks[0], 0, "", "");
    const headingOutline = extractHeadingOutline(chunk0Html);

    // Signal start of parallel phase before launching remaining chunks
    if (chunks.length > 1 && onProgress) await onProgress(`Converting section 2 of ${chunks.length}…`);

    // Track how many sections have completed so each completion fires a progress update
    let completedSections = 2;
    const remainingParts = await Promise.all(
      chunks.slice(1).map((chunk, idx) =>
        chunkLimit(async () => {
          const previousTail = trailingContext(chunks[idx].text);
          const result = await processChunk(chunk, idx + 1, headingOutline, previousTail);
          completedSections++;
          if (onProgress && completedSections <= chunks.length) {
            await onProgress(`Converting section ${completedSections} of ${chunks.length}…`);
          }
          return result;
        })
      )
    );

    chunkHtmlParts = [chunk0Html, ...remainingParts];
  } else {
    if (onProgress) await onProgress("Converting document…");
    chunkHtmlParts = [await processChunk(chunks[0], 0, "", "")];
  }

  let accessibleHtml = needsChunking
    ? mergeChunksIntoDocument(chunkHtmlParts, metadata, chunks.map((c) => c.startsMidPage))
    : chunkHtmlParts[0];

  // Auto-apply deterministic fixes so users start with a clean baseline
  if (onProgress) await onProgress("Applying accessibility fixes…");
  accessibleHtml = applyLangAttributeFix(accessibleHtml);
  const preHeadingHierarchyFixLevel = getFirstHeadingLevel(accessibleHtml);
  accessibleHtml = applyHeadingHierarchyFix(accessibleHtml);
  accessibleHtml = applyPageTitleFix(accessibleHtml);
  accessibleHtml = applyBypassBlocksFix(accessibleHtml);

  // Run vision alt-text enhancement and compliance audit in parallel — they are independent
  const hasImages = images.some((img) => img.dataUrl.startsWith("data:image/"));
  if (onProgress) await onProgress("Checking compliance…");

  const deterministicIssues = runDeterministicChecks(accessibleHtml);
  applyHeadingHierarchyFixNotes(deterministicIssues, preHeadingHierarchyFixLevel);
  const [enhancedHtml, aiIssues] = await Promise.all([
    hasImages
      ? generateVisionAltText(accessibleHtml, images, signal)
      : Promise.resolve(accessibleHtml),
    runAiAudit(accessibleHtml, signal),
  ]);
  accessibleHtml = enhancedHtml;
  const allIssues = [...deterministicIssues, ...aiIssues];

  return {
    accessibleHtml,
    complianceReport: buildComplianceReport(allIssues),
    contentFidelity: buildContentFidelityReport(extractedText, accessibleHtml, ocrApplied),
    ...(truncationWarning ? { truncationWarning } : {}),
  };
}
