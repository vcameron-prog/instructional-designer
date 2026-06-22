import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { conversions } from "@shared/schema";
import { users } from "@shared/models/auth";
import {
  setupAuth,
  registerAuthRoutes,
  isAuthenticated,
  isBsuAuthenticated,
  optionalAuth,
  getSessionSaveFailMetrics,
} from "./replit_integrations/auth";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { z } from "zod";
import { db } from "./db";
import { eq, and, isNull, sql, desc, inArray } from "drizzle-orm";
import { fixHtmlTableCaption, fixHtmlTableThead, editHtmlTableCaption } from "./lib/table-fixers.js";
import { getDeterministicFixerKeys, getAiFixRetryMetrics, getPersistAiFixRetryLastFailed } from "./lib/accessibility-engine";
import {
  SHARED_ANON_UPLOAD_RATE_LIMIT,
  SHARED_HEAVY_OP_RATE_LIMIT,
  checkSharedRateLimit,
  checkAnonRateLimit,
  checkHeavyOpRateLimit,
  checkUploadRateLimit,
  getRateLimitCleanupMetrics,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW_MS,
  ANON_RATE_LIMIT,
  ANON_RATE_WINDOW_MS,
  HEAVY_OP_RATE_WINDOW_MS,
} from "./lib/rateLimiters.js";

function getUserId(req: Request): string | null {
  return (req.user as any)?.claims?.sub ?? null;
}

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  timeout: 5 * 60 * 1000,
  maxRetries: 2,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/**
 * Strip characters that would break a Content-Disposition filename="..." header:
 * null bytes, newlines (header-injection), double quotes (value terminator).
 * Truncates to 200 chars to prevent excessively long headers.
 */
function sanitizeHeaderFilename(filename: string): string {
  return filename
    .replace(/[\x00\r\n"]/g, "_")
    .slice(0, 200);
}

// Concurrency guards for expensive background operations
//
// ARCHITECTURAL NOTE — AUTOSCALED DEPLOYMENT:
// All concurrency counters below are process-local. On a public autoscaled
// deployment each instance starts with its own independent counters, so the
// per-instance limits are not globally enforced. The per-conversion
// deduplication keys (activeProcessingKeys, activeFixKeys) and the DB-backed
// shared rate limit (checkSharedRateLimit) are the primary cross-instance
// guards for the most expensive paths. Authenticated-user AND anonymous upload,
// AI-gen, and heavy-op rate limits all use checkSharedRateLimit (backed by the
// rate_limit_log table) so they are enforced globally across all instances.
// Anonymous paths key by "ip:<ip>" to prevent bypass via visitor-token rotation.
// The process-local Maps (anonRateLimits, uploadRateLimits, aiGenRateLimits,
// heavyOpRateLimits) are retained only as DB-unavailable fallbacks.
let activeProcessingJobs = 0;
const MAX_CONCURRENT_PROCESSING = parseInt(process.env.MAX_CONCURRENT_PROCESSING ?? "3", 10) || 3;
// Per-conversion in-flight deduplication — prevents the same document from
// being processed multiple times in parallel across concurrent requests.
const activeProcessingKeys = new Set<string>();

// Concurrency cap for concurrent file uploads and imports to limit transient
// RAM pressure. Each upload/import holds the full file buffer in memory plus a
// base64 copy before the DB write completes, so even a handful of simultaneous
// maximum-size uploads can exhaust available memory. This guard is applied to
// direct uploads AND to Google Doc/Sheet import routes.
let activeUploadJobs = 0;
const MAX_CONCURRENT_UPLOADS = parseInt(process.env.MAX_CONCURRENT_UPLOADS ?? "5", 10) || 5;

let activePdfExports = 0;
// Exported so any 503 concurrency-cap test can derive its slot count from the
// same source rather than hardcoding the default value.  If this default ever
// changes, the test stays correct automatically.
export const MAX_CONCURRENT_PDF_EXPORTS = parseInt(process.env.MAX_CONCURRENT_PDF_EXPORTS ?? "2", 10) || 2;

let activeFixJobs = 0;
// Exported so the 503 concurrency-cap test can derive its slot count from the
// same source rather than hardcoding the default value.  If this default ever
// changes, the test stays correct automatically.
export const MAX_CONCURRENT_FIXES = parseInt(process.env.MAX_CONCURRENT_FIXES ?? "3", 10) || 3;
const activeFixKeys = new Set<string>();

let activeDocxExports = 0;
// Exported so the 503 concurrency-cap test can derive its slot count from the
// actual constant rather than hardcoding a magic number. If this value ever
// changes, the test stays correct automatically.
export const MAX_CONCURRENT_DOCX_EXPORTS = parseInt(process.env.MAX_CONCURRENT_DOCX_EXPORTS ?? "3", 10) || 3;
// Test-only: lets the 503 concurrency-cap test prime and reset the counter
// without needing real in-flight jobs.  Never call this in production code.
export function _testSetActiveDocxExports(n: number): void {
  activeDocxExports = n;
}
// Test-only: prime / clear the reprocess deduplication key for a given
// conversion ID so the 409-guard test can simulate an in-flight reprocess
// job without needing a real running background job.
// Never call these in production code.
export function _testAddReprocessKey(id: number): void {
  activeProcessingKeys.add(`reprocess:${id}`);
}
export function _testDeleteReprocessKey(id: number): void {
  activeProcessingKeys.delete(`reprocess:${id}`);
}
// Per-conversion export dedup keys — prevent the same completed document from
// being exported multiple times concurrently on the same instance, which would
// duplicate Chromium/DOCX-builder work and exhaust concurrency slots.
const activeDocxExportKeys = new Set<string>();
const activePdfExportKeys = new Set<string>();

let activeXlsxExports = 0;
export const MAX_CONCURRENT_XLSX_EXPORTS = parseInt(process.env.MAX_CONCURRENT_XLSX_EXPORTS ?? "3", 10) || 3;
const activeXlsxExportKeys = new Set<string>();

// Shared error message for non-numeric or out-of-range route :id parameters.
// Centralised here so every conversion route returns the identical string and
// test assertions can import it rather than duplicating the literal.
export const INVALID_ID_ERROR = "Invalid id";

// Shared error messages for frequently-repeated response strings.
// Centralised so every route returns the identical text and test assertions
// can import the constant rather than duplicating the literal value.
export const CONVERSION_NOT_FOUND_ERROR = "Conversion not found";
export const UPLOAD_RATE_LIMIT_ERROR = "Upload rate limit exceeded. Please try again later.";
export const PROCESSING_RATE_LIMIT_ERROR = "Too many processing requests. Please wait before submitting another document.";
export const FIX_RATE_LIMIT_ERROR = "Too many fix requests. Please wait before trying again.";
export const DOCX_EXPORT_RATE_LIMIT_ERROR = "Too many DOCX export requests. Please wait before trying again.";
export const XLSX_EXPORT_RATE_LIMIT_ERROR = "Too many XLSX export requests. Please wait before trying again.";
export const PDF_EXPORT_RATE_LIMIT_ERROR = "Too many PDF export requests. Please wait before trying again.";
export const ISSUE_NOT_FOUND_ERROR = "Issue not found";
export const ISSUE_INDEX_REQUIRED_ERROR = "issueIndex required";
export const CONVERSION_MUST_BE_COMPLETED_ERROR = "Conversion must be completed";


async function fixVagueLinkTextAI(text: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an accessibility editor. Your task is to fix vague link text in the following markdown content.

Vague link text includes phrases like "click here", "here", "link", "read more", "learn more", "go here", "this page", "more info", "more", "click", "this link", "this article", "this resource", "view here", "find out more", "see here", "details", "info", or similar non-descriptive labels.

Rules:
1. For each vague link that has a URL, replace ONLY the link label with a short, descriptive phrase that accurately reflects the link destination based on surrounding context. Preserve the URL exactly as-is.
   - Example: \`[click here](https://bsu.edu/calendar)\` → \`[BSU Academic Calendar](https://bsu.edu/calendar)\`
2. For vague links with NO URL (bare links like \`[click here]\` or \`[here]\`), replace the entire link with the editorial placeholder: \`[** Describe link destination **]\`
3. Do NOT change any other content — only fix the vague link labels.
4. Return the complete updated markdown with no additional commentary, explanations, or code fences.

Here is the markdown content to fix:

${text}`,
      },
    ],
  });

  const result = message.content
    .filter((item): item is Anthropic.TextBlock => item.type === "text")
    .map((item) => item.text)
    .join("");

  const trimmed = result.trim();
  if (!trimmed) {
    throw new Error("AI returned an empty response for vague link fix; original content preserved.");
  }
  return trimmed;
}

function fixAllCaps(text: string): string {
  return text.replace(/\b[A-Z]{10,}\b/g, (match) => {
    return match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
  });
}

/**
 * Finds the first heading level skip in the content and inserts a placeholder
 * heading at the missing level to maintain a logical hierarchy.
 */
function fixHeadingSkip(text: string): string {
  const lines = text.split("\n");
  const headings: Array<{ lineIdx: number; level: number }> = [];
  let insideCodeFence = false;

  lines.forEach((line, lineIdx) => {
    if (/^```/.test(line.trim())) insideCodeFence = !insideCodeFence;
    if (!insideCodeFence) {
      const match = line.match(/^(#{1,6})\s/);
      if (match) headings.push({ lineIdx, level: match[1].length });
    }
  });

  if (headings.length <= 1) return text;

  let prevLevel = headings[0].level;
  for (let h = 1; h < headings.length; h++) {
    const { level, lineIdx } = headings[h];
    if (level > prevLevel + 1) {
      const missingLevel = prevLevel + 1;
      const hashes = "#".repeat(missingLevel);
      lines.splice(lineIdx, 0, `${hashes} Section`);
      break;
    }
    prevLevel = level;
  }

  return lines.join("\n");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Setup authentication (before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);

  const getAdminIds = () => (process.env.ADMIN_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

  const checkIsAdmin = (req: Request): boolean => {
    const userId = getUserId(req);
    const userEmail = (req.user as any)?.claims?.email as string | undefined;
    const adminIds = getAdminIds();
    return !!(userId && adminIds.some(entry => entry === userId || entry === userEmail));
  };

  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (!checkIsAdmin(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };


  app.get("/api/deterministic-fixers", (_req: Request, res: Response) => {
    res.json({ keys: getDeterministicFixerKeys().sort() });
  });

  app.get("/api/metrics", async (_req: Request, res: Response) => {
    const { retryCount, lastRetryAt } = await getAiFixRetryMetrics();
    const dbStats = await storage.getAiFixRetryStats().catch(() => ({ lifetimeCount: 0, thisMonthCount: 0 }));

    const warnCount    = parseInt(process.env.RETRY_WARN_COUNT    ?? "10",   10);
    const warnRate     = parseFloat(process.env.RETRY_WARN_RATE   ?? "0.05");
    const criticalCount = parseInt(process.env.RETRY_CRITICAL_COUNT ?? "25", 10);
    const criticalRate  = parseFloat(process.env.RETRY_CRITICAL_RATE ?? "0.10");


    const cleanupMetrics = getRateLimitCleanupMetrics();
    const sessionSaveFail = await getSessionSaveFailMetrics();

    res.json({
      aiFixRetry: {
        count: retryCount,
        lastAt: lastRetryAt,
        lifetimeCount: dbStats.lifetimeCount,
        thisMonthCount: dbStats.thisMonthCount,
        persistLastFailed: getPersistAiFixRetryLastFailed(),
      },
      sessionSaveFail: {
        count: sessionSaveFail.count,
        lastAt: sessionSaveFail.lastAt,
        lifetimeCount: sessionSaveFail.lifetimeCount,
        thisMonthCount: sessionSaveFail.thisMonthCount,
      },
      rateLimitCleanup: {
        lastRunAt: cleanupMetrics.lastRunAt,
        lastErrorAt: cleanupMetrics.lastErrorAt,
        rowsDeletedTotal: cleanupMetrics.rowsDeletedTotal,
      },
      thresholds: {
        warnCount:     isNaN(warnCount)    ? 10   : warnCount,
        warnRate:      isNaN(warnRate)     ? 0.05 : warnRate,
        criticalCount: isNaN(criticalCount) ? 25  : criticalCount,
        criticalRate:  isNaN(criticalRate)  ? 0.10: criticalRate,
      },
    });
  });

  // =============================================
  // DOCUMENT ACCESSIBILITY CONVERSION ROUTES
  // =============================================

  const ACCEPTED_MIMES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // Legacy Word
    "application/msword",
    // Rich Text Format
    "application/rtf",
    "text/rtf",
    // HTML
    "text/html",
    // OpenDocument formats
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    // EPUB
    "application/epub+zip",
    // CSV
    "text/csv",
    "application/csv",
    "text/comma-separated-values",
  ]);

  const docUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ACCEPTED_MIMES.has(file.mimetype)) {
        cb(null, true);
      } else {
        // Also accept by file extension for formats where browsers may send
        // generic MIME types (e.g. application/octet-stream for .doc/.rtf)
        const name = (file.originalname || "").toLowerCase();
        const extAccepted = /\.(doc|rtf|html?|odt|ods|odp|epub|csv)$/.test(name);
        if (extAccepted) {
          cb(null, true);
        } else {
          cb(new Error("Unsupported file type. Please upload PDF, Word (.doc/.docx), Excel (.xlsx), PowerPoint (.pptx), RTF, HTML, ODF (.odt/.ods/.odp), EPUB, or CSV files."));
        }
      }
    },
  });

  function getVisitorToken(req: Request): string | null {
    return (req.session as any)?.visitorToken ?? null;
  }

  function ensureVisitorToken(req: Request): string {
    const session = req.session as any;
    if (!session.visitorToken) {
      session.visitorToken = randomUUID();
    }
    return session.visitorToken;
  }

  function conversionOwnerFilter(id: number, userId: string | null, visitorToken?: string | null) {
    if (userId) {
      return and(eq(conversions.id, id), eq(conversions.userId, userId));
    }
    if (visitorToken) {
      return and(eq(conversions.id, id), isNull(conversions.userId), eq(conversions.visitorToken, visitorToken));
    }
    // No identity available — return a condition that never matches to deny access
    return sql<boolean>`FALSE`;
  }

  app.get(
    "/api/conversions",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const results = await db
        .select({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          sourceType: conversions.sourceType,
          status: conversions.status,
          pageCount: conversions.pageCount,
          ocrApplied: conversions.ocrApplied,
          complianceReport: conversions.complianceReport,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(userId ? eq(conversions.userId, userId) : isNull(conversions.userId))
        .orderBy(desc(conversions.createdAt));
      res.json(results);
    },
  );

  app.get(
    "/api/conversions/:id",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select({
          id: conversions.id,
          userId: conversions.userId,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          sourceType: conversions.sourceType,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          statusMessage: conversions.statusMessage,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          extractionWarnings: conversions.extractionWarnings,
          processingStartedAt: conversions.processingStartedAt,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      res.json(conversion);
    },
  );

  app.get(
    "/api/conversions/:id/manual-fixes",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }
      const [owned] = await db
        .select({ id: conversions.id })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));
      if (!owned) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      const items = await storage.getManualFixItems(id);
      res.json({ items: items ?? [] });
    },
  );

  app.put(
    "/api/conversions/:id/manual-fixes",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }
      const [owned] = await db
        .select({ id: conversions.id })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));
      if (!owned) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      const { items } = req.body as { items?: unknown };
      if (!Array.isArray(items)) {
        res.status(400).json({ error: "items must be an array" });
        return;
      }
      const parsed = (items as unknown[]).map((item) => {
        const i = item as { title?: unknown; reason?: unknown; criterion?: unknown };
        const out: { title: string; reason: string; criterion?: string } = {
          title: String(i.title ?? ""),
          reason: String(i.reason ?? ""),
        };
        if (i.criterion !== undefined && i.criterion !== null) {
          out.criterion = String(i.criterion);
        }
        return out;
      });
      await storage.setManualFixItems(id, parsed);
      res.json({ ok: true });
    },
  );

  const uploadRateLimitGuard = async (req: Request, res: Response, next: NextFunction) => {
    const userId = getUserId(req);
    if (userId) {
      if (!await checkSharedRateLimit(userId, "upload", UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS, () => checkUploadRateLimit(userId))) {
        res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        return;
      }
    }
    // Anonymous users are handled by anonDbUploadRateLimitGuard (DB-backed,
    // cross-instance) which runs immediately after this guard on every upload
    // route. No process-local check here to avoid the double-check pattern.
    next();
  };

  // Shared cross-instance rate limit for anonymous uploads/imports.
  // Runs BEFORE the file is buffered so that over-quota sessions are rejected
  // without consuming memory or Anthropic quota.
  // Uses ensureVisitorToken (not getVisitorToken) so that a sticky token is
  // always assigned — preventing bypass via fresh/missing cookies.
  const anonDbUploadRateLimitGuard = async (req: Request, res: Response, next: NextFunction) => {
    const userId = getUserId(req);
    if (!userId) {
      const vToken = ensureVisitorToken(req);
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      // Key by IP so token-rotation attacks (deleting/rotating the visitor
      // cookie to obtain a fresh token) cannot bypass the shared limit.
      if (!await checkSharedRateLimit(
        `ip:${ip}`, "upload", SHARED_ANON_UPLOAD_RATE_LIMIT, ANON_RATE_WINDOW_MS,
        // Fallback to strict process-local IP check if DB is unavailable
        () => checkAnonRateLimit(ip),
      )) {
        res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        return;
      }
    }
    next();
  };

  // Concurrency guard that runs BEFORE multer buffers the file body.
  // multer.memoryStorage() reads the entire multipart body into RAM before
  // the route handler executes, so a guard placed inside the handler is too
  // late to prevent memory exhaustion from many simultaneous large uploads.
  // Acquiring the slot here (and releasing it on response close/finish) means
  // excess connections are rejected before any file data is buffered.
  const uploadConcurrencyGuard = (req: Request, res: Response, next: NextFunction) => {
    if (activeUploadJobs >= MAX_CONCURRENT_UPLOADS) {
      res.status(503).json({ error: "Server is busy. Please try again shortly." });
      return;
    }
    activeUploadJobs++;
    // Use a single-shot boolean so the counter is decremented exactly once
    // even if both "finish" and "close" fire for the same response (which
    // can happen in normal Express/Node response lifecycles).
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        activeUploadJobs = Math.max(0, activeUploadJobs - 1);
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };

  app.post(
    "/api/conversions/upload",
    optionalAuth,
    uploadRateLimitGuard,
    anonDbUploadRateLimitGuard,
    uploadConcurrencyGuard,
    docUpload.single("file"),
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const visitorToken = userId ? null : ensureVisitorToken(req);

      const fileBase64 = file.buffer.toString("base64");
      const explicitSourceType = req.body?.sourceType;
      const fname = (file.originalname || "").toLowerCase();
      const sourceType: string =
        explicitSourceType === "google-doc"
          ? "google-doc"
          : file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ? "docx"
            : file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              ? "xlsx"
              : file.mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                ? "pptx"
                : file.mimetype === "application/msword" || fname.endsWith(".doc")
                  ? "doc"
                  : file.mimetype === "application/rtf" || file.mimetype === "text/rtf" || fname.endsWith(".rtf")
                    ? "rtf"
                    : file.mimetype === "text/html" || fname.endsWith(".html") || fname.endsWith(".htm")
                      ? "html"
                      : file.mimetype === "application/vnd.oasis.opendocument.text" || fname.endsWith(".odt")
                        ? "odt"
                        : file.mimetype === "application/vnd.oasis.opendocument.spreadsheet" || fname.endsWith(".ods")
                          ? "ods"
                          : file.mimetype === "application/vnd.oasis.opendocument.presentation" || fname.endsWith(".odp")
                            ? "odp"
                            : file.mimetype === "application/epub+zip" || fname.endsWith(".epub")
                              ? "epub"
                              : file.mimetype === "text/csv" || file.mimetype === "application/csv" || file.mimetype === "text/comma-separated-values" || fname.endsWith(".csv")
                                ? "csv"
                                : "pdf";

      const [created] = await db
        .insert(conversions)
        .values({
          originalFilename: file.originalname,
          fileSize: file.size,
          sourceType,
          status: "uploaded",
          pdfData: fileBase64,
          userId: userId || null,
          visitorToken,
        })
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          sourceType: conversions.sourceType,
          status: conversions.status,
          createdAt: conversions.createdAt,
        });

      res.json(created);
    },
  );

  app.post(
    "/api/conversions/import-google-doc",
    optionalAuth,
    // uploadConcurrencyGuard runs before any remote download so that memory
    // pressure from buffering large Google Doc responses is bounded the same
    // way direct file uploads are.
    uploadConcurrencyGuard,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);

      if (userId) {
        if (!await checkSharedRateLimit(userId, "upload", UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS, () => checkUploadRateLimit(userId))) {
          return res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        }
      }

      // Shared cross-instance rate limit for anonymous sessions.
      // ensureVisitorToken (not getVisitorToken) is used so a sticky token is
      // always assigned — preventing bypass via fresh/missing cookies.
      if (!userId) {
        const vToken = ensureVisitorToken(req);
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        // Key by IP so token-rotation attacks cannot bypass the shared limit.
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "upload", SHARED_ANON_UPLOAD_RATE_LIMIT, ANON_RATE_WINDOW_MS,
          () => checkAnonRateLimit(ip),
        )) {
          return res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        }
      }

      const googleDocVisitorToken = userId ? null : ensureVisitorToken(req);

      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res
          .status(400)
          .json({ error: "A Google Docs URL is required." });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res
          .status(400)
          .json({
            error: "Invalid URL format. Please paste a Google Docs link.",
          });
      }
      if (
        parsedUrl.hostname !== "docs.google.com" ||
        !parsedUrl.pathname.startsWith("/document/d/")
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid Google Docs URL. Please paste a link like https://docs.google.com/document/d/...",
          });
      }
      const docIdMatch = parsedUrl.pathname.match(
        /\/document\/d\/([a-zA-Z0-9_-]+)/,
      );
      if (!docIdMatch) {
        return res
          .status(400)
          .json({ error: "Could not extract document ID from URL." });
      }
      const docId = docIdMatch[1];

      try {
        const exportUrls = [
          `https://docs.google.com/document/d/${docId}/export?format=docx`,
          `https://drive.google.com/uc?export=download&id=${docId}`,
        ];

        let response: globalThis.Response | null = null;
        let lastStatus = 0;
        let buffer: Buffer | null = null;

        const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

        for (const exportUrl of exportUrls) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);

          try {
            const attempt = await fetch(exportUrl, {
              signal: controller.signal,
              redirect: "follow",
              headers: { "User-Agent": "Mozilla/5.0" },
            });
            lastStatus = attempt.status;
            if (attempt.ok) {
              // Reject early if content-length header already exceeds limit.
              const contentLength = attempt.headers.get("content-length");
              if (contentLength && parseInt(contentLength, 10) > MAX_IMPORT_SIZE) {
                clearTimeout(timeout);
                return res
                  .status(413)
                  .json({ error: "Document is too large (max 20 MB)." });
              }

              // Stream the body while the AbortController timeout is still
              // active, so a slow or infinite body cannot stall the server
              // indefinitely. Size is enforced incrementally on each chunk.
              const chunks: Buffer[] = [];
              let totalSize = 0;
              const reader = attempt.body!.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  totalSize += value.length;
                  if (totalSize > MAX_IMPORT_SIZE) {
                    reader.cancel();
                    clearTimeout(timeout);
                    return res
                      .status(413)
                      .json({ error: "Document is too large (max 20 MB)." });
                  }
                  chunks.push(Buffer.from(value));
                }
              } finally {
                reader.releaseLock();
              }

              response = attempt;
              buffer = Buffer.concat(chunks);
              break;
            }
          } catch (fetchErr: any) {
            if (fetchErr.name === "AbortError") {
              return res
                .status(504)
                .json({
                  error:
                    "Download timed out. The document may be too large or Google is not responding.",
                });
            }
          } finally {
            clearTimeout(timeout);
          }
        }

        if (!response || !buffer) {
          if (lastStatus === 403 || lastStatus === 401) {
            return res
              .status(403)
              .json({
                error:
                  'This document is not publicly shared. Set sharing to "Anyone with the link" in Google Docs, then try again.',
              });
          }
          if (lastStatus === 404) {
            return res
              .status(404)
              .json({
                error: "Document not found. Check that the URL is correct.",
              });
          }
          return res
            .status(502)
            .json({
              error: `Could not download the document (status ${lastStatus}). The document may not be publicly shared.`,
            });
        }
        if (buffer.length < 100) {
          return res
            .status(502)
            .json({
              error:
                "Downloaded file appears empty. The document may not be publicly shared.",
            });
        }

        const zipSignature = buffer.slice(0, 4).toString("hex");
        if (zipSignature !== "504b0304") {
          return res
            .status(502)
            .json({
              error:
                "The downloaded file is not a valid document. The Google Doc may not be publicly shared.",
            });
        }

        const titleHeader = response.headers.get("content-disposition");
        let filename = "Google Doc.docx";
        if (titleHeader) {
          const filenameMatch = titleHeader.match(
            /filename\*?=(?:UTF-8''|"?)([^";]+)/i,
          );
          if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1].replace(/"/g, ""));
            if (!filename.endsWith(".docx")) filename += ".docx";
          }
        }

        const fileBase64 = buffer.toString("base64");
        const [created] = await db
          .insert(conversions)
          .values({
            originalFilename: filename,
            fileSize: buffer.length,
            sourceType: "google-doc",
            status: "uploaded",
            pdfData: fileBase64,
            userId: userId || null,
            visitorToken: googleDocVisitorToken,
          })
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            sourceType: conversions.sourceType,
            status: conversions.status,
            createdAt: conversions.createdAt,
          });

        res.json(created);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return res
            .status(504)
            .json({
              error:
                "Download timed out. The document may be too large or Google is not responding.",
            });
        }
        console.error("Google Doc import error:", err);
        res
          .status(500)
          .json({
            error:
              "Failed to import the Google Doc. Please check the URL and try again.",
          });
      }
    },
  );

  app.post(
    "/api/conversions/import-google-sheet",
    optionalAuth,
    // uploadConcurrencyGuard runs before any remote download so that memory
    // pressure from buffering large Google Sheet responses is bounded the same
    // way direct file uploads are.
    uploadConcurrencyGuard,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);

      if (userId) {
        if (!await checkSharedRateLimit(userId, "upload", UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS, () => checkUploadRateLimit(userId))) {
          return res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        }
      }

      // Shared cross-instance rate limit for anonymous sessions.
      // ensureVisitorToken (not getVisitorToken) so that a sticky token is
      // always assigned — preventing bypass via fresh/missing cookies.
      if (!userId) {
        const vToken = ensureVisitorToken(req);
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        // Key by IP so token-rotation attacks cannot bypass the shared limit.
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "upload", SHARED_ANON_UPLOAD_RATE_LIMIT, ANON_RATE_WINDOW_MS,
          () => checkAnonRateLimit(ip),
        )) {
          return res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        }
      }

      const { url, sheetName } = req.body;
      if (!url || typeof url !== "string") {
        return res
          .status(400)
          .json({ error: "A Google Sheets URL is required." });
      }
      const selectedSheet =
        typeof sheetName === "string" && sheetName.trim().length > 0
          ? sheetName.trim()
          : null;

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res
          .status(400)
          .json({
            error: "Invalid URL format. Please paste a Google Sheets link.",
          });
      }
      if (
        parsedUrl.hostname !== "docs.google.com" ||
        !parsedUrl.pathname.startsWith("/spreadsheets/d/")
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid Google Sheets URL. Please paste a link like https://docs.google.com/spreadsheets/d/...",
          });
      }
      const sheetIdMatch = parsedUrl.pathname.match(
        /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
      );
      if (!sheetIdMatch) {
        return res
          .status(400)
          .json({ error: "Could not extract spreadsheet ID from URL." });
      }
      const sheetId = sheetIdMatch[1];

      try {
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        let response: globalThis.Response | null = null;
        let lastStatus = 0;
        let buffer: Buffer | null = null;

        const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

        try {
          const attempt = await fetch(exportUrl, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          lastStatus = attempt.status;
          if (attempt.ok) {
            // Reject early if content-length header already exceeds limit.
            const contentLength = attempt.headers.get("content-length");
            if (contentLength && parseInt(contentLength, 10) > MAX_IMPORT_SIZE) {
              clearTimeout(timeout);
              return res
                .status(413)
                .json({ error: "Spreadsheet is too large (max 20 MB)." });
            }

            // Stream the body while the AbortController timeout is still
            // active, so a slow or infinite body cannot stall the server
            // indefinitely. Size is enforced incrementally on each chunk.
            const chunks: Buffer[] = [];
            let totalSize = 0;
            const reader = attempt.body!.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalSize += value.length;
                if (totalSize > MAX_IMPORT_SIZE) {
                  reader.cancel();
                  clearTimeout(timeout);
                  return res
                    .status(413)
                    .json({ error: "Spreadsheet is too large (max 20 MB)." });
                }
                chunks.push(Buffer.from(value));
              }
            } finally {
              reader.releaseLock();
            }

            response = attempt;
            buffer = Buffer.concat(chunks);
          }
        } catch (fetchErr: any) {
          if (fetchErr.name === "AbortError") {
            return res
              .status(504)
              .json({
                error:
                  "Download timed out. The spreadsheet may be too large or Google is not responding.",
              });
          }
        } finally {
          clearTimeout(timeout);
        }

        if (!response || !buffer) {
          if (lastStatus === 403 || lastStatus === 401) {
            return res
              .status(403)
              .json({
                error:
                  'This spreadsheet is not publicly shared. Set sharing to "Anyone with the link" in Google Sheets, then try again.',
              });
          }
          if (lastStatus === 404) {
            return res
              .status(404)
              .json({
                error: "Spreadsheet not found. Check that the URL is correct.",
              });
          }
          return res
            .status(502)
            .json({
              error: `Could not download the spreadsheet (status ${lastStatus}). The spreadsheet may not be publicly shared.`,
            });
        }
        if (buffer.length < 100) {
          return res
            .status(502)
            .json({
              error:
                "Downloaded file appears empty. The spreadsheet may not be publicly shared.",
            });
        }

        const zipSignature = buffer.slice(0, 4).toString("hex");
        if (zipSignature !== "504b0304") {
          return res
            .status(502)
            .json({
              error:
                "The downloaded file is not a valid spreadsheet. The Google Sheet may not be publicly shared.",
            });
        }

        const titleHeader = response.headers.get("content-disposition");
        let filename = "Google Sheet.xlsx";
        if (titleHeader) {
          const filenameMatch = titleHeader.match(
            /filename\*?=(?:UTF-8''|"?)([^";]+)/i,
          );
          if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1].replace(/"/g, ""));
            if (!filename.endsWith(".xlsx")) filename += ".xlsx";
          }
        }

        const googleSheetVisitorToken = userId ? null : ensureVisitorToken(req);
        const fileBase64 = buffer.toString("base64");
        const [created] = await db
          .insert(conversions)
          .values({
            originalFilename: filename,
            fileSize: buffer.length,
            sourceType: "google-sheet",
            status: "uploaded",
            pdfData: fileBase64,
            selectedSheet: selectedSheet,
            userId: userId || null,
            visitorToken: googleSheetVisitorToken,
          })
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            sourceType: conversions.sourceType,
            status: conversions.status,
            createdAt: conversions.createdAt,
          });

        res.json(created);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return res
            .status(504)
            .json({
              error:
                "Download timed out. The spreadsheet may be too large or Google is not responding.",
            });
        }
        console.error("Google Sheet import error:", err);
        res
          .status(500)
          .json({
            error:
              "Failed to import the Google Sheet. Please check the URL and try again.",
          });
      }
    },
  );

  app.post(
    "/api/conversions/import-google-slide",
    optionalAuth,
    // uploadConcurrencyGuard runs before any remote download so that memory
    // pressure from buffering large Google Slides responses is bounded the same
    // way direct file uploads are.
    uploadConcurrencyGuard,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);

      if (userId) {
        if (!await checkSharedRateLimit(userId, "upload", UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS, () => checkUploadRateLimit(userId))) {
          return res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        }
      }

      // Shared cross-instance rate limit for anonymous sessions.
      // ensureVisitorToken (not getVisitorToken) so that a sticky token is
      // always assigned — preventing bypass via fresh/missing cookies.
      if (!userId) {
        const vToken = ensureVisitorToken(req);
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        // Key by IP so token-rotation attacks cannot bypass the shared limit.
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "upload", SHARED_ANON_UPLOAD_RATE_LIMIT, ANON_RATE_WINDOW_MS,
          () => checkAnonRateLimit(ip),
        )) {
          return res.status(429).json({ error: UPLOAD_RATE_LIMIT_ERROR });
        }
      }

      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res
          .status(400)
          .json({ error: "A Google Slides URL is required." });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res
          .status(400)
          .json({
            error: "Invalid URL format. Please paste a Google Slides link.",
          });
      }
      if (
        parsedUrl.hostname !== "docs.google.com" ||
        !parsedUrl.pathname.startsWith("/presentation/d/")
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid Google Slides URL. Please paste a link like https://docs.google.com/presentation/d/...",
          });
      }
      const slideIdMatch = parsedUrl.pathname.match(
        /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
      );
      if (!slideIdMatch) {
        return res
          .status(400)
          .json({ error: "Could not extract presentation ID from URL." });
      }
      const slideId = slideIdMatch[1];

      try {
        const exportUrl = `https://docs.google.com/presentation/d/${slideId}/export?format=pptx`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        let response: globalThis.Response | null = null;
        let lastStatus = 0;
        let buffer: Buffer | null = null;

        const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

        try {
          const attempt = await fetch(exportUrl, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          lastStatus = attempt.status;
          if (attempt.ok) {
            // Reject early if content-length header already exceeds limit.
            const contentLength = attempt.headers.get("content-length");
            if (contentLength && parseInt(contentLength, 10) > MAX_IMPORT_SIZE) {
              clearTimeout(timeout);
              return res
                .status(413)
                .json({ error: "Presentation is too large (max 20 MB)." });
            }

            // Stream the body while the AbortController timeout is still
            // active, so a slow or infinite body cannot stall the server
            // indefinitely. Size is enforced incrementally on each chunk.
            const chunks: Buffer[] = [];
            let totalSize = 0;
            const reader = attempt.body!.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalSize += value.length;
                if (totalSize > MAX_IMPORT_SIZE) {
                  reader.cancel();
                  clearTimeout(timeout);
                  return res
                    .status(413)
                    .json({ error: "Presentation is too large (max 20 MB)." });
                }
                chunks.push(Buffer.from(value));
              }
            } finally {
              reader.releaseLock();
            }

            response = attempt;
            buffer = Buffer.concat(chunks);
          }
        } catch (fetchErr: any) {
          if (fetchErr.name === "AbortError") {
            return res
              .status(504)
              .json({
                error:
                  "Download timed out. The presentation may be too large or Google is not responding.",
              });
          }
        } finally {
          clearTimeout(timeout);
        }

        if (!response || !buffer) {
          if (lastStatus === 403 || lastStatus === 401) {
            return res
              .status(403)
              .json({
                error:
                  'This presentation is not publicly shared. Set sharing to "Anyone with the link" in Google Slides, then try again.',
              });
          }
          if (lastStatus === 404) {
            return res
              .status(404)
              .json({
                error: "Presentation not found. Check that the URL is correct.",
              });
          }
          return res
            .status(502)
            .json({
              error: `Could not download the presentation (status ${lastStatus}). The presentation may not be publicly shared.`,
            });
        }
        if (buffer.length < 100) {
          return res
            .status(502)
            .json({
              error:
                "Downloaded file appears empty. The presentation may not be publicly shared.",
            });
        }

        const zipSignature = buffer.slice(0, 4).toString("hex");
        if (zipSignature !== "504b0304") {
          return res
            .status(502)
            .json({
              error:
                "The downloaded file is not a valid presentation. The Google Slides presentation may not be publicly shared.",
            });
        }

        const titleHeader = response.headers.get("content-disposition");
        let filename = "Google Slides.pptx";
        if (titleHeader) {
          const filenameMatch = titleHeader.match(
            /filename\*?=(?:UTF-8''|"?)([^";]+)/i,
          );
          if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1].replace(/"/g, ""));
            if (!filename.endsWith(".pptx")) filename += ".pptx";
          }
        }

        const googleSlideVisitorToken = userId ? null : ensureVisitorToken(req);
        const fileBase64 = buffer.toString("base64");
        const [created] = await db
          .insert(conversions)
          .values({
            originalFilename: filename,
            fileSize: buffer.length,
            sourceType: "google-slide",
            status: "uploaded",
            pdfData: fileBase64,
            userId: userId || null,
            visitorToken: googleSlideVisitorToken,
          })
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            sourceType: conversions.sourceType,
            status: conversions.status,
            createdAt: conversions.createdAt,
          });

        res.json(created);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return res
            .status(504)
            .json({
              error:
                "Download timed out. The presentation may be too large or Google is not responding.",
            });
        }
        console.error("Google Slides import error:", err);
        res
          .status(500)
          .json({
            error:
              "Failed to import the Google Slides presentation. Please check the URL and try again.",
          });
      }
    },
  );

  app.post(
    "/api/conversions/:id/process",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (conversion.status === "processing") {
        res.status(400).json({ error: "Already processing" });
        return;
      }

      // Per-conversion in-flight deduplication.
      // The status check above and the DB update below are not atomic, so
      // concurrent requests that both observe the initial "uploaded" state can
      // both pass the check and launch duplicate jobs.  The in-memory key set
      // eliminates that race for requests handled by the same instance, and the
      // DB-level status write (status: "processing") provides a last-resort
      // guard for cross-instance duplicates.
      const processingKey = String(id);
      if (activeProcessingKeys.has(processingKey)) {
        res.status(409).json({ error: "This document is already being processed. Please wait." });
        return;
      }
      activeProcessingKeys.add(processingKey);

      // Rate-limit heavy processing (per-user or per-IP).
      // For anonymous users, also enforce a shared cross-instance rate limit
      // via the rate_limit_log table so that autoscaling does not multiply
      // the effective quota.  ensureVisitorToken (not getVisitorToken) is used
      // so a sticky token is always assigned before the limit check.
      if (!userId) {
        const vToken = ensureVisitorToken(req);
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        // Key by IP so token-rotation attacks cannot bypass the shared limit.
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "process", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`process:ip:${ip}`),
        )) {
          activeProcessingKeys.delete(processingKey);
          res.status(429).json({ error: PROCESSING_RATE_LIMIT_ERROR });
          return;
        }
        // DB-backed active-job check: if ANY instance is already processing a
        // document for this anonymous session, reject immediately.
        try {
          const [{ activeCount }] = await db
            .select({ activeCount: sql<number>`count(*)::int` })
            .from(conversions)
            .where(
              and(
                eq(conversions.visitorToken, vToken),
                eq(conversions.status, "processing"),
              ),
            );
          if (activeCount > 0) {
            activeProcessingKeys.delete(processingKey);
            res.status(429).json({ error: "You already have a document being processed. Please wait for it to complete." });
            return;
          }
        } catch {
          // Fail open on transient DB errors.
        }
      } else {
        // Authenticated callers also get a process-local fallback so that
        // a transient DB outage does not automatically deny every authenticated
        // request while anonymous traffic continues unimpeded.
        if (!await checkSharedRateLimit(
          `user:${userId}`, "process", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`process:user:${userId}`),
        )) {
          activeProcessingKeys.delete(processingKey);
          res.status(429).json({ error: PROCESSING_RATE_LIMIT_ERROR });
          return;
        }
      }

      // Global concurrency cap: query the database so the limit is effective
      // across all autoscaled instances, not just the local process.  Fall
      // back to the in-process counter if the DB query fails (fail-closed).
      let currentProcessingCount = activeProcessingJobs;
      try {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(conversions)
          .where(eq(conversions.status, "processing"));
        currentProcessingCount = row?.count ?? activeProcessingJobs;
      } catch {
        // DB count unavailable; fall back to the in-process counter.
      }

      if (currentProcessingCount >= MAX_CONCURRENT_PROCESSING) {
        activeProcessingKeys.delete(processingKey);
        res.status(503).json({ error: "Server is busy processing other documents. Please try again shortly." });
        return;
      }
      activeProcessingJobs++;
      activeProcessingKeys.add(processingKey);

      // Atomically claim the conversion by only updating rows that are still
      // in the "uploaded" state. If another request (on any instance) already
      // flipped the row to "processing", returning() will be empty and we
      // abort without launching duplicate work.
      try {
        // Atomic compare-and-set: only transition to "processing" if the row
        // is still in a startable state.  Using a conditional WHERE clause
        // (status IN ('uploaded', 'failed')) means exactly one instance wins
        // the race across all autoscaled workers — whichever instance performs
        // the update first claims the slot; subsequent concurrent requests
        // from other instances will see rowCount = 0 and be rejected.
        const updated = await db
          .update(conversions)
          .set({
            status: "processing",
            statusMessage: "Starting conversion…",
            processingStartedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(conversions.id, id),
              inArray(conversions.status, ["uploaded", "failed"]),
            ),
          )
          .returning({ id: conversions.id });

        if (updated.length === 0) {
          // Another request (possibly on a different instance) already claimed
          // this conversion for processing.
          activeProcessingJobs--;
          activeProcessingKeys.delete(processingKey);
          res.status(409).json({ error: "This document has already started processing. Please wait for it to complete." });
          return;
        }
      } catch (err) {
        activeProcessingJobs--;
        activeProcessingKeys.delete(processingKey);
        throw err;
      }

      const { pdfData: _pdfData, ...safeConversion } = conversion;
      const processingStartedAt = new Date();
      res.json({
        ...safeConversion,
        status: "processing",
        statusMessage: "Starting conversion…",
        processingStartedAt,
      });

      const updateStatusMessage = async (message: string) => {
        try {
          await db
            .update(conversions)
            .set({ statusMessage: message, updatedAt: new Date() })
            .where(eq(conversions.id, id));
        } catch (e) {
          console.error("Failed to update status message:", e);
        }
      };

      (async () => {
        const conversionStart = Date.now();
        const TIMEOUT_MS = 10 * 60 * 1000;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        // aborted is set to true when the timeout fires so that the inner
        // pipeline can bail out early and the completed-status write is
        // suppressed, preventing a timed-out job from overwriting the
        // failed status that the timeout handler already persisted.
        let aborted = false;

        // AbortController propagates cancellation into the Anthropic SDK so
        // that in-flight HTTP requests are actually terminated when the
        // 10-minute timeout fires.  Without this, the SDK keeps waiting for
        // the model response even after the slot has been released, allowing
        // zombie jobs to consume AI quota and CPU concurrently with new work.
        const abortController = new AbortController();

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            aborted = true;
            abortController.abort();
            reject(new Error("Conversion timed out after 10 minutes. The document may be too large or complex. Please try a smaller file."));
          }, TIMEOUT_MS);
        });

        function buildExtractionSummary(
          srcType: string,
          extraction: { text: string; pageCount: number; tables: Array<{ rows: string[][] }> },
          finalText: string,
        ): string {
          const fmt = (n: number, singular: string, plural?: string) =>
            `${n.toLocaleString()} ${n === 1 ? singular : (plural ?? singular + "s")}`;

          const wordCount = finalText.trim().split(/\s+/).filter(Boolean).length;
          const tableCount = extraction.tables.length;
          const pageCount = extraction.pageCount;
          const tablePart = tableCount > 0 ? ` and ${fmt(tableCount, "table")}` : "";

          if (srcType === "csv") {
            const rows = extraction.tables[0]?.rows.length ?? 0;
            const dataRows = Math.max(0, rows - 1);
            return `Extracted ${fmt(dataRows, "data row")}${rows > 0 ? " (plus header)" : ""}. Generating accessible HTML…`;
          }

          if (srcType === "xlsx" || srcType === "google-sheet") {
            const sheetCount = extraction.tables.length;
            const totalRows = extraction.tables.reduce((sum, t) => sum + Math.max(0, t.rows.length - 1), 0);
            const sheetPart = sheetCount > 1 ? ` across ${fmt(sheetCount, "sheet")}` : "";
            return `Extracted ${fmt(totalRows, "data row")}${sheetPart}. Generating accessible HTML…`;
          }

          if (srcType === "ods") {
            const sheetCount = extraction.tables.length;
            const totalRows = extraction.tables.reduce((sum, t) => sum + Math.max(0, t.rows.length - 1), 0);
            const sheetPart = sheetCount > 1 ? ` across ${fmt(sheetCount, "sheet")}` : "";
            return `Extracted ${fmt(totalRows, "data row")}${sheetPart}. Generating accessible HTML…`;
          }

          if (srcType === "pptx" || srcType === "google-slide") {
            return `Extracted ${fmt(pageCount, "slide")}${tablePart}. Generating accessible HTML…`;
          }

          if (srcType === "odp") {
            return `Extracted ${fmt(pageCount, "slide")}${tablePart}. Generating accessible HTML…`;
          }

          if (srcType === "epub") {
            return `Extracted ${fmt(wordCount, "word")} across ${fmt(pageCount, "chapter")}${tablePart}. Generating accessible HTML…`;
          }

          if (srcType === "pdf") {
            const pagePart = pageCount > 1 ? ` across ${fmt(pageCount, "page")}` : "";
            return `Extracted ${fmt(wordCount, "word")}${pagePart}${tablePart}. Generating accessible HTML…`;
          }

          return `Extracted ${fmt(wordCount, "word")}${tablePart}. Generating accessible HTML…`;
        }

        const innerWorkPromise = (async () => {
          const { generateAccessibleDocument, evaluateOriginalDocument } =
            await import("./lib/accessibility-engine");
          const fileBuffer = Buffer.from(conversion.pdfData!, "base64");
          const srcType = conversion.sourceType || "pdf";

          let extraction: import("./lib/pdf-processor").PdfExtraction;
          let ocrApplied = false;

          try {
            if (srcType === "google-sheet" || srcType === "xlsx") {
              await updateStatusMessage(
                srcType === "xlsx"
                  ? "Extracting Excel spreadsheet content…"
                  : "Extracting Google Sheet content…"
              );
              const { extractXlsxContent } = await import("./lib/xlsx-extractor");
              extraction = await extractXlsxContent(fileBuffer, conversion.selectedSheet);
            } else if (srcType === "pptx" || srcType === "google-slide") {
              await updateStatusMessage(
                srcType === "google-slide"
                  ? "Extracting Google Slides content…"
                  : "Extracting PowerPoint slide content…"
              );
              const { extractPptxContent } = await import("./lib/pptx-extractor");
              extraction = await extractPptxContent(fileBuffer);
            } else if (srcType === "docx" || srcType === "google-doc") {
              await updateStatusMessage(
                srcType === "google-doc"
                  ? "Extracting Google Doc content…"
                  : "Extracting Word document content…",
              );
              const { extractDocxContent } = await import("./lib/docx-extractor");
              extraction = await extractDocxContent(fileBuffer);
            } else if (srcType === "doc") {
              await updateStatusMessage("Extracting Legacy Word document content…");
              const { extractDocContent } = await import("./lib/doc-extractor");
              extraction = await extractDocContent(fileBuffer);
            } else if (srcType === "rtf") {
              await updateStatusMessage("Extracting Rich Text Format content…");
              const { extractRtfContent } = await import("./lib/rtf-extractor");
              extraction = await extractRtfContent(fileBuffer);
            } else if (srcType === "html") {
              await updateStatusMessage("Extracting HTML document content…");
              const { extractHtmlContent } = await import("./lib/html-extractor");
              extraction = await extractHtmlContent(fileBuffer);
            } else if (srcType === "odt") {
              await updateStatusMessage("Extracting OpenDocument Text content…");
              const { extractOdfContent } = await import("./lib/odf-extractor");
              extraction = await extractOdfContent(fileBuffer, "odt");
            } else if (srcType === "ods") {
              await updateStatusMessage("Extracting OpenDocument Spreadsheet content…");
              const { extractOdfContent } = await import("./lib/odf-extractor");
              extraction = await extractOdfContent(fileBuffer, "ods");
            } else if (srcType === "odp") {
              await updateStatusMessage("Extracting OpenDocument Presentation content…");
              const { extractOdfContent } = await import("./lib/odf-extractor");
              extraction = await extractOdfContent(fileBuffer, "odp");
            } else if (srcType === "epub") {
              await updateStatusMessage("Extracting EPUB content…");
              const { extractEpubContent } = await import("./lib/epub-extractor");
              extraction = await extractEpubContent(fileBuffer);
            } else if (srcType === "csv") {
              await updateStatusMessage("Extracting CSV data…");
              const { extractCsvContent } = await import("./lib/csv-extractor");
              extraction = await extractCsvContent(fileBuffer);
            } else {
              await updateStatusMessage("Extracting PDF content…");
              const { extractPdfContent, needsOcr } = await import(
                "./lib/pdf-processor"
              );
              extraction = await extractPdfContent(fileBuffer);
              ocrApplied = needsOcr(extraction.text, extraction.pageCount);
            }
          } catch (extractErr: any) {
            console.error(`[conversion #${id}] extraction failed (${srcType}): ${extractErr.message}`);
            const { EXTRACTION_ERROR_MESSAGES, EXTRACTION_ERROR_FALLBACK } = await import("../shared/extraction-error-messages");
            const friendly = EXTRACTION_ERROR_MESSAGES[srcType] ?? EXTRACTION_ERROR_FALLBACK;
            throw new Error(friendly);
          }

          // Bail out early if the timeout already fired during extraction.
          if (aborted) throw new Error("aborted");

          let finalText = extraction.text;
          if (ocrApplied) {
            await updateStatusMessage("Running OCR on scanned pages…");
            // Use Claude's document vision to extract text from the entire scanned PDF.
            // Cap at 8 MB to stay within API payload limits.
            const MAX_OCR_SIZE = 8 * 1024 * 1024;
            if (fileBuffer.length <= MAX_OCR_SIZE) {
              try {
                const pdfBase64 = fileBuffer.toString("base64");
                const ocrResponse = await anthropic.messages.create({
                  model: "claude-sonnet-4-5",
                  max_tokens: 8000,
                  messages: [{
                    role: "user",
                    content: [
                      {
                        type: "document",
                        source: {
                          type: "base64",
                          media_type: "application/pdf",
                          data: pdfBase64,
                        },
                      } as any,
                      {
                        type: "text",
                        text: "Extract all text from this scanned PDF document. Maintain the reading order and document structure. Separate pages with '--- Page N ---'. Output only the extracted text.",
                      },
                    ],
                  }],
                }, { signal: abortController.signal } as any);
                const ocrText = ocrResponse.content[0]?.type === "text" ? ocrResponse.content[0].text : "";
                if (ocrText) finalText = ocrText;
              } catch (ocrErr: any) {
                console.warn(`[conversion #${id}] OCR failed: ${ocrErr.message} — proceeding with best-effort text`);
              }
            } else {
              console.warn(`[conversion #${id}] Scanned PDF too large for OCR (${Math.round(fileBuffer.length / 1024 / 1024)}MB > 8MB), proceeding with empty text`);
            }
          }

          // Bail out before the most expensive AI step if already timed out.
          if (aborted) throw new Error("aborted");

          await updateStatusMessage(buildExtractionSummary(srcType, extraction, finalText));

          await updateStatusMessage("Evaluating original document…");
          const originalReport = evaluateOriginalDocument(finalText);

          const result = await generateAccessibleDocument(
            finalText,
            conversion.originalFilename,
            extraction.metadata,
            extraction.images,
            extraction.tables,
            extraction.pageCount,
            updateStatusMessage,
            abortController.signal,
          );

          // Guard the success write: if the timeout fired while
          // generateAccessibleDocument was running, the DB row was already
          // marked failed; writing completed here would corrupt that state.
          if (aborted) throw new Error("aborted");

          await db
            .update(conversions)
            .set({
              status: "completed",
              statusMessage: null,
              pageCount: extraction.pageCount,
              extractedText: finalText.substring(0, 50000),
              accessibleHtml: result.accessibleHtml,
              complianceReport: result.complianceReport,
              originalComplianceReport: originalReport,
              ocrApplied,
              pdfData: null,
              extractionWarnings: extraction.warnings && extraction.warnings.length > 0
                ? extraction.warnings
                : null,
              updatedAt: new Date(),
            })
            .where(eq(conversions.id, id));

          // Send completion email to authenticated users for multi-page documents.
          // Fire-and-forget — never block the success response path.
          if (userId && extraction.pageCount && extraction.pageCount >= 5) {
            try {
              const [userRow] = await db
                .select({ email: users.email, firstName: users.firstName })
                .from(users)
                .where(eq(users.id, userId));
              if (userRow?.email) {
                const { sendConversionCompleteEmail } = await import("./lib/daily-summary.js");
                sendConversionCompleteEmail(
                  userRow.email,
                  userRow.firstName ?? null,
                  conversion.originalFilename,
                  extraction.pageCount,
                  result.complianceReport?.overallScore ?? null,
                ).catch((e: Error) => console.warn(`[conversion #${id}] completion email failed: ${e.message}`));
              }
            } catch { /* non-blocking — email failure must not affect conversion success */ }
          }

          const elapsed = Math.round((Date.now() - conversionStart) / 1000);
          console.log(`[conversion #${id}] completed in ${elapsed}s (${conversion.originalFilename})`);
        })();

        try {
          await Promise.race([innerWorkPromise, timeoutPromise]);
        } catch (err: any) {
          const elapsed = Math.round((Date.now() - conversionStart) / 1000);
          console.error(`[conversion #${id}] failed after ${elapsed}s: ${err.message}`);
          await db
            .update(conversions)
            .set({
              status: "failed",
              statusMessage: null,
              errorMessage: err.message || "Processing failed",
              updatedAt: new Date(),
            })
            .where(eq(conversions.id, id));
        } finally {
          clearTimeout(timeoutId);
          // Release the per-conversion dedup key so the same document can be
          // reprocessed after a failure (e.g. to retry after a timeout).
          activeProcessingKeys.delete(processingKey);
          if (aborted) {
            // The AbortController has already signalled cancellation, so all
            // Anthropic calls will terminate promptly.  However, extraction
            // steps (PDF/DOCX/XLSX parsing) are CPU-bound and not cancellable
            // via AbortSignal; they will continue until the current operation
            // finishes.  To prevent the processing-slot counter from being
            // released while that non-cancellable work is still in flight
            // (which would allow new jobs to start and exceed MAX_CONCURRENT),
            // we hold the slot open until innerWorkPromise fully settles.
            innerWorkPromise.catch(() => {}).finally(() => {
              activeProcessingJobs = Math.max(0, activeProcessingJobs - 1);
              activeProcessingKeys.delete(processingKey);
            });
          } else {
            activeProcessingJobs--;
            activeProcessingKeys.delete(processingKey);
          }
        }
      })();
    },
  );

  app.delete(
    "/api/conversions/:id",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      await db.delete(conversions).where(conversionOwnerFilter(id, userId, getVisitorToken(req)));
      res.json({ success: true });
    },
  );

  /**
   * List the worksheet names available in a stored XLSX / Google Sheet conversion.
   * Returns { sheets: string[], selectedSheet: string | null }.
   */
  app.get(
    "/api/conversions/:id/sheets",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }

      if (!["xlsx", "google-sheet"].includes(conversion.sourceType)) {
        res.status(400).json({ error: "Sheet listing is only available for Excel/Google Sheet conversions." });
        return;
      }

      if (!conversion.pdfData) {
        res.status(400).json({ error: "Original file data is not stored for this conversion." });
        return;
      }

      try {
        const fileBuffer = Buffer.from(conversion.pdfData, "base64");
        const { listXlsxSheets } = await import("./lib/xlsx-extractor");
        const sheets = await listXlsxSheets(fileBuffer);
        res.json({ sheets, selectedSheet: conversion.selectedSheet ?? null });
      } catch (err: any) {
        res.status(500).json({ error: "Failed to read sheet names: " + (err.message || "unknown error") });
      }
    },
  );

  /**
   * Switch to a different worksheet in a stored XLSX / Google Sheet conversion.
   * Updates selectedSheet, resets the conversion to "uploaded" so it will be
   * re-processed by the frontend's auto-process logic.
   */
  app.patch(
    "/api/conversions/:id/selected-sheet",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const { selectedSheet } = req.body;
      if (typeof selectedSheet !== "string" || selectedSheet.trim().length === 0) {
        res.status(400).json({ error: "selectedSheet must be a non-empty string." });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }

      if (!["xlsx", "google-sheet"].includes(conversion.sourceType)) {
        res.status(400).json({ error: "Sheet selection is only available for Excel/Google Sheet conversions." });
        return;
      }

      if (conversion.status === "processing") {
        res.status(409).json({ error: "Cannot switch sheets while processing is in progress." });
        return;
      }

      const [updated] = await db
        .update(conversions)
        .set({
          selectedSheet: selectedSheet.trim(),
          status: "uploaded",
          errorMessage: null,
          statusMessage: null,
          accessibleHtml: null,
          complianceReport: null,
          originalComplianceReport: null,
          updatedAt: new Date(),
        })
        .where(eq(conversions.id, id))
        .returning();

      const { pdfData: _pdfData, ...safeConversion } = updated;
      res.json(safeConversion);
    },
  );

  /**
   * Re-run the AI conversion step on a previously completed or failed conversion.
   * Requires the conversion to have stored extractedText (saved on first completion).
   * Does NOT re-extract from the original file — only re-runs generateAccessibleDocument.
   */
  app.post(
    "/api/conversions/:id/reprocess",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (!["completed", "failed"].includes(conversion.status)) {
        res.status(400).json({ error: "Only completed or failed conversions can be re-converted." });
        return;
      }
      if (!conversion.extractedText) {
        res.status(400).json({ error: "No stored text available for re-conversion. Please upload the original file again." });
        return;
      }

      // Per-conversion in-flight deduplication.
      const reprocessKey = `reprocess:${id}`;
      if (activeProcessingKeys.has(reprocessKey)) {
        res.status(409).json({ error: "Re-conversion is already in progress. Please wait." });
        return;
      }
      activeProcessingKeys.add(reprocessKey);

      // Basic rate limiting (re-use the same shared per-user heavy-op limit).
      // Fallback to process-local check if DB is unavailable so a transient
      // outage does not automatically deny every authenticated re-conversion.
      if (userId) {
        if (!await checkSharedRateLimit(
          `user:${userId}`, "process", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`process:user:${userId}`),
        )) {
          activeProcessingKeys.delete(reprocessKey);
          res.status(429).json({ error: "Too many processing requests. Please wait before retrying." });
          return;
        }
      }

      // Atomically claim the conversion (only if still in a reprocessable state).
      const claimed = await db
        .update(conversions)
        .set({ status: "processing", statusMessage: "Starting re-conversion…", processingStartedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(conversions.id, id), inArray(conversions.status, ["completed", "failed"])))
        .returning({ id: conversions.id });

      if (claimed.length === 0) {
        activeProcessingKeys.delete(reprocessKey);
        res.status(409).json({ error: "Conversion status changed. Please refresh and try again." });
        return;
      }

      res.json({ id, status: "processing", statusMessage: "Starting re-conversion…", processingStartedAt: new Date() });

      // Background work — same pattern as the main /process route.
      const REPROCESS_TIMEOUT_MS = 10 * 60 * 1000;
      activeProcessingJobs++;
      (async () => {
        const conversionStart = Date.now();
        const abortController = new AbortController();
        let aborted = false;
        const timeoutId = setTimeout(() => {
          aborted = true;
          abortController.abort();
        }, REPROCESS_TIMEOUT_MS);

        const updateStatus = async (msg: string) => {
          try {
            await db.update(conversions).set({ statusMessage: msg, updatedAt: new Date() }).where(eq(conversions.id, id));
          } catch { /* non-fatal */ }
        };

        try {
          const { generateAccessibleDocument } = await import("./lib/accessibility-engine.js");
          const result = await generateAccessibleDocument(
            conversion.extractedText!,
            conversion.originalFilename,
            { title: conversion.originalFilename.replace(/\.[^.]+$/, "") },
            [],
            [],
            conversion.pageCount ?? undefined,
            updateStatus,
            abortController.signal,
          );

          if (aborted) throw new Error("aborted");

          await db.update(conversions).set({
            status: "completed",
            statusMessage: null,
            accessibleHtml: result.accessibleHtml,
            complianceReport: result.complianceReport,
            updatedAt: new Date(),
          }).where(eq(conversions.id, id));

          const elapsed = Math.round((Date.now() - conversionStart) / 1000);
          console.log(`[reprocess #${id}] completed in ${elapsed}s`);
        } catch (err: any) {
          const elapsed = Math.round((Date.now() - conversionStart) / 1000);
          console.error(`[reprocess #${id}] failed after ${elapsed}s: ${err.message}`);
          if (!aborted) {
            await db.update(conversions).set({
              status: "failed",
              statusMessage: null,
              errorMessage: err.message || "Re-conversion failed",
              updatedAt: new Date(),
            }).where(eq(conversions.id, id));
          }
        } finally {
          clearTimeout(timeoutId);
          activeProcessingJobs = Math.max(0, activeProcessingJobs - 1);
          activeProcessingKeys.delete(reprocessKey);
        }
      })();
    },
  );

  app.post(
    "/api/conversions/:id/fix-issue",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const { issueIndex } = req.body;
      if (typeof issueIndex !== "number") {
        res.status(400).json({ error: ISSUE_INDEX_REQUIRED_ERROR });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: CONVERSION_MUST_BE_COMPLETED_ERROR });
        return;
      }

      // Rate-limit AI fix calls. Both anonymous and authenticated users use
      // the shared cross-instance DB-backed limit so the quota is globally
      // enforced across all autoscaled instances.
      //
      // If the database is unavailable, checkSharedRateLimit catches the error
      // and invokes the fallback function instead.  Both branches supply a
      // process-local fallback (checkHeavyOpRateLimit) so that:
      //   - anonymous callers: keyed by IP to prevent token-rotation bypasses.
      //   - authenticated callers: keyed by userId for per-user process-local
      //     enforcement.
      // Without a fallback the call would fail closed (return false → 429) for
      // authenticated users while anonymous users remain on the process-local
      // limiter — an undocumented asymmetry that could surprise callers.
      if (!userId) {
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        // Key by IP so token-rotation attacks cannot bypass the shared limit.
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "fix", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`fix:ip:${ip}`),
        )) {
          res.status(429).json({ error: FIX_RATE_LIMIT_ERROR });
          return;
        }
      } else {
        // Authenticated callers are also given a process-local fallback so that
        // a transient DB outage does not automatically deny every authenticated
        // request while anonymous traffic continues unimpeded.
        if (!await checkSharedRateLimit(
          `user:${userId}`, "fix", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`fix:user:${userId}`),
        )) {
          res.status(429).json({ error: FIX_RATE_LIMIT_ERROR });
          return;
        }
      }

      // Global concurrency cap to prevent exhausting AI quota and server resources
      if (activeFixJobs >= MAX_CONCURRENT_FIXES) {
        res.status(503).json({ error: "Server is busy processing fixes. Please try again shortly." });
        return;
      }

      const report = conversion.complianceReport as any;
      if (!report?.issues?.[issueIndex]) {
        res.status(400).json({ error: ISSUE_NOT_FOUND_ERROR });
        return;
      }

      // Per-conversion/issue in-flight deduplication — reject duplicate concurrent fix requests
      const fixDedupeKey = `${id}:${issueIndex}`;
      if (activeFixKeys.has(fixDedupeKey)) {
        res.status(409).json({ error: "A fix for this issue is already in progress. Please wait." });
        return;
      }

      activeFixJobs++;
      activeFixKeys.add(fixDedupeKey);
      try {
        const { fixComplianceIssue } = await import(
          "./lib/accessibility-engine"
        );
        const result = await fixComplianceIssue(
          conversion.accessibleHtml,
          report.issues[issueIndex],
          issueIndex,
          report,
        );

        const [updated] = await db
          .update(conversions)
          .set({
            accessibleHtml: result.accessibleHtml,
            complianceReport: result.complianceReport,
            updatedAt: new Date(),
          })
          .where(eq(conversions.id, id))
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            status: conversions.status,
            pageCount: conversions.pageCount,
            extractedText: conversions.extractedText,
            accessibleHtml: conversions.accessibleHtml,
            complianceReport: conversions.complianceReport,
            originalComplianceReport: conversions.originalComplianceReport,
            errorMessage: conversions.errorMessage,
            ocrApplied: conversions.ocrApplied,
            createdAt: conversions.createdAt,
            updatedAt: conversions.updatedAt,
          });

        res.json({ ...updated, wasRetried: result.wasRetried ?? false, elementsFixed: result.elementsFixed, noFixReason: result.noFixReason });
      } catch (err: any) {
        res.status(500).json({ error: err.message || "Fix failed" });
      } finally {
        activeFixJobs--;
        activeFixKeys.delete(fixDedupeKey);
      }
    },
  );

  app.post(
    "/api/conversions/:id/fix-all-aria",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: CONVERSION_MUST_BE_COMPLETED_ERROR });
        return;
      }

      const dedupeKey = `aria-all:${id}`;
      if (activeFixKeys.has(dedupeKey)) {
        res.status(409).json({ error: "A fix is already in progress for this conversion." });
        return;
      }

      activeFixKeys.add(dedupeKey);
      try {
        const { fixAllAriaRoleMisuse } = await import("./lib/accessibility-engine");
        const report = conversion.complianceReport as any;
        if (!report) {
          res.status(400).json({ error: "No compliance report found" });
          return;
        }
        const result = fixAllAriaRoleMisuse(conversion.accessibleHtml, report);

        const [updated] = await db
          .update(conversions)
          .set({
            accessibleHtml: result.accessibleHtml,
            complianceReport: result.complianceReport,
            updatedAt: new Date(),
          })
          .where(eq(conversions.id, id))
          .returning({
            id: conversions.id,
            originalFilename: conversions.originalFilename,
            fileSize: conversions.fileSize,
            status: conversions.status,
            pageCount: conversions.pageCount,
            extractedText: conversions.extractedText,
            accessibleHtml: conversions.accessibleHtml,
            complianceReport: conversions.complianceReport,
            originalComplianceReport: conversions.originalComplianceReport,
            errorMessage: conversions.errorMessage,
            ocrApplied: conversions.ocrApplied,
            createdAt: conversions.createdAt,
            updatedAt: conversions.updatedAt,
          });

        res.json({ ...updated, wasRetried: result.wasRetried ?? false, elementsFixed: result.elementsFixed ?? 0 });
      } catch (err: any) {
        res.status(500).json({ error: err.message || "Fix failed" });
      } finally {
        activeFixKeys.delete(dedupeKey);
      }
    },
  );

  app.post(
    "/api/conversions/:id/accept-issue",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const { issueIndex, justification } = req.body;
      if (typeof issueIndex !== "number") {
        res.status(400).json({ error: ISSUE_INDEX_REQUIRED_ERROR });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }

      const report = conversion.complianceReport as any;
      if (!report?.issues?.[issueIndex]) {
        res.status(400).json({ error: ISSUE_NOT_FOUND_ERROR });
        return;
      }

      const issue = report.issues[issueIndex];
      report.issues[issueIndex] = {
        ...issue,
        previousStatus: issue.status,
        status: "accepted",
        justification: justification || "Accepted by user",
      };

      const { buildComplianceReport } = await import(
        "./lib/accessibility-engine"
      );
      const updatedReport = buildComplianceReport(report.issues);

      const [updated] = await db
        .update(conversions)
        .set({ complianceReport: updatedReport, updatedAt: new Date() })
        .where(eq(conversions.id, id))
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        });

      res.json(updated);
    },
  );

  app.post(
    "/api/conversions/:id/revert-issue",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const { issueIndex } = req.body;
      if (typeof issueIndex !== "number") {
        res.status(400).json({ error: ISSUE_INDEX_REQUIRED_ERROR });
        return;
      }

      const [conversion] = await db
        .select()
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }

      const report = conversion.complianceReport as any;
      if (!report?.issues?.[issueIndex]) {
        res.status(400).json({ error: ISSUE_NOT_FOUND_ERROR });
        return;
      }

      const issue = report.issues[issueIndex];
      if (issue.status !== "accepted" || !issue.previousStatus) {
        res.status(400).json({ error: "Issue is not accepted" });
        return;
      }

      report.issues[issueIndex] = {
        ...issue,
        status: issue.previousStatus,
        previousStatus: undefined,
        justification: undefined,
      };

      const { buildComplianceReport } = await import(
        "./lib/accessibility-engine"
      );
      const updatedReport = buildComplianceReport(report.issues);

      const [updated] = await db
        .update(conversions)
        .set({ complianceReport: updatedReport, updatedAt: new Date() })
        .where(eq(conversions.id, id))
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        });

      res.json(updated);
    },
  );

  app.put(
    "/api/conversions/:id/html",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const { html } = req.body;
      if (typeof html !== "string") {
        res.status(400).json({ error: "html required" });
        return;
      }

      const [conversion] = await db
        .select({ id: conversions.id, status: conversions.status })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (conversion.status !== "completed") {
        res.status(400).json({ error: "Must be completed" });
        return;
      }

      const [updated] = await db
        .update(conversions)
        .set({ accessibleHtml: html, updatedAt: new Date() })
        .where(eq(conversions.id, id))
        .returning({
          id: conversions.id,
          originalFilename: conversions.originalFilename,
          fileSize: conversions.fileSize,
          status: conversions.status,
          pageCount: conversions.pageCount,
          extractedText: conversions.extractedText,
          accessibleHtml: conversions.accessibleHtml,
          complianceReport: conversions.complianceReport,
          originalComplianceReport: conversions.originalComplianceReport,
          errorMessage: conversions.errorMessage,
          ocrApplied: conversions.ocrApplied,
          createdAt: conversions.createdAt,
          updatedAt: conversions.updatedAt,
        });

      res.json(updated);
    },
  );

  app.get(
    "/api/conversions/:id/download",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select({
          accessibleHtml: conversions.accessibleHtml,
          originalFilename: conversions.originalFilename,
          status: conversions.status,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "HTML not available" });
        return;
      }

      let html = conversion.accessibleHtml;
      const updatedDate = conversion.updatedAt
        ? new Date(conversion.updatedAt)
        : new Date();
      const readableDate = updatedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const metaTag = `<meta name="date" content="${updatedDate.toISOString()}">`;
      const headCloseIdx = html.indexOf("</head>");
      if (headCloseIdx !== -1) {
        html =
          html.slice(0, headCloseIdx) +
          `  ${metaTag}\n` +
          html.slice(headCloseIdx);
      }

      const timestampFooter = `\n<footer style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e0e0e0;font-size:0.85rem;color:#666;text-align:center;" role="contentinfo" aria-label="Document timestamp">\n  <p>This accessible document was last updated on ${readableDate}</p>\n</footer>`;
      const bodyCloseIdx = html.lastIndexOf("</body>");
      if (bodyCloseIdx !== -1) {
        html =
          html.slice(0, bodyCloseIdx) +
          timestampFooter +
          "\n" +
          html.slice(bodyCloseIdx);
      }

      const filename = sanitizeHeaderFilename(
        conversion.originalFilename.replace(/\.pdf$/i, "") + "-accessible.html"
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(html);
    },
  );

  app.get(
    "/api/conversions/:id/download-docx",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select({
          accessibleHtml: conversions.accessibleHtml,
          originalFilename: conversions.originalFilename,
          status: conversions.status,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "HTML not available" });
        return;
      }

      // Rate-limit DOCX export. Both anonymous and authenticated users use
      // the shared cross-instance DB-backed limit so the quota is globally
      // enforced across all autoscaled instances.
      if (!userId) {
        const vToken = ensureVisitorToken(req);
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        // Key by IP so token-rotation attacks cannot bypass the shared limit.
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "docx_export", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`docx:ip:${ip}`),
        )) {
          res.status(429).json({ error: DOCX_EXPORT_RATE_LIMIT_ERROR });
          return;
        }
      } else {
        // Authenticated callers also get a process-local fallback so that
        // a transient DB outage does not automatically deny every authenticated
        // request while anonymous traffic continues unimpeded.
        if (!await checkSharedRateLimit(
          `user:${userId}`, "docx_export", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`docx:user:${userId}`),
        )) {
          res.status(429).json({ error: DOCX_EXPORT_RATE_LIMIT_ERROR });
          return;
        }
      }

      // Per-conversion export dedup — prevents the same document from being
      // exported multiple times in parallel on this instance, which would
      // duplicate DOCX-builder work and exhaust concurrency slots.
      const docxExportKey = String(id);
      if (activeDocxExportKeys.has(docxExportKey)) {
        res.status(409).json({ error: "A DOCX export for this document is already in progress. Please wait." });
        return;
      }
      activeDocxExportKeys.add(docxExportKey);

      // Global concurrency cap to prevent CPU/memory exhaustion from parallel DOCX builds
      if (activeDocxExports >= MAX_CONCURRENT_DOCX_EXPORTS) {
        activeDocxExportKeys.delete(docxExportKey);
        res.status(503).json({ error: "Server is busy generating DOCX files. Please try again shortly." });
        return;
      }
      activeDocxExports++;

      let html = conversion.accessibleHtml;
      const updatedDate = conversion.updatedAt
        ? new Date(conversion.updatedAt)
        : new Date();
      const readableDate = updatedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const timestampFooter = `\n<footer style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e0e0e0;font-size:0.85rem;color:#666;text-align:center;" role="contentinfo" aria-label="Document timestamp">\n  <p>This accessible document was last updated on ${readableDate}</p>\n</footer>`;
      const bodyCloseIdx = html.lastIndexOf("</body>");
      if (bodyCloseIdx !== -1) {
        html =
          html.slice(0, bodyCloseIdx) +
          timestampFooter +
          "\n" +
          html.slice(bodyCloseIdx);
      }

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const docTitle = titleMatch
        ? titleMatch[1]
        : conversion.originalFilename.replace(/\.pdf$/i, "");
      const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
      const docLang = langMatch ? langMatch[1] : "en";

      try {
        const { buildDocx } = await import("./lib/docx-builder");
        const docxBuffer = await buildDocx(html, {
          title: docTitle,
          filename: conversion.originalFilename,
          lang: docLang,
          author: "Accessibility Converter",
        });

        const filename = sanitizeHeaderFilename(
          conversion.originalFilename
            .replace(/\.pdf$/i, "")
            .replace(/[^\w\s.-]/g, "_") + "-accessible.docx"
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Content-Length", docxBuffer.length);
        res.end(docxBuffer);
      } catch (err) {
        console.error("DOCX conversion error:", err);
        res.status(500).json({ error: "Failed to generate DOCX file" });
      } finally {
        activeDocxExports--;
        activeDocxExportKeys.delete(docxExportKey);
      }
    },
  );

  app.get(
    "/api/conversions/:id/download-xlsx",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select({
          accessibleHtml: conversions.accessibleHtml,
          originalFilename: conversions.originalFilename,
          status: conversions.status,
          sourceType: conversions.sourceType,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }

      const SPREADSHEET_SOURCE_TYPES = new Set(["xlsx", "google-sheet", "ods", "csv"]);
      if (!SPREADSHEET_SOURCE_TYPES.has(conversion.sourceType ?? "")) {
        res.status(400).json({ error: "XLSX export is only available for spreadsheet conversions" });
        return;
      }

      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "HTML not available" });
        return;
      }

      if (!userId) {
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "xlsx_export", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`xlsx:ip:${ip}`),
        )) {
          res.status(429).json({ error: XLSX_EXPORT_RATE_LIMIT_ERROR });
          return;
        }
      } else {
        if (!await checkSharedRateLimit(
          `user:${userId}`, "xlsx_export", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`xlsx:user:${userId}`),
        )) {
          res.status(429).json({ error: XLSX_EXPORT_RATE_LIMIT_ERROR });
          return;
        }
      }

      const xlsxExportKey = String(id);
      if (activeXlsxExportKeys.has(xlsxExportKey)) {
        res.status(409).json({ error: "An XLSX export for this document is already in progress. Please wait." });
        return;
      }
      activeXlsxExportKeys.add(xlsxExportKey);

      if (activeXlsxExports >= MAX_CONCURRENT_XLSX_EXPORTS) {
        activeXlsxExportKeys.delete(xlsxExportKey);
        res.status(503).json({ error: "Server is busy generating XLSX files. Please try again shortly." });
        return;
      }
      activeXlsxExports++;

      const titleMatch = conversion.accessibleHtml.match(/<title[^>]*>(.*?)<\/title>/i);
      const docTitle = titleMatch
        ? titleMatch[1]
        : conversion.originalFilename.replace(/\.[^.]+$/i, "");

      try {
        const { buildXlsx } = await import("./lib/xlsx-builder");
        const xlsxBuffer = await buildXlsx(conversion.accessibleHtml, docTitle);

        const filename = sanitizeHeaderFilename(
          conversion.originalFilename
            .replace(/\.[^.]+$/i, "")
            .replace(/[^\w\s.-]/g, "_") + "-accessible.xlsx"
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Content-Length", xlsxBuffer.length);
        res.end(xlsxBuffer);
      } catch (err) {
        console.error("XLSX conversion error:", err);
        res.status(500).json({ error: "Failed to generate XLSX file" });
      } finally {
        activeXlsxExports--;
        activeXlsxExportKeys.delete(xlsxExportKey);
      }
    },
  );

  app.get(
    "/api/conversions/:id/download-pdf",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select({
          accessibleHtml: conversions.accessibleHtml,
          originalFilename: conversions.originalFilename,
          status: conversions.status,
          updatedAt: conversions.updatedAt,
        })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: CONVERSION_NOT_FOUND_ERROR });
        return;
      }
      if (conversion.status !== "completed" || !conversion.accessibleHtml) {
        res.status(400).json({ error: "Accessible HTML is not yet available" });
        return;
      }

      // Rate-limit PDF export. Both anonymous and authenticated users use
      // the shared cross-instance DB-backed limit so the quota is globally
      // enforced across all autoscaled instances.
      if (!userId) {
        const vToken = ensureVisitorToken(req);
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        // Key by IP so token-rotation attacks cannot bypass the shared limit.
        if (!await checkSharedRateLimit(
          `ip:${ip}`, "pdf_export", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`pdf:ip:${ip}`),
        )) {
          res.status(429).json({ error: PDF_EXPORT_RATE_LIMIT_ERROR });
          return;
        }
      } else {
        // Authenticated callers also get a process-local fallback so that
        // a transient DB outage does not automatically deny every authenticated
        // request while anonymous traffic continues unimpeded.
        if (!await checkSharedRateLimit(
          `user:${userId}`, "pdf_export", SHARED_HEAVY_OP_RATE_LIMIT, HEAVY_OP_RATE_WINDOW_MS,
          () => checkHeavyOpRateLimit(`pdf:user:${userId}`),
        )) {
          res.status(429).json({ error: PDF_EXPORT_RATE_LIMIT_ERROR });
          return;
        }
      }

      // Per-conversion export dedup — prevents the same document from being
      // rendered to PDF multiple times in parallel on this instance, which
      // would duplicate Chromium work and exhaust the PDF concurrency cap.
      const pdfExportKey = String(id);
      if (activePdfExportKeys.has(pdfExportKey)) {
        res.status(409).json({ error: "A PDF export for this document is already in progress. Please wait." });
        return;
      }
      activePdfExportKeys.add(pdfExportKey);

      // Global concurrency cap to prevent exhausting Chromium workers
      if (activePdfExports >= MAX_CONCURRENT_PDF_EXPORTS) {
        activePdfExportKeys.delete(pdfExportKey);
        res.status(503).json({ error: "Server is busy generating PDFs. Please try again shortly." });
        return;
      }
      activePdfExports++;

      let html = conversion.accessibleHtml;
      const updatedDate = conversion.updatedAt
        ? new Date(conversion.updatedAt)
        : new Date();
      const isoDate = updatedDate.toISOString();
      const readableDate = updatedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const metaTag = `<meta name="date" content="${isoDate}">`;
      const headCloseIdx = html.indexOf("</head>");
      if (headCloseIdx !== -1) {
        html =
          html.slice(0, headCloseIdx) +
          `  ${metaTag}\n` +
          html.slice(headCloseIdx);
      }

      const timestampFooter = `\n<footer style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e0e0e0;font-size:0.85rem;color:#666;text-align:center;" role="contentinfo" aria-label="Document timestamp">\n  <p>This accessible document was last updated on ${readableDate}</p>\n</footer>`;
      const bodyCloseIdx = html.lastIndexOf("</body>");
      if (bodyCloseIdx !== -1) {
        html =
          html.slice(0, bodyCloseIdx) +
          timestampFooter +
          "\n" +
          html.slice(bodyCloseIdx);
      }

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const docTitle = titleMatch
        ? titleMatch[1]
        : conversion.originalFilename.replace(/\.pdf$/i, "");
      const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
      const docLang = langMatch ? langMatch[1] : "en";
      const authorMatch =
        html.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']author["']/i);
      const docAuthor = authorMatch
        ? authorMatch[1]
        : "Accessibility Converter";

      try {
        const { buildPdf } = await import("./lib/pdf-builder");
        const pdfBuffer = await buildPdf(html, {
          title: docTitle,
          lang: docLang,
          author: docAuthor,
        });

        const filename = sanitizeHeaderFilename(
          conversion.originalFilename
            .replace(/\.pdf$/i, "")
            .replace(/[^\w\s.-]/g, "_") + "-accessible.pdf"
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Content-Length", pdfBuffer.length);
        res.end(pdfBuffer);
      } catch (err) {
        console.error("PDF conversion error:", err);
        res.status(500).json({ error: "Failed to generate PDF file" });
      } finally {
        activePdfExports--;
        activePdfExportKeys.delete(pdfExportKey);
      }
    },
  );

  /**
   * Toggle the approval status of a course-linked generated content item.
   *
   * Ownership rules (applied in order):
   *  1. If the content has a userId, the requesting user must match it.
   *  2. If the content has a courseId (but no userId), the requesting user
   *     must own the linked course.
   *  3. All other cases → 404 (no owner, or ownership mismatch).
   *
   * The route is guarded by isBsuAuthenticated so anonymous callers are
   * rejected before any ownership checks run.
   */
  app.patch(
    "/api/content/:id/approval",
    isBsuAuthenticated,
    async (req: Request, res: Response) => {
      const userId = getUserId(req)!;
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const content = await storage.getGeneratedContent(id);
      if (!content) {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      // Direct user ownership
      if (content.userId) {
        if (content.userId !== userId) {
          res.status(404).json({ error: "Content not found" });
          return;
        }
        const updated = await storage.toggleContentApproval(id);
        if (!updated) {
          res.status(404).json({ error: "Content not found" });
          return;
        }
        res.json(updated);
        return;
      }

      // Course-linked content: verify the requesting user owns the course
      if (content.courseId) {
        const course = await storage.getCourseByOwner(content.courseId, userId);
        if (!course) {
          res.status(404).json({ error: "Content not found" });
          return;
        }
        const updated = await storage.toggleContentApproval(id);
        if (!updated) {
          res.status(404).json({ error: "Content not found" });
          return;
        }
        res.json(updated);
        return;
      }

      // No owner of any kind — deny
      res.status(404).json({ error: "Content not found" });
    },
  );

  // =========================================================================
  // TEST-ONLY ROUTES (disabled in production)
  // Used by Playwright e2e tests to set up a synthetic session and seed data
  // without going through the real Replit OIDC flow or file-upload pipeline.
  // =========================================================================
  if (process.env.NODE_ENV !== "production") {
    // POST /api/test/login
    // Creates a server-side session for a synthetic user without going through
    // the real Replit OIDC flow. Used by Playwright E2E tests.
    app.post("/api/test/login", async (req: Request, res: Response) => {
      const { sub, email, firstName, lastName } = req.body as {
        sub: string;
        email: string;
        firstName?: string;
        lastName?: string;
      };
      if (!sub || !email) {
        res.status(400).json({ error: "sub and email are required" });
        return;
      }
      // Upsert the user row so foreign-key constraints pass.
      try {
        await db
          .insert(users)
          .values({ id: sub, email, firstName: firstName ?? null, lastName: lastName ?? null })
          .onConflictDoUpdate({
            target: users.id,
            set: { email, firstName: firstName ?? null, lastName: lastName ?? null },
          });
      } catch {
        // users table may not exist in all test environments; ignore.
      }
      // Write directly to req.session (bypassing Passport) and call
      // session.save() so express-session commits the row and emits
      // Set-Cookie over plain HTTP (req.login() does not do this over HTTP).
      const sessionUser = {
        claims: {
          sub,
          email,
          first_name: firstName ?? "",
          last_name: lastName ?? "",
        },
        access_token: "playwright-test-token",
        refresh_token: "playwright-test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 7200,
      };
      (req.session as any).passport = { user: sessionUser };
      req.session.save((err) => {
        if (err) {
          res.status(500).json({ error: String(err) });
          return;
        }
        res.json({ ok: true, sub, email, sessionId: req.sessionID });
      });
    });

    // POST /api/test/seed-conversion
    // Directly inserts a conversion row into the database with the provided
    // fields, bypassing the upload and AI-processing pipeline.  Returns the
    // new row id so tests can navigate straight to the result page.
    // Disabled in production.
    app.post("/api/test/seed-conversion", async (req: Request, res: Response) => {
      const {
        userId,
        originalFilename,
        status,
        errorMessage,
        sourceType,
        complianceReport,
        originalComplianceReport,
        accessibleHtml,
        manualFixItems,
      } = req.body as {
        userId?: string;
        originalFilename?: string;
        status?: string;
        errorMessage?: string;
        sourceType?: string;
        complianceReport?: unknown;
        originalComplianceReport?: unknown;
        accessibleHtml?: string;
        manualFixItems?: unknown;
      };

      try {
        const [row] = await db
          .insert(conversions)
          .values({
            userId: userId ?? null,
            originalFilename: originalFilename ?? "test-document.pdf",
            fileSize: 1024,
            sourceType: sourceType ?? "pdf",
            status: status ?? "completed",
            errorMessage: errorMessage ?? null,
            complianceReport: complianceReport ?? null,
            originalComplianceReport: originalComplianceReport ?? complianceReport ?? null,
            accessibleHtml: accessibleHtml ?? null,
            manualFixItems: manualFixItems ?? null,
          })
          .returning({ id: conversions.id });

        res.status(201).json({ id: row.id });
      } catch (err) {
        console.error("[test] seed-conversion failed:", err);
        res.status(500).json({ error: String(err) });
      }
    });
  }

  return httpServer;
}
