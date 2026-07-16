import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import https from "https";
import http from "http";
import { randomUUID, createHmac } from "crypto";
import { z } from "zod";
import { storage, type UserPreferences } from "./storage";
import { conversions, courses, generatedContent, adminExports, analyticsEvents } from "@shared/schema";
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
import { db } from "./db";
import { eq, and, isNull, sql, desc, inArray } from "drizzle-orm";
import { getDeterministicFixerKeys, getAiFixRetryMetrics, getPersistAiFixRetryLastFailed, applyHeadingHierarchyFix, getContextLeakMetrics, applyCustomPageTitle, getFirstHeadingLevel, buildHeadingRenumberedNoteHtml, buildMainLandmarkNoteHtml, buildPageTitleFallbackNoteHtml, buildPageTitleLowQualityNoteHtml, BYPASS_BLOCKS_FIX_NOTE } from "./lib/accessibility-engine";
import { PAGE_TITLE_FALLBACK_NOTE, PAGE_TITLE_LOW_QUALITY_NOTE } from "@shared/page-title-messages";
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

/** Maximum image upload size for vision tools (alt-text, math-ocr).
 *  Override at runtime via IMAGE_UPLOAD_MAX_MB env var (integer MB). */
const IMAGE_UPLOAD_MAX_BYTES =
  (parseInt(process.env.IMAGE_UPLOAD_MAX_MB ?? "", 10) || 5) * 1024 * 1024;

/** Maximum document upload size for the accessibility converter (PDF/DOCX/etc.).
 *  Override at runtime via DOCUMENT_UPLOAD_MAX_MB env var (integer MB). */
const DOCUMENT_UPLOAD_MAX_BYTES =
  (parseInt(process.env.DOCUMENT_UPLOAD_MAX_MB ?? "", 10) || 20) * 1024 * 1024;

function getUserId(req: Request): string | null {
  return (req.user as any)?.claims?.sub ?? null;
}

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  timeout: 5 * 60 * 1000,
  maxRetries: 2,
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
// Maps a conversion ID to the AbortController of its active background job.
// Used by the cancel endpoint to terminate in-flight AI work on demand.
const activeAbortControllers = new Map<number, AbortController>();

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


// ─── Admin helpers ────────────────────────────────────────────────────────────

function getAdminIds(): string[] {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkIsAdmin(req: Request): boolean {
  const claims = (req.user as any)?.claims;
  if (!claims) return false;
  const adminIds = getAdminIds();
  if (adminIds.length === 0) return false;
  const id: string = claims.sub ?? "";
  const email: string = (claims.email ?? "").toLowerCase();
  return adminIds.some(
    (entry) =>
      entry === id || entry.toLowerCase() === email,
  );
}

const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!checkIsAdmin(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};

// ─── End admin helpers ────────────────────────────────────────────────────────

// ─── Toolkit retirement redirects ────────────────────────────────────────────
// These paths were part of the former BSU Accessibility Toolkit. They now
// redirect to the equivalent paths within this app using relative URLs.
export const TOOLKIT_REDIRECTS: Record<string, string> = {
  "/url-scanner":    "/accessibility-tools/url-scanner",
  "/color-contrast": "/accessibility-tools/color-contrast",
  "/alt-text":       "/accessibility-tools/alt-text",
  "/math-ocr":       "/accessibility-tools/math-ocr",
};

// ─── Canonical alias redirects ───────────────────────────────────────────────
// /accessibility is a legacy alias for /pdf-accessibility. Redirect with 301
// so link authority and crawl signals consolidate on the canonical URL.
export const ALIAS_REDIRECTS: Record<string, string> = {
  "/accessibility": "/pdf-accessibility",
};

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Setup authentication (before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);

  // Redirect retired Toolkit tool paths to their in-app equivalents
  for (const [oldPath, idPath] of Object.entries(TOOLKIT_REDIRECTS)) {
    app.get(oldPath, (_req: Request, res: Response) => {
      res.redirect(301, idPath);
    });
  }

  // Redirect canonical alias paths (duplicate public routes) with 301
  for (const [oldPath, canonicalPath] of Object.entries(ALIAS_REDIRECTS)) {
    app.get(oldPath, (_req: Request, res: Response) => {
      res.redirect(301, canonicalPath);
    });
  }

  app.get("/api/deterministic-fixers", (_req: Request, res: Response) => {
    res.json({ keys: getDeterministicFixerKeys().sort() });
  });

  app.get("/api/config", (_req: Request, res: Response) => {
    res.json({ imageUploadMaxMB: IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024) });
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
      contextLeak: getContextLeakMetrics(),
      thresholds: {
        warnCount:     isNaN(warnCount)    ? 10   : warnCount,
        warnRate:      isNaN(warnRate)     ? 0.05 : warnRate,
        criticalCount: isNaN(criticalCount) ? 25  : criticalCount,
        criticalRate:  isNaN(criticalRate)  ? 0.10: criticalRate,
      },
    });
  });

  // =============================================
  // USER PREFERENCES ROUTES
  // =============================================

  const preferencesSchema = z.object({
    skipPreview: z.boolean().optional(),
    autoExpand: z.boolean().optional(),
    defaultLanguage: z.string().max(64).optional(),
    preferredTool: z.string().max(64).optional(),
    titleQualityMinLength: z.number().int().min(1).max(20).optional(),
  });

  app.get("/api/preferences", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const prefs = await storage.getUserPreferences(userId);
    res.json(prefs);
  });

  app.patch("/api/preferences", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid preferences", details: parsed.error.flatten() });
      return;
    }
    const updated = await storage.setUserPreferences(userId, parsed.data as Partial<UserPreferences>);
    res.json(updated);
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
    limits: { fileSize: DOCUMENT_UPLOAD_MAX_BYTES },
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

  // Magic-byte / embedded-zip-entry signatures for the binary document formats
  // that are unambiguous to detect. Used to catch a document uploaded with a
  // mismatched extension/MIME type (e.g. a real PDF renamed to .docx, or a
  // real DOCX renamed to .pdf) before it silently reaches extraction and
  // fails deep in the pipeline with only a generic "could not be read" error.
  // Mirrors the renamed-document detection added for /api/upload-syllabus in
  // instructional-designer/server/routes.ts (detectKnownBinaryDocumentType).
  const PDF_MAGIC = Buffer.from("%PDF");
  const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .doc/.xls/.ppt
  const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

  // UTF-16LE stream names embedded in OLE compound-file directory entries.
  // Scanning the leading bytes for these names disambiguates legacy .doc / .xls / .ppt
  // without a full OLE parse, the same technique used for OOXML part names.
  const OLE_STREAM_WORKBOOK = Buffer.from("Workbook", "utf16le");
  const OLE_STREAM_BOOK = Buffer.from("Book", "utf16le");
  const OLE_STREAM_PPT = Buffer.from("PowerPoint Document", "utf16le");

  type DetectedDocCategory = "pdf" | "docx" | "xlsx" | "pptx" | "doc" | "xls" | "ppt" | "odt" | "ods" | "odp" | "epub";

  const DETECTED_DOC_TYPES: Record<DetectedDocCategory, { label: string; extension: string }> = {
    pdf: { label: "PDF", extension: ".pdf" },
    docx: { label: "Word document (.docx)", extension: ".docx" },
    xlsx: { label: "Excel spreadsheet (.xlsx)", extension: ".xlsx" },
    pptx: { label: "PowerPoint presentation (.pptx)", extension: ".pptx" },
    doc: { label: "legacy Word document (.doc)", extension: ".doc" },
    xls: { label: "legacy Excel spreadsheet (.xls)", extension: ".xls" },
    ppt: { label: "legacy PowerPoint presentation (.ppt)", extension: ".ppt" },
    odt: { label: "OpenDocument text file (.odt)", extension: ".odt" },
    ods: { label: "OpenDocument spreadsheet (.ods)", extension: ".ods" },
    odp: { label: "OpenDocument presentation (.odp)", extension: ".odp" },
    epub: { label: "EPUB e-book (.epub)", extension: ".epub" },
  };

  // ODF and EPUB store a "mimetype" entry as the FIRST zip entry, uncompressed,
  // whose contents are exactly this string. Substring-matching the leading bytes
  // is enough to disambiguate these zip-based formats without a full unzip,
  // the same trick used for the OOXML part names below.
  const ODF_EPUB_MIMETYPES: Record<string, DetectedDocCategory> = {
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "application/vnd.oasis.opendocument.presentation": "odp",
    "application/epub+zip": "epub",
  };

  /**
   * Identifies the true document format from magic bytes / embedded zip entry
   * names, independent of the client-reported extension or MIME type. Returns
   * null if the buffer doesn't match one of the binary formats checked here
   * (plain text, RTF, HTML, or CSV).
   */
  function detectActualDocCategory(buffer: Buffer): DetectedDocCategory | null {
    if (buffer.length >= PDF_MAGIC.length && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      return "pdf";
    }
    if (buffer.length >= OLE_MAGIC.length && buffer.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC)) {
      // All legacy binary Office formats share the same OLE2 magic bytes, so
      // disambiguate by scanning the directory sector for well-known UTF-16LE
      // stream names — the same technique used for OOXML part names in zip files.
      const head = buffer.subarray(0, Math.min(buffer.length, 65536));
      if (head.includes(OLE_STREAM_WORKBOOK) || head.includes(OLE_STREAM_BOOK)) return "xls";
      if (head.includes(OLE_STREAM_PPT)) return "ppt";
      return "doc";
    }
    if (buffer.length >= ZIP_MAGIC.length && buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
      // Office Open XML part names are stored uncompressed in the zip's local
      // file headers, so a substring scan of the leading bytes is enough to
      // tell docx/xlsx/pptx apart without a full unzip.
      const head = buffer.subarray(0, Math.min(buffer.length, 65536));
      if (head.includes("word/document.xml")) return "docx";
      if (head.includes("xl/workbook.xml")) return "xlsx";
      if (head.includes("ppt/presentation.xml")) return "pptx";
      for (const [mimetype, category] of Object.entries(ODF_EPUB_MIMETYPES)) {
        if (head.includes(mimetype)) return category;
      }
      return null;
    }
    return null;
  }

  /**
   * Maps a resolved sourceType to the doc category its bytes should match,
   * for the formats where a magic-byte mismatch is unambiguous. Returns null
   * for formats not checked here (text-based formats).
   */
  function expectedDocCategoryForSourceType(sourceType: string): DetectedDocCategory | null {
    switch (sourceType) {
      case "pdf": return "pdf";
      case "docx": return "docx";
      case "xlsx": return "xlsx";
      case "pptx": return "pptx";
      case "doc": return "doc";
      case "xls": return "xls";
      case "ppt": return "ppt";
      case "odt": return "odt";
      case "ods": return "ods";
      case "odp": return "odp";
      case "epub": return "epub";
      default: return null;
    }
  }

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
          contentFidelity: conversions.contentFidelity,
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
          contentFidelity: conversions.contentFidelity,
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
      ensureVisitorToken(req);
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
  const uploadConcurrencyGuard = (_req: Request, res: Response, next: NextFunction) => {
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

      // Catch a document uploaded with a mismatched extension/MIME type
      // (e.g. a real PDF renamed to .docx) before it's stored and later
      // fails deep in extraction with only a generic "could not be read"
      // error. Only checked for the unambiguous binary formats above.
      const expectedCategory = expectedDocCategoryForSourceType(sourceType);
      const actualCategory = detectActualDocCategory(file.buffer);
      if (expectedCategory && actualCategory && actualCategory !== expectedCategory) {
        const detected = DETECTED_DOC_TYPES[actualCategory];
        res.status(400).json({
          error: `This file looks like a ${detected.label} that was uploaded with the wrong file extension. Please re-upload it with its original ${detected.extension} extension, or select the correct file.`,
          detectedType: detected.label,
        });
        return;
      }

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
        ensureVisitorToken(req);
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
        // A real DOCX export from Google is always at least several kilobytes.
        // Anything smaller is either an empty response or a truncated /
        // authentication-interstitial HTML page from Google — not a real file.
        if (buffer.length < 1024) {
          return res
            .status(502)
            .json({
              error:
                "The exported file is too small to be a real document — Google may have returned an authentication page or an empty response. Make sure the document is set to \"Anyone with the link\" and try again.",
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

        // Verify the buffer is a complete ZIP archive by looking for the
        // end-of-central-directory (EOCD) record (signature 50 4B 05 06).
        // A truncated export — e.g. the download was cut short or Google
        // returned an interstitial that coincidentally starts with the ZIP
        // magic bytes — will be missing this record at the end of the file.
        {
          const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
          const searchStart = Math.max(0, buffer.length - 65557);
          const tail = buffer.slice(searchStart);
          if (tail.lastIndexOf(EOCD_SIG) === -1) {
            return res.status(502).json({
              error:
                "The exported document appears to be incomplete or truncated. Google may have cut off the download early. Please try again, or download the file manually from Google Docs and upload it directly.",
            });
          }
        }

        // Catch an unexpected export format from Google's export API (e.g.
        // if Google ever returns a different container for this doc type)
        // before it's stored and later fails deep in extraction with only a
        // generic "could not be read" error.
        const expectedDocCategory = expectedDocCategoryForSourceType("docx");
        const actualDocCategory = detectActualDocCategory(buffer);
        if (expectedDocCategory && actualDocCategory && actualDocCategory !== expectedDocCategory) {
          const detected = DETECTED_DOC_TYPES[actualDocCategory];
          return res.status(400).json({
            error: `This Google Doc exported as a ${detected.label} instead of the expected Word document format. Please try again or download it manually and upload the file directly.`,
            detectedType: detected.label,
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
        ensureVisitorToken(req);
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
        // A real XLSX export from Google is always at least several kilobytes.
        // Anything smaller is either an empty response or a truncated /
        // authentication-interstitial HTML page from Google — not a real file.
        if (buffer.length < 1024) {
          return res
            .status(502)
            .json({
              error:
                "The exported file is too small to be a real spreadsheet — Google may have returned an authentication page or an empty response. Make sure the spreadsheet is set to \"Anyone with the link\" and try again.",
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

        // Verify the buffer is a complete ZIP archive by looking for the
        // end-of-central-directory (EOCD) record (signature 50 4B 05 06).
        // A truncated export — e.g. the download was cut short or Google
        // returned an interstitial that coincidentally starts with the ZIP
        // magic bytes — will be missing this record at the end of the file.
        {
          const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
          const searchStart = Math.max(0, buffer.length - 65557);
          const tail = buffer.slice(searchStart);
          if (tail.lastIndexOf(EOCD_SIG) === -1) {
            return res.status(502).json({
              error:
                "The exported spreadsheet appears to be incomplete or truncated. Google may have cut off the download early. Please try again, or download the file manually from Google Sheets and upload it directly.",
            });
          }
        }

        // Catch an unexpected export format from Google's export API (e.g.
        // if Google ever returns a different container for this doc type)
        // before it's stored and later fails deep in extraction with only a
        // generic "could not be read" error.
        const expectedSheetCategory = expectedDocCategoryForSourceType("xlsx");
        const actualSheetCategory = detectActualDocCategory(buffer);
        if (expectedSheetCategory && actualSheetCategory && actualSheetCategory !== expectedSheetCategory) {
          const detected = DETECTED_DOC_TYPES[actualSheetCategory];
          return res.status(400).json({
            error: `This Google Sheet exported as a ${detected.label} instead of the expected spreadsheet format. Please try again or download it manually and upload the file directly.`,
            detectedType: detected.label,
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
        ensureVisitorToken(req);
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
        // A real PPTX export from Google is always at least several kilobytes.
        // Anything smaller is either an empty response or a truncated /
        // authentication-interstitial HTML page from Google — not a real file.
        if (buffer.length < 1024) {
          return res
            .status(502)
            .json({
              error:
                "The exported file is too small to be a real presentation — Google may have returned an authentication page or an empty response. Make sure the presentation is set to \"Anyone with the link\" and try again.",
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

        // Verify the buffer is a complete ZIP archive by looking for the
        // end-of-central-directory (EOCD) record (signature 50 4B 05 06).
        // A truncated export — e.g. the download was cut short or Google
        // returned an interstitial that coincidentally starts with the ZIP
        // magic bytes — will be missing this record at the end of the file.
        {
          const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
          const searchStart = Math.max(0, buffer.length - 65557);
          const tail = buffer.slice(searchStart);
          if (tail.lastIndexOf(EOCD_SIG) === -1) {
            return res.status(502).json({
              error:
                "The exported presentation appears to be incomplete or truncated. Google may have cut off the download early. Please try again, or download the file manually from Google Slides and upload it directly.",
            });
          }
        }

        // Catch an unexpected export format from Google's export API (e.g.
        // if Google ever returns a different container for this doc type)
        // before it's stored and later fails deep in extraction with only a
        // generic "could not be read" error.
        const expectedSlideCategory = expectedDocCategoryForSourceType("pptx");
        const actualSlideCategory = detectActualDocCategory(buffer);
        if (expectedSlideCategory && actualSlideCategory && actualSlideCategory !== expectedSlideCategory) {
          const detected = DETECTED_DOC_TYPES[actualSlideCategory];
          return res.status(400).json({
            error: `This Google Slides presentation exported as a ${detected.label} instead of the expected presentation format. Please try again or download it manually and upload the file directly.`,
            detectedType: detected.label,
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

      // Faculty can tighten or loosen the "is this title too generic/short?"
      // heuristic via their preferences; anonymous users get the default.
      const { resolveMinQualityTitleLength } = await import("./lib/accessibility-engine.js");
      let minQualityTitleLength = resolveMinQualityTitleLength();
      if (userId) {
        try {
          const prefs = await storage.getUserPreferences(userId);
          minQualityTitleLength = resolveMinQualityTitleLength(prefs.titleQualityMinLength);
        } catch (e) {
          console.error("Failed to load user preferences for title quality threshold:", e);
        }
      }

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
        // Register so the cancel endpoint can abort this job by conversion ID.
        activeAbortControllers.set(id, abortController);
        // Mirror any abort (timeout OR user-cancel) into the local flag so
        // post-completion write guards and concurrency accounting behave
        // identically regardless of what triggered the abort.
        abortController.signal.addEventListener("abort", () => { aborted = true; }, { once: true });

        // Polls the DB status at each expensive checkpoint so a cancel request
        // that landed on a different server instance (where activeAbortControllers
        // has no entry for this job) is still noticed promptly.  Calling this at
        // a handful of checkpoints rather than on a tight loop keeps round-trips
        // low while still terminating wasted AI work within one pipeline stage.
        //
        // Failure mode: if the DB read itself throws (e.g. transient connection
        // loss), we log a warning and return normally so the job is not failed on
        // a fleeting infrastructure hiccup.  Deliberate cancels still reach the
        // job via the in-process AbortController signal, so user-initiated stops
        // still work even when the DB poll is degraded.
        const checkCancelledByDb = async () => {
          if (aborted) throw new Error("aborted");
          let row: { status: string } | undefined;
          try {
            const [r] = await db
              .select({ status: conversions.status })
              .from(conversions)
              .where(eq(conversions.id, id));
            row = r;
          } catch (pollErr) {
            console.warn(
              `[conversion ${id}] checkCancelledByDb: transient DB read failure — ` +
                `continuing job rather than failing on a poll error:`,
              pollErr,
            );
            return; // let the job continue; the timeout guard still applies
          }
          if (row?.status !== "processing") {
            // Status was flipped externally (e.g. cancel from another instance).
            // Firing abort triggers the signal listener which sets aborted = true.
            abortController.abort();
            throw new Error("aborted");
          }
        };

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
          const { generateAccessibleDocument, evaluateOriginalDocument, predictTruncationWarning } =
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

          // Bail out early if the timeout fired during extraction, or if a
          // cancel from another server instance already flipped the DB status.
          await checkCancelledByDb();

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

          // Bail out before the most expensive AI step if already timed out or
          // if a cancel from another server instance flipped the DB status.
          await checkCancelledByDb();

          // Warn the user up front — before the multi-minute AI conversion
          // step runs — if the extracted text is large enough to hit the
          // MAX_CHUNKS cap. Without this, faculty uploading a very large
          // document (e.g. a full course reader) only find out at the very
          // end that the tail of their document was dropped. This early
          // warning is superseded by the authoritative post-hoc
          // truncationWarning once conversion completes.
          const earlyTruncationWarning = predictTruncationWarning(finalText);
          if (earlyTruncationWarning) {
            await db
              .update(conversions)
              .set({
                extractionWarnings: [
                  ...(extraction.warnings || []),
                  earlyTruncationWarning,
                ],
                updatedAt: new Date(),
              })
              .where(eq(conversions.id, id));
          }

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
            ocrApplied,
            minQualityTitleLength,
            ocrApplied ? undefined : extraction.headingLines,
          );

          // Guard the success write: if the timeout fired (or a cancel from
          // another server instance flipped the DB status) while
          // generateAccessibleDocument was running, bail out now rather than
          // overwriting the externally-written "failed" status.
          await checkCancelledByDb();

          // Only write "completed" if the row is still in "processing" state.
          // A user-cancel may have already flipped it to "failed"; this
          // conditional WHERE prevents that cancel from being silently undone.
          const completionWrite = await db
            .update(conversions)
            .set({
              status: "completed",
              statusMessage: null,
              pageCount: extraction.pageCount,
              extractedText: finalText.substring(0, 50000),
              accessibleHtml: result.accessibleHtml,
              complianceReport: result.complianceReport,
              originalComplianceReport: originalReport,
              contentFidelity: result.contentFidelity ?? null,
              ocrApplied,
              pdfData: null,
              extractionWarnings: (() => {
                const warnings = [...(extraction.warnings || [])];
                if (result.truncationWarning) warnings.push(result.truncationWarning);
                return warnings.length > 0 ? warnings : null;
              })(),
              updatedAt: new Date(),
            })
            .where(and(eq(conversions.id, id), eq(conversions.status, "processing")))
            .returning({ id: conversions.id });

          // If 0 rows were updated the status was flipped externally (e.g. by
          // a user-cancel) while AI work was still running. Skip success-only
          // side effects (completion email, success log) — the job is not done.
          if (completionWrite.length === 0) return;

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
          // Skip the error write when aborted: the timeout handler already wrote
          // a "failed" status, and a user-cancel may have written a friendly
          // cancel message — overwriting either with "aborted" would corrupt state.
          if (!aborted) {
            await db
              .update(conversions)
              .set({
                status: "failed",
                statusMessage: null,
                errorMessage: err.message || "Processing failed",
                updatedAt: new Date(),
              })
              .where(eq(conversions.id, id));
          }
        } finally {
          clearTimeout(timeoutId);
          activeAbortControllers.delete(id);
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

      // Faculty can tighten or loosen the "is this title too generic/short?"
      // heuristic via their preferences; anonymous users get the default.
      const { resolveMinQualityTitleLength } = await import("./lib/accessibility-engine.js");
      let reprocessMinQualityTitleLength = resolveMinQualityTitleLength();
      if (userId) {
        try {
          const prefs = await storage.getUserPreferences(userId);
          reprocessMinQualityTitleLength = resolveMinQualityTitleLength(prefs.titleQualityMinLength);
        } catch (e) {
          console.error("Failed to load user preferences for title quality threshold:", e);
        }
      }

      // Background work — same pattern as the main /process route.
      const REPROCESS_TIMEOUT_MS = 10 * 60 * 1000;
      activeProcessingJobs++;
      (async () => {
        const conversionStart = Date.now();
        const abortController = new AbortController();
        // Register so the cancel endpoint can abort this job by conversion ID.
        activeAbortControllers.set(id, abortController);
        let aborted = false;
        // Mirror any abort (timeout OR user-cancel) into the local flag so
        // post-completion write guards behave identically regardless of trigger.
        abortController.signal.addEventListener("abort", () => { aborted = true; }, { once: true });

        // Polls the DB status before the expensive AI step so a cancel request
        // that landed on a different server instance is still noticed promptly.
        //
        // Failure mode: if the DB read itself throws (e.g. transient connection
        // loss), we log a warning and return normally so the job is not failed on
        // a fleeting infrastructure hiccup.  Deliberate cancels still reach the
        // job via the in-process AbortController signal, so user-initiated stops
        // still work even when the DB poll is degraded.
        const checkCancelledByDb = async () => {
          if (aborted) throw new Error("aborted");
          let row: { status: string } | undefined;
          try {
            const [r] = await db
              .select({ status: conversions.status })
              .from(conversions)
              .where(eq(conversions.id, id));
            row = r;
          } catch (pollErr) {
            console.warn(
              `[conversion ${id}] checkCancelledByDb: transient DB read failure — ` +
                `continuing job rather than failing on a poll error:`,
              pollErr,
            );
            return; // let the job continue; the timeout guard still applies
          }
          if (row?.status !== "processing") {
            abortController.abort();
            throw new Error("aborted");
          }
        };

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
          const { generateAccessibleDocument, predictTruncationWarning } = await import("./lib/accessibility-engine.js");

          // Warn up front, before the multi-minute AI step runs, if the
          // stored extracted text is large enough to hit the MAX_CHUNKS cap.
          // Superseded by the authoritative post-hoc truncationWarning below
          // once re-conversion completes.
          const earlyTruncationWarning = predictTruncationWarning(conversion.extractedText!);
          if (earlyTruncationWarning) {
            const existingWarnings = (conversion.extractionWarnings as string[] | null) || [];
            await db
              .update(conversions)
              .set({
                extractionWarnings: [...existingWarnings, earlyTruncationWarning],
                updatedAt: new Date(),
              })
              .where(eq(conversions.id, id));
          }

          // Check before starting the expensive AI step — catches a cross-instance
          // cancel that arrived while the early-truncation-warning DB write ran.
          await checkCancelledByDb();

          const result = await generateAccessibleDocument(
            conversion.extractedText!,
            conversion.originalFilename,
            { title: conversion.originalFilename.replace(/\.[^.]+$/, "") },
            [],
            [],
            conversion.pageCount ?? undefined,
            updateStatus,
            abortController.signal,
            conversion.ocrApplied ?? false,
            reprocessMinQualityTitleLength,
          );

          // Check again after AI generation: another instance may have cancelled
          // while the multi-minute model call was in flight.
          await checkCancelledByDb();

          const mergedWarnings = [
            ...((conversion.extractionWarnings as string[] | null) || []),
            ...(result.truncationWarning ? [result.truncationWarning] : []),
          ];

          // Only write "completed" if the row is still in "processing" state.
          // A user-cancel may have already flipped it to "failed"; this
          // conditional WHERE prevents that cancel from being silently undone.
          await db.update(conversions).set({
            status: "completed",
            statusMessage: null,
            accessibleHtml: result.accessibleHtml,
            complianceReport: result.complianceReport,
            contentFidelity: result.contentFidelity ?? null,
            extractionWarnings: mergedWarnings.length > 0 ? mergedWarnings : null,
            updatedAt: new Date(),
          }).where(and(eq(conversions.id, id), eq(conversions.status, "processing")));

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
          activeAbortControllers.delete(id);
          activeProcessingJobs = Math.max(0, activeProcessingJobs - 1);
          activeProcessingKeys.delete(reprocessKey);
        }
      })();
    },
  );

  // Cancel an in-flight conversion that has the early large-document warning.
  // Marks the conversion as failed so the faculty member can split the document
  // and re-upload smaller pieces rather than waiting for a partial result.
  app.post(
    "/api/conversions/:id/cancel",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const [conversion] = await db
        .select({ id: conversions.id, status: conversions.status })
        .from(conversions)
        .where(conversionOwnerFilter(id, userId, getVisitorToken(req)));

      if (!conversion) {
        res.status(404).json({ error: "Conversion not found." });
        return;
      }

      if (conversion.status !== "processing") {
        res.status(409).json({ error: "Conversion is not currently processing." });
        return;
      }

      // Atomically flip the status to "failed" so the background job will
      // notice it has been superseded and suppress its own status write.
      const cancelled = await db
        .update(conversions)
        .set({
          status: "failed",
          statusMessage: null,
          errorMessage: "Cancelled by user. You can split the document and re-upload smaller pieces.",
          updatedAt: new Date(),
        })
        .where(and(eq(conversions.id, id), eq(conversions.status, "processing")))
        .returning({ id: conversions.id });

      if (cancelled.length === 0) {
        // Status was no longer "processing" when we arrived — already completed,
        // failed, or another request beat us to the cancel.
        res.status(409).json({ error: "Conversion is no longer processing and cannot be cancelled." });
        return;
      }

      // Signal the background job (if still running on this instance) to stop
      // all in-flight Anthropic requests immediately.
      const ctrl = activeAbortControllers.get(id);
      if (ctrl) {
        ctrl.abort();
      }

      res.json({ id, status: "failed" });
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
        const { fixComplianceIssue, resolveMinQualityTitleLength } = await import(
          "./lib/accessibility-engine"
        );
        let fixMinQualityTitleLength = resolveMinQualityTitleLength();
        if (userId) {
          try {
            const prefs = await storage.getUserPreferences(userId);
            fixMinQualityTitleLength = resolveMinQualityTitleLength(prefs.titleQualityMinLength);
          } catch (e) {
            console.error("Failed to load user preferences for title quality threshold:", e);
          }
        }
        const result = await fixComplianceIssue(
          conversion.accessibleHtml,
          report.issues[issueIndex],
          issueIndex,
          report,
          fixMinQualityTitleLength,
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

  const MAX_CUSTOM_PAGE_TITLE_LENGTH = 200;

  app.post(
    "/api/conversions/:id/set-page-title",
    optionalAuth,
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        res.status(400).json({ error: INVALID_ID_ERROR });
        return;
      }

      const { title } = req.body as { title?: unknown };
      if (typeof title !== "string" || !title.trim()) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      const trimmedTitle = title.trim();
      if (trimmedTitle.length > MAX_CUSTOM_PAGE_TITLE_LENGTH) {
        res.status(400).json({
          error: `title must be ${MAX_CUSTOM_PAGE_TITLE_LENGTH} characters or fewer`,
        });
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

      const updatedHtml = applyCustomPageTitle(conversion.accessibleHtml, trimmedTitle);

      const report = conversion.complianceReport as any;
      let updatedReport = report;
      if (report?.issues) {
        const issues = report.issues.map((iss: any) => {
          if (iss.criterion === "2.4.2" && iss.title === "Page Titled") {
            const { fixNotes, ...rest } = iss;
            return {
              ...rest,
              status: "fixed",
              details: `Title set to '${trimmedTitle}' by faculty member.`,
            };
          }
          return iss;
        });
        const fixedCount = issues.filter((iss: any) => iss.status === "fixed").length;
        const passCount = issues.filter((iss: any) => iss.status === "pass").length;
        const failCount = issues.filter((iss: any) => iss.status === "fail").length;
        const warningCount = issues.filter((iss: any) => iss.status === "warning").length;
        const acceptedCount = issues.filter((iss: any) => iss.status === "accepted").length;
        updatedReport = {
          ...report,
          issues,
          fixedCount,
          passCount,
          failCount,
          warningCount,
          acceptedCount,
        };
      }

      const [updated] = await db
        .update(conversions)
        .set({
          accessibleHtml: updatedHtml,
          complianceReport: updatedReport,
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

      res.json(updated);
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
          complianceReport: conversions.complianceReport,
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

      const preHeadingFixLevel = getFirstHeadingLevel(conversion.accessibleHtml);
      let html = applyHeadingHierarchyFix(conversion.accessibleHtml);
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

      {
        const autoFixNotes: string[] = [];
        if (preHeadingFixLevel && preHeadingFixLevel !== 1) {
          autoFixNotes.push(buildHeadingRenumberedNoteHtml(preHeadingFixLevel));
        }
        const reportIssues: Array<{ criterion?: string; fixNotes?: string }> =
          (conversion.complianceReport as any)?.issues ?? [];
        if (reportIssues.some((iss) => iss.criterion === "2.4.1" && iss.fixNotes === BYPASS_BLOCKS_FIX_NOTE)) {
          autoFixNotes.push(buildMainLandmarkNoteHtml());
        }
        const pageTitleIssue = reportIssues.find((iss) => iss.criterion === "2.4.2" && iss.fixNotes);
        if (pageTitleIssue?.fixNotes === PAGE_TITLE_FALLBACK_NOTE) {
          autoFixNotes.push(buildPageTitleFallbackNoteHtml());
        } else if (pageTitleIssue?.fixNotes === PAGE_TITLE_LOW_QUALITY_NOTE) {
          autoFixNotes.push(buildPageTitleLowQualityNoteHtml());
        }
        if (autoFixNotes.length > 0) {
          const notesHtml = autoFixNotes.join("\n");
          const bodyOpenMatch = html.match(/<body[^>]*>/i);
          if (bodyOpenMatch) {
            const insertAt = html.indexOf(bodyOpenMatch[0]) + bodyOpenMatch[0].length;
            html = html.slice(0, insertAt) + "\n" + notesHtml + html.slice(insertAt);
          }
        }
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
          complianceReport: conversions.complianceReport,
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
        ensureVisitorToken(req);
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

      const preHeadingFixLevel = getFirstHeadingLevel(conversion.accessibleHtml);
      let html = applyHeadingHierarchyFix(conversion.accessibleHtml);
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

      {
        const autoFixNotes: string[] = [];
        if (preHeadingFixLevel && preHeadingFixLevel !== 1) {
          autoFixNotes.push(buildHeadingRenumberedNoteHtml(preHeadingFixLevel));
        }
        const reportIssues: Array<{ criterion?: string; fixNotes?: string }> =
          (conversion.complianceReport as any)?.issues ?? [];
        if (reportIssues.some((iss) => iss.criterion === "2.4.1" && iss.fixNotes === BYPASS_BLOCKS_FIX_NOTE)) {
          autoFixNotes.push(buildMainLandmarkNoteHtml());
        }
        const pageTitleIssue = reportIssues.find((iss) => iss.criterion === "2.4.2" && iss.fixNotes);
        if (pageTitleIssue?.fixNotes === PAGE_TITLE_FALLBACK_NOTE) {
          autoFixNotes.push(buildPageTitleFallbackNoteHtml());
        } else if (pageTitleIssue?.fixNotes === PAGE_TITLE_LOW_QUALITY_NOTE) {
          autoFixNotes.push(buildPageTitleLowQualityNoteHtml());
        }
        if (autoFixNotes.length > 0) {
          const notesHtml = autoFixNotes.join("\n");
          const bodyOpenMatch = html.match(/<body[^>]*>/i);
          if (bodyOpenMatch) {
            const insertAt = html.indexOf(bodyOpenMatch[0]) + bodyOpenMatch[0].length;
            html = html.slice(0, insertAt) + "\n" + notesHtml + html.slice(insertAt);
          }
        }
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
          complianceReport: conversions.complianceReport,
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
        ensureVisitorToken(req);
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

      const preHeadingFixLevel = getFirstHeadingLevel(conversion.accessibleHtml);
      let html = applyHeadingHierarchyFix(conversion.accessibleHtml);
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

      {
        const autoFixNotes: string[] = [];
        if (preHeadingFixLevel && preHeadingFixLevel !== 1) {
          autoFixNotes.push(buildHeadingRenumberedNoteHtml(preHeadingFixLevel));
        }
        const reportIssues: Array<{ criterion?: string; fixNotes?: string }> =
          (conversion.complianceReport as any)?.issues ?? [];
        if (reportIssues.some((iss) => iss.criterion === "2.4.1" && iss.fixNotes === BYPASS_BLOCKS_FIX_NOTE)) {
          autoFixNotes.push(buildMainLandmarkNoteHtml());
        }
        const pageTitleIssue = reportIssues.find((iss) => iss.criterion === "2.4.2" && iss.fixNotes);
        if (pageTitleIssue?.fixNotes === PAGE_TITLE_FALLBACK_NOTE) {
          autoFixNotes.push(buildPageTitleFallbackNoteHtml());
        } else if (pageTitleIssue?.fixNotes === PAGE_TITLE_LOW_QUALITY_NOTE) {
          autoFixNotes.push(buildPageTitleLowQualityNoteHtml());
        }
        if (autoFixNotes.length > 0) {
          const notesHtml = autoFixNotes.join("\n");
          const bodyOpenMatch = html.match(/<body[^>]*>/i);
          if (bodyOpenMatch) {
            const insertAt = html.indexOf(bodyOpenMatch[0]) + bodyOpenMatch[0].length;
            html = html.slice(0, insertAt) + "\n" + notesHtml + html.slice(insertAt);
          }
        }
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
    // GET /api/test/login
    // Browser-redirect variant of the test login used by Playwright E2E tests
    // that need to prove the full returnTo redirect chain without going through
    // real OIDC.  Accepts the same user fields as the POST variant but reads
    // them from query parameters.  On success it issues a 302 redirect to the
    // `returnTo` query param (must start with "/" and not "//"), falling back
    // to "/" when returnTo is absent or invalid.
    app.get("/api/test/login", async (req: Request, res: Response) => {
      const { sub, email, firstName, lastName, returnTo } = req.query as {
        sub?: string;
        email?: string;
        firstName?: string;
        lastName?: string;
        returnTo?: string;
      };
      if (!sub || !email) {
        res.status(400).json({ error: "sub and email are required" });
        return;
      }
      const safeReturnTo =
        typeof returnTo === "string" &&
        returnTo.startsWith("/") &&
        !returnTo.startsWith("//")
          ? returnTo
          : "/";
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
        res.redirect(safeReturnTo);
      });
    });

    // POST /api/test/login
    // Creates a server-side session for a synthetic user without going through
    // the real Replit OIDC flow. Used by Playwright E2E tests.
    app.post("/api/test/login", async (req: Request, res: Response) => {
      const { sub, email, firstName, lastName, returnTo } = req.body as {
        sub: string;
        email: string;
        firstName?: string;
        lastName?: string;
        returnTo?: string;
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
        const safeReturnTo =
          typeof returnTo === "string" &&
          returnTo.startsWith("/") &&
          !returnTo.startsWith("//")
            ? returnTo
            : null;
        if (safeReturnTo) {
          res.redirect(safeReturnTo);
        } else {
          res.json({ ok: true, sub, email, sessionId: req.sessionID });
        }
      });
    });

    // GET /api/test/expired-signed-state
    // Returns a signed-state token whose embedded timestamp is 15 minutes in
    // the past — beyond the 10-minute TTL — so verifyReturnToState() returns
    // { expired: true }.  Used by Playwright e2e tests to trigger the
    // slow-sign-in notice without waiting 10+ minutes for a real token to age.
    // Disabled in production AND requires PLAYWRIGHT_TEST=1.
    if (process.env.PLAYWRIGHT_TEST === "1") app.get("/api/test/expired-signed-state", (req: Request, res: Response) => {
      const { returnTo } = req.query as { returnTo?: string };
      const safePath =
        typeof returnTo === "string" &&
        returnTo.startsWith("/") &&
        !returnTo.startsWith("//")
          ? returnTo
          : "/";
      const payload = JSON.stringify({
        v: "v1",
        r: safePath,
        t: Math.floor(Date.now() / 1000) - 15 * 60,
      });
      const data = Buffer.from(payload).toString("base64url");
      const sig = createHmac("sha256", process.env.SESSION_SECRET!)
        .update(data)
        .digest("base64url");
      res.json({ state: `${data}.${sig}` });
    });

    // GET /api/test/sign-state
    // Returns a freshly-signed state token for the given returnTo path, using
    // the same signing logic as signReturnToState() in replitAuth.ts.  Tests
    // can use this to construct a valid state token without knowing SESSION_SECRET
    // and without going through a live OIDC authorization flow.
    // Used by the third-party-cookie-redirect Playwright test.
    // Disabled in production AND requires PLAYWRIGHT_TEST=1.
    if (process.env.PLAYWRIGHT_TEST === "1") app.get("/api/test/sign-state", (req: Request, res: Response) => {
      const { returnTo } = req.query as { returnTo?: string };
      const safePath =
        typeof returnTo === "string" &&
        returnTo.startsWith("/") &&
        !returnTo.startsWith("//")
          ? returnTo
          : "/";
      const payload = JSON.stringify({
        v: "v1",
        r: safePath,
        t: Math.floor(Date.now() / 1000),
      });
      const data = Buffer.from(payload).toString("base64url");
      const sig = createHmac("sha256", process.env.SESSION_SECRET!)
        .update(data)
        .digest("base64url");
      res.json({ state: `${data}.${sig}` });
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
        contentFidelity,
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
        contentFidelity?: unknown;
      };

      try {
        const visitorToken = userId ? null : ensureVisitorToken(req);
        const [row] = await db
          .insert(conversions)
          .values({
            userId: userId ?? null,
            visitorToken,
            originalFilename: originalFilename ?? "test-document.pdf",
            fileSize: 1024,
            sourceType: sourceType ?? "pdf",
            status: status ?? "completed",
            errorMessage: errorMessage ?? null,
            complianceReport: complianceReport ?? null,
            originalComplianceReport: originalComplianceReport ?? complianceReport ?? null,
            accessibleHtml: accessibleHtml ?? null,
            manualFixItems: manualFixItems ?? null,
            contentFidelity: contentFidelity ?? null,
          })
          .returning({ id: conversions.id });

        res.status(201).json({ id: row.id });
      } catch (err) {
        console.error("[test] seed-conversion failed:", err);
        res.status(500).json({ error: String(err) });
      }
    });
  }

  // ─── Admin routes ──────────────────────────────────────────────────────────

  app.get("/api/admin/check", isAuthenticated, isAdmin, (_req: Request, res: Response) => {
    res.json({ isAdmin: true });
  });

  app.get("/api/admin/stats", isAuthenticated, isAdmin, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      // Totals
      const [totalCoursesRow] = await db.select({ count: sql<number>`count(*)::int` }).from(courses);
      const [totalContentRow] = await db.select({ count: sql<number>`count(*)::int` }).from(generatedContent);
      const [totalConversionsRow] = await db.select({ count: sql<number>`count(*)::int` }).from(conversions);
      const [totalUsersRow] = await db.select({ count: sql<number>`count(*)::int` }).from(users);

      // Monthly activity: courses and content by month (last 6 months)
      const coursesByMonth = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${courses.createdAt}), 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
        })
        .from(courses)
        .where(sql`${courses.createdAt} >= ${sixMonthsAgo}`)
        .groupBy(sql`date_trunc('month', ${courses.createdAt})`)
        .orderBy(sql`date_trunc('month', ${courses.createdAt})`);

      const contentByMonth = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${generatedContent.createdAt}), 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
        })
        .from(generatedContent)
        .where(sql`${generatedContent.createdAt} >= ${sixMonthsAgo}`)
        .groupBy(sql`date_trunc('month', ${generatedContent.createdAt})`)
        .orderBy(sql`date_trunc('month', ${generatedContent.createdAt})`);

      const conversionsByMonth = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${conversions.createdAt}), 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
        })
        .from(conversions)
        .where(sql`${conversions.createdAt} >= ${sixMonthsAgo}`)
        .groupBy(sql`date_trunc('month', ${conversions.createdAt})`)
        .orderBy(sql`date_trunc('month', ${conversions.createdAt})`);

      // Build unified monthly trend with all 6 months present
      const months: string[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - i);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      const courseMap = Object.fromEntries(coursesByMonth.map((r) => [r.month, r.count]));
      const contentMap = Object.fromEntries(contentByMonth.map((r) => [r.month, r.count]));
      const conversionsMap = Object.fromEntries(conversionsByMonth.map((r) => [r.month, r.count]));
      const monthlyActivity = months.map((month) => ({
        month,
        courses: courseMap[month] ?? 0,
        content: contentMap[month] ?? 0,
        conversions: conversionsMap[month] ?? 0,
      }));

      // Tool popularity
      const toolPopularity = await db
        .select({
          toolName: generatedContent.toolName,
          count: sql<number>`count(*)::int`,
        })
        .from(generatedContent)
        .groupBy(generatedContent.toolName)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      // Document conversion stats by status and source type
      const conversionsByStatus = await db
        .select({
          status: conversions.status,
          count: sql<number>`count(*)::int`,
        })
        .from(conversions)
        .groupBy(conversions.status)
        .orderBy(desc(sql`count(*)`));

      const conversionsBySource = await db
        .select({
          sourceType: conversions.sourceType,
          count: sql<number>`count(*)::int`,
        })
        .from(conversions)
        .groupBy(conversions.sourceType)
        .orderBy(desc(sql`count(*)`));

      // Recent activity (latest 10 content items)
      const recentContent = await db
        .select({
          id: generatedContent.id,
          toolName: generatedContent.toolName,
          toolType: generatedContent.toolType,
          createdAt: generatedContent.createdAt,
          userId: generatedContent.userId,
        })
        .from(generatedContent)
        .orderBy(desc(generatedContent.createdAt))
        .limit(10);

      // User activity: users ranked by total content generated
      const userActivity = await db
        .select({
          userId: generatedContent.userId,
          contentCount: sql<number>`count(*)::int`,
        })
        .from(generatedContent)
        .where(sql`${generatedContent.userId} is not null`)
        .groupBy(generatedContent.userId)
        .orderBy(desc(sql`count(*)`))
        .limit(20);

      // Enrich user activity with user info
      const userIds = userActivity
        .map((r) => r.userId)
        .filter(Boolean) as string[];

      let userInfoMap: Record<string, { email: string | null; firstName: string | null; lastName: string | null }> = {};
      if (userIds.length > 0) {
        const userRows = await db
          .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds));
        userInfoMap = Object.fromEntries(
          userRows.map((u) => [u.id, { email: u.email ?? null, firstName: u.firstName ?? null, lastName: u.lastName ?? null }]),
        );
      }

      const enrichedUserActivity = userActivity.map((r) => ({
        userId: r.userId,
        contentCount: r.contentCount,
        email: r.userId ? (userInfoMap[r.userId]?.email ?? null) : null,
        firstName: r.userId ? (userInfoMap[r.userId]?.firstName ?? null) : null,
        lastName: r.userId ? (userInfoMap[r.userId]?.lastName ?? null) : null,
      }));

      res.json({
        totals: {
          courses: totalCoursesRow?.count ?? 0,
          content: totalContentRow?.count ?? 0,
          conversions: totalConversionsRow?.count ?? 0,
          users: totalUsersRow?.count ?? 0,
        },
        monthlyActivity,
        toolPopularity,
        conversionsByStatus,
        conversionsBySource,
        recentActivity: recentContent,
        userActivity: enrichedUserActivity,
      });
    } catch (err) {
      console.error("[admin/stats] failed:", err);
      res.status(500).json({ error: "Failed to load admin stats" });
    }
  });

  app.get("/api/admin/stats/export", isAuthenticated, isAdmin, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      // Totals
      const [totalCoursesRow] = await db.select({ count: sql<number>`count(*)::int` }).from(courses);
      const [totalContentRow] = await db.select({ count: sql<number>`count(*)::int` }).from(generatedContent);
      const [totalConversionsRow] = await db.select({ count: sql<number>`count(*)::int` }).from(conversions);
      const [totalUsersRow] = await db.select({ count: sql<number>`count(*)::int` }).from(users);

      // Monthly activity (last 6 months)
      const months: string[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - i);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }

      const coursesByMonth = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${courses.createdAt}), 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
        })
        .from(courses)
        .where(sql`${courses.createdAt} >= ${sixMonthsAgo}`)
        .groupBy(sql`date_trunc('month', ${courses.createdAt})`)
        .orderBy(sql`date_trunc('month', ${courses.createdAt})`);

      const contentByMonth = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${generatedContent.createdAt}), 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
        })
        .from(generatedContent)
        .where(sql`${generatedContent.createdAt} >= ${sixMonthsAgo}`)
        .groupBy(sql`date_trunc('month', ${generatedContent.createdAt})`)
        .orderBy(sql`date_trunc('month', ${generatedContent.createdAt})`);

      const conversionsByMonth = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${conversions.createdAt}), 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
        })
        .from(conversions)
        .where(sql`${conversions.createdAt} >= ${sixMonthsAgo}`)
        .groupBy(sql`date_trunc('month', ${conversions.createdAt})`)
        .orderBy(sql`date_trunc('month', ${conversions.createdAt})`);

      const courseMap = Object.fromEntries(coursesByMonth.map((r) => [r.month, r.count]));
      const contentMap = Object.fromEntries(contentByMonth.map((r) => [r.month, r.count]));
      const conversionsMap = Object.fromEntries(conversionsByMonth.map((r) => [r.month, r.count]));
      const monthlyActivity = months.map((month) => ({
        month,
        courses: courseMap[month] ?? 0,
        content: contentMap[month] ?? 0,
        conversions: conversionsMap[month] ?? 0,
      }));

      // Tool popularity
      const toolPopularity = await db
        .select({
          toolName: generatedContent.toolName,
          count: sql<number>`count(*)::int`,
        })
        .from(generatedContent)
        .groupBy(generatedContent.toolName)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      // User activity
      const userActivity = await db
        .select({
          userId: generatedContent.userId,
          contentCount: sql<number>`count(*)::int`,
        })
        .from(generatedContent)
        .where(sql`${generatedContent.userId} is not null`)
        .groupBy(generatedContent.userId)
        .orderBy(desc(sql`count(*)`))
        .limit(20);

      const userIds = userActivity.map((r) => r.userId).filter(Boolean) as string[];
      let userInfoMap: Record<string, { email: string | null; firstName: string | null; lastName: string | null }> = {};
      if (userIds.length > 0) {
        const userRows = await db
          .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds));
        userInfoMap = Object.fromEntries(
          userRows.map((u) => [u.id, { email: u.email ?? null, firstName: u.firstName ?? null, lastName: u.lastName ?? null }]),
        );
      }

      function csvEscape(value: string | number | null | undefined): string {
        if (value === null || value === undefined) return "";
        const str = String(value);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }

      const rows: string[] = [];

      // Section 1: Summary metrics
      rows.push("Section,Metric,Value");
      rows.push(`Summary,Total Courses,${totalCoursesRow?.count ?? 0}`);
      rows.push(`Summary,Total Content Generated,${totalContentRow?.count ?? 0}`);
      rows.push(`Summary,Total Conversions,${totalConversionsRow?.count ?? 0}`);
      rows.push(`Summary,Total Users,${totalUsersRow?.count ?? 0}`);
      rows.push("");

      // Section 2: Monthly activity
      rows.push("Month,Courses,Content Generated,Conversions");
      for (const row of monthlyActivity) {
        rows.push(`${csvEscape(row.month)},${row.courses},${row.content},${row.conversions}`);
      }
      rows.push("");

      // Section 3: Tool popularity
      rows.push("Tool Name,Usage Count");
      for (const row of toolPopularity) {
        rows.push(`${csvEscape(row.toolName)},${row.count}`);
      }
      rows.push("");

      // Section 4: Per-user content counts
      rows.push("User ID,Name,Email,Content Generated");
      for (const row of userActivity) {
        const info = row.userId ? (userInfoMap[row.userId] ?? {}) : {};
        const name = [
          (info as { firstName?: string | null }).firstName,
          (info as { lastName?: string | null }).lastName,
        ].filter(Boolean).join(" ");
        rows.push(
          [
            csvEscape(row.userId),
            csvEscape(name || null),
            csvEscape((info as { email?: string | null }).email),
            csvEscape(row.contentCount),
          ].join(","),
        );
      }

      const exportDate = now.toISOString().slice(0, 10);
      const csvContent = rows.join("\r\n");

      // Log this export only after the response is fully flushed so interrupted
      // transfers do not produce a false "successful export" audit row.
      const exportingUserId = getUserId(_req);
      if (exportingUserId) {
        const rowCountsSnapshot = {
          courses: totalCoursesRow?.count ?? 0,
          content: totalContentRow?.count ?? 0,
          conversions: totalConversionsRow?.count ?? 0,
          users: totalUsersRow?.count ?? 0,
        };
        res.once("finish", () => {
          db.insert(adminExports)
            .values({ userId: exportingUserId, rowCounts: rowCountsSnapshot })
            .catch((logErr: unknown) => {
              console.error("[admin/stats/export] failed to log export:", logErr);
            });
        });
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="bsu-admin-stats-${exportDate}.csv"`);
      res.send(csvContent);
    } catch (err) {
      console.error("[admin/stats/export] failed:", err);
      res.status(500).json({ error: "Failed to export admin stats" });
    }
  });

  app.get("/api/admin/export-history", isAuthenticated, isAdmin, async (_req: Request, res: Response) => {
    try {
      const history = await db
        .select({
          id: adminExports.id,
          userId: adminExports.userId,
          exportedAt: adminExports.exportedAt,
          rowCounts: adminExports.rowCounts,
        })
        .from(adminExports)
        .orderBy(desc(adminExports.exportedAt))
        .limit(10);

      const userIds = [...new Set(history.map((r) => r.userId))];
      let userInfoMap: Record<string, { email: string | null; firstName: string | null; lastName: string | null }> = {};
      if (userIds.length > 0) {
        const userRows = await db
          .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds));
        userInfoMap = Object.fromEntries(
          userRows.map((u) => [u.id, { email: u.email ?? null, firstName: u.firstName ?? null, lastName: u.lastName ?? null }]),
        );
      }

      const result = history.map((r) => ({
        id: r.id,
        userId: r.userId,
        exportedAt: r.exportedAt,
        rowCounts: r.rowCounts,
        email: userInfoMap[r.userId]?.email ?? null,
        firstName: userInfoMap[r.userId]?.firstName ?? null,
        lastName: userInfoMap[r.userId]?.lastName ?? null,
      }));

      res.json(result);
    } catch (err) {
      console.error("[admin/export-history] failed:", err);
      res.status(500).json({ error: "Failed to load export history" });
    }
  });

  // ─── End admin routes ───────────────────────────────────────────────────────

  // ─── Accessibility Quick Tools ───────────────────────────────────────────────

  // -- Color Contrast (no AI, pure math) ------------------------------------
  app.post("/api/tools/color-contrast", (req: Request, res: Response) => {
    const { foreground, background } = req.body as { foreground?: string; background?: string };
    if (!foreground || !background) {
      return res.status(400).json({ error: "foreground and background colors are required" });
    }

    function parseHex(hex: string): [number, number, number] | null {
      const clean = hex.replace(/^#/, "");
      if (clean.length === 3) {
        const r = parseInt(clean[0] + clean[0], 16);
        const g = parseInt(clean[1] + clean[1], 16);
        const b = parseInt(clean[2] + clean[2], 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        return [r, g, b];
      }
      if (clean.length === 6) {
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        return [r, g, b];
      }
      return null;
    }

    function relativeLuminance([r, g, b]: [number, number, number]): number {
      const linearize = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
    }

    const fg = parseHex(foreground);
    const bg = parseHex(background);
    if (!fg) return res.status(400).json({ error: "Invalid foreground color. Use a 3 or 6-digit hex code (e.g. #fff or #ffffff)." });
    if (!bg) return res.status(400).json({ error: "Invalid background color. Use a 3 or 6-digit hex code (e.g. #000 or #000000)." });

    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    const ratio = parseFloat(((lighter + 0.05) / (darker + 0.05)).toFixed(2));

    res.json({
      ratio,
      aa_normal: ratio >= 4.5,
      aa_large: ratio >= 3,
      aaa_normal: ratio >= 7,
      aaa_large: ratio >= 4.5,
      foreground,
      background,
    });
  });

  // -- URL Scanner ----------------------------------------------------------
  // Blocks requests to private/loopback/link-local IP ranges (SSRF guard).
  function isPrivateIpTools(addr: string): boolean {
    const ip = addr.replace(/^::ffff:/i, "");
    if (ip === "::1") return true;
    if (/^fc/i.test(ip) || /^fd/i.test(ip)) return true;
    if (/^fe80/i.test(ip)) return true;
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return false;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  async function guardSsrfTools(
    hostname: string,
  ): Promise<{ error: string; address: null } | { error: null; address: string }> {
    if (hostname === "localhost") return { error: "Requests to localhost are not allowed", address: null };
    const { promises: dnsP } = await import("dns");
    let address: string;
    try {
      const result = await dnsP.lookup(hostname);
      address = result.address;
    } catch {
      return { error: "Could not resolve hostname", address: null };
    }
    if (isPrivateIpTools(address)) return { error: "Requests to private/internal addresses are not allowed", address: null };
    return { error: null, address };
  }

  /**
   * Fetch a URL by connecting directly to the pre-validated IP address, preventing
   * DNS rebinding / TOCTOU attacks.  The original hostname is preserved in the
   * Host header and TLS SNI field so TLS verification is unaffected.
   * Redirects are not followed — any redirect response is treated as an error.
   */
  // Maximum bytes to buffer from a remote HTML page before aborting.
  // This caps attacker-controlled memory consumption independently of the
  // 20,000-character truncation applied later for the AI prompt.
  const MAX_HTML_FETCH_BYTES = 1 * 1024 * 1024; // 1 MB

  async function fetchHtmlWithIpPinTools(
    url: string,
    resolvedIp: string,
  ): Promise<{ ok: true; html: string } | { ok: false; error: string; status: number }> {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (isHttps ? 443 : 80);
    const pathAndQuery = (parsedUrl.pathname || "/") + parsedUrl.search;

    return new Promise((resolve) => {
      let settled = false;
      // Holds the incoming response stream once headers arrive so the deadline
      // timer can also abort body streaming (not just the outgoing request).
      let incomingRes: import("http").IncomingMessage | null = null;

      function done(result: { ok: true; html: string } | { ok: false; error: string; status: number }) {
        if (!settled) { settled = true; resolve(result); }
      }

      // Single absolute deadline covering the full lifecycle: connection,
      // headers, AND body streaming.  Do NOT clear this timer when headers
      // arrive — a slow-drip attacker can hold headers open and trickle body
      // data indefinitely if the timer only covers the headers phase.
      const timer = setTimeout(() => {
        req.destroy();
        if (incomingRes) incomingRes.destroy();
        done({ ok: false, error: "The URL took too long to respond (15s timeout)", status: 400 });
      }, 15_000);

      const baseOptions = {
        host: resolvedIp,
        port,
        path: pathAndQuery,
        method: "GET" as const,
        headers: { "Host": parsedUrl.host, "User-Agent": "BSU-Accessibility-Scanner/1.0" },
      };

      const handleResponse = (res: import("http").IncomingMessage) => {
        // Capture the response stream so the deadline timer can abort body reads.
        // Do NOT clearTimeout(timer) here — the timer must remain active through
        // the entire body streaming phase.
        incomingRes = res;
        const sc = res.statusCode ?? 0;
        if (sc >= 300 && sc < 400) {
          clearTimeout(timer);
          res.resume();
          done({ ok: false, error: "Failed to fetch URL. Make sure it is publicly accessible.", status: 400 });
          return;
        }
        if (sc < 200 || sc >= 300) {
          clearTimeout(timer);
          res.resume();
          done({ ok: false, error: `Could not fetch URL: HTTP ${sc}`, status: 400 });
          return;
        }
        const ct = (res.headers["content-type"] as string | undefined) ?? "";
        if (!ct.includes("text/html")) {
          clearTimeout(timer);
          res.resume();
          done({ ok: false, error: "URL does not return an HTML page", status: 400 });
          return;
        }
        // Reject early based on Content-Length to avoid even starting a body
        // read from an origin that advertises an oversized response.
        const declaredLength = parseInt((res.headers["content-length"] as string | undefined) ?? "0", 10);
        if (!isNaN(declaredLength) && declaredLength > MAX_HTML_FETCH_BYTES) {
          clearTimeout(timer);
          res.destroy();
          done({ ok: false, error: "URL response is too large to analyze", status: 400 });
          return;
        }
        const chunks: Buffer[] = [];
        let bytesReceived = 0;
        res.on("data", (chunk: Buffer) => {
          bytesReceived += chunk.length;
          if (bytesReceived > MAX_HTML_FETCH_BYTES) {
            clearTimeout(timer);
            res.destroy();
            done({ ok: false, error: "URL response is too large to analyze", status: 400 });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => { clearTimeout(timer); done({ ok: true, html: Buffer.concat(chunks).toString("utf8") }); });
        res.on("error", () => { clearTimeout(timer); done({ ok: false, error: "Failed to fetch URL. Make sure it is publicly accessible.", status: 400 }); });
      };

      const req = isHttps
        ? https.request({ ...baseOptions, servername: parsedUrl.hostname, rejectUnauthorized: true }, handleResponse)
        : http.request(baseOptions, handleResponse);

      req.on("error", () => {
        clearTimeout(timer);
        done({ ok: false, error: "Failed to fetch URL. Make sure it is publicly accessible.", status: 400 });
      });
      req.end();
    });
  }

  app.post("/api/tools/url-scanner", async (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };
    if (!url) return res.status(400).json({ error: "url is required" });

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL. Please provide a full URL including https://" });
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: "Only http and https URLs are supported" });
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!await checkSharedRateLimit(`ip:${ip}`, "ai-gen", ANON_RATE_LIMIT, ANON_RATE_WINDOW_MS, () => checkAnonRateLimit(ip))) {
      return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
    }

    const ssrfResult = await guardSsrfTools(parsedUrl.hostname);
    if (ssrfResult.error !== null) {
      return res.status(400).json({ error: ssrfResult.error });
    }

    const fetchResult = await fetchHtmlWithIpPinTools(url, ssrfResult.address);
    if (!fetchResult.ok) {
      return res.status(fetchResult.status).json({ error: fetchResult.error });
    }

    const truncated = fetchResult.html.slice(0, 20_000);

    const systemPrompt = `You are a WCAG 2.1 AA accessibility expert. Analyze the provided HTML snippet and identify accessibility issues. For each issue, provide: a short title, severity (critical/major/minor), WCAG criterion (e.g. 1.1.1), a one-sentence description, and a concrete recommendation. Return valid JSON only — no markdown fences.

Return a JSON object with this exact shape:
{
  "score": <0-100 integer, 100 = perfect>,
  "summary": "<2-3 sentence overall summary>",
  "issues": [
    {
      "title": "<short title>",
      "severity": "critical"|"major"|"minor",
      "criterion": "<WCAG criterion>",
      "description": "<what the problem is>",
      "recommendation": "<how to fix it>"
    }
  ],
  "passed": ["<thing that looks correct>", ...]
}

Limit to the 10 most impactful issues. Be precise and technical.`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: `URL: ${url}\n\nHTML:\n${truncated}` }],
      });

      const text = (message.content[0] as any).text as string;
      let result: any;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      } catch {
        return res.status(500).json({ error: "AI returned an unexpected response. Please try again." });
      }
      res.json({ url, ...result });
    } catch (err) {
      console.error("URL Scanner AI error:", err);
      res.status(500).json({ error: "AI analysis failed. Please try again." });
    }
  });

  // -- Alt Text Generator ---------------------------------------------------
  const altTextUploadTools = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error("Only JPEG, PNG, GIF, and WebP images are supported"));
    },
  });

  app.post(
    "/api/tools/alt-text",
    // Rate-limit and concurrency guard run BEFORE multer buffers the upload so
    // excess or over-quota requests are rejected without reading any file data.
    async (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!await checkSharedRateLimit(`ip:${ip}`, "ai-gen", ANON_RATE_LIMIT, ANON_RATE_WINDOW_MS, () => checkAnonRateLimit(ip))) {
        return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
      }
      next();
    },
    uploadConcurrencyGuard,
    (req: Request, res: Response, next: NextFunction) => {
      altTextUploadTools.single("image")(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    },
    async (req: Request, res: Response) => {
      if (!req.file) return res.status(400).json({ error: "No image file provided" });
      const { context } = req.body as { context?: string };

      const base64 = req.file.buffer.toString("base64");
      const mediaType = req.file.mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      try {
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: base64 },
                },
                {
                  type: "text",
                  text: `Generate concise, descriptive alternative text for this image following WCAG 2.1 guidelines.
${context ? `Context about the image: ${context}` : ""}

Rules:
- Start directly with the description (no "Image of" or "Picture of")
- Be specific and meaningful — describe what matters for understanding
- For charts/graphs: describe the data and trends, not just the visual style
- For decorative images: respond with exactly: [decorative]
- Aim for 50-125 characters for simple images, up to 250 for complex ones
- Do not include the word "alt" in your response

Respond with ONLY the alt text — no explanation, no quotes.`,
                },
              ],
            },
          ],
        });

        const altText = ((message.content[0] as any).text as string).trim();
        const isDecorative = altText === "[decorative]";

        res.json({
          altText: isDecorative ? "" : altText,
          isDecorative,
          characterCount: altText.length,
        });
      } catch (err) {
        console.error("Alt text generation error:", err);
        res.status(500).json({ error: "AI analysis failed. Please try again." });
      }
    },
  );

  // -- Math OCR -------------------------------------------------------------
  const mathOcrUploadTools = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error("Only JPEG, PNG, GIF, and WebP images are supported"));
    },
  });

  app.post(
    "/api/tools/math-ocr",
    // Rate-limit and concurrency guard run BEFORE multer buffers the upload so
    // excess or over-quota requests are rejected without reading any file data.
    async (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!await checkSharedRateLimit(`ip:${ip}`, "ai-gen", ANON_RATE_LIMIT, ANON_RATE_WINDOW_MS, () => checkAnonRateLimit(ip))) {
        return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
      }
      next();
    },
    uploadConcurrencyGuard,
    (req: Request, res: Response, next: NextFunction) => {
      mathOcrUploadTools.single("image")(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    },
    async (req: Request, res: Response) => {
      if (!req.file) return res.status(400).json({ error: "No image file provided" });

      const base64 = req.file.buffer.toString("base64");
      const mediaType = req.file.mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      try {
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: base64 },
                },
                {
                  type: "text",
                  text: `Extract and convert the mathematical content from this image into accessible formats. Return valid JSON only — no markdown fences.

Return this exact JSON shape:
{
  "plainText": "<spoken/readable version, e.g. 'x equals negative b plus or minus the square root of b squared minus 4ac, all divided by 2a'>",
  "latex": "<LaTeX representation, e.g. x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}>",
  "mathml": "<MathML representation>",
  "description": "<one sentence describing what this expression or equation represents>"
}

If the image does not contain clear mathematical content, return:
{"error": "No mathematical content detected in this image"}`,
                },
              ],
            },
          ],
        });

        const text = ((message.content[0] as any).text as string).trim();
        let result: any;
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        } catch {
          return res.status(500).json({ error: "AI returned an unexpected response. Please try again." });
        }

        if (result.error) return res.status(422).json({ error: result.error });
        res.json(result);
      } catch (err) {
        console.error("Math OCR error:", err);
        res.status(500).json({ error: "AI analysis failed. Please try again." });
      }
    },
  );

  // ─── End accessibility quick tools ───────────────────────────────────────────

  // ─── Privacy-conscious usage analytics ───────────────────────────────────────
  // Stores only: date, random session ID, page name, action type.
  // No IP, user ID, email, prompts, or document contents are recorded.

  const ANALYTICS_VALID_PAGES = new Set([
    "landing", "pdf-upload", "pdf-conversion", "pdf-history", "pdf-faq",
    "url-scanner", "color-contrast", "alt-text", "math-ocr",
    "settings", "help", "admin",
  ]);

  const ANALYTICS_VALID_ACTIONS = new Set([
    "page_view", "conversion_started", "conversion_complete",
    "tool_result", "download_html", "download_docx", "download_pdf",
    "download_xlsx", "reprocess", "google_doc_import",
    "google_sheet_import", "google_slide_import",
  ]);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.post("/api/analytics/event", async (req: Request, res: Response) => {
    try {
      const { sessionId, page, action } = req.body ?? {};
      if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
        return res.status(400).json({ error: "Invalid sessionId" });
      }
      if (typeof page !== "string" || !ANALYTICS_VALID_PAGES.has(page)) {
        return res.status(400).json({ error: "Invalid page" });
      }
      if (typeof action !== "string" || !ANALYTICS_VALID_ACTIONS.has(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(analyticsEvents).values({ sessionId, date: today, page, action });
      return res.json({ ok: true });
    } catch (err) {
      console.error("Analytics event error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/admin/analytics", isAuthenticated, isAdmin, async (_req: Request, res: Response) => {
    try {
      const [totalsRow] = await db
        .select({
          totalEvents: sql<number>`count(*)::int`,
          uniqueSessions: sql<number>`count(distinct session_id)::int`,
        })
        .from(analyticsEvents);

      const byAction = await db
        .select({
          action: analyticsEvents.action,
          count: sql<number>`count(*)::int`,
        })
        .from(analyticsEvents)
        .groupBy(analyticsEvents.action)
        .orderBy(sql`count(*) desc`);

      const byPage = await db
        .select({
          page: analyticsEvents.page,
          count: sql<number>`count(*)::int`,
        })
        .from(analyticsEvents)
        .groupBy(analyticsEvents.page)
        .orderBy(sql`count(*) desc`);

      const byWeek = await db
        .select({
          week: sql<string>`to_char(date_trunc('week', date::timestamp), 'YYYY-MM-DD')`,
          events: sql<number>`count(*)::int`,
          sessions: sql<number>`count(distinct session_id)::int`,
        })
        .from(analyticsEvents)
        .where(sql`date >= current_date - interval '84 days'`)
        .groupBy(sql`date_trunc('week', date::timestamp)`)
        .orderBy(sql`date_trunc('week', date::timestamp)`);

      const byMonth = await db
        .select({
          month: sql<string>`to_char(date_trunc('month', date::timestamp), 'YYYY-MM')`,
          events: sql<number>`count(*)::int`,
          sessions: sql<number>`count(distinct session_id)::int`,
        })
        .from(analyticsEvents)
        .where(sql`date >= current_date - interval '6 months'`)
        .groupBy(sql`date_trunc('month', date::timestamp)`)
        .orderBy(sql`date_trunc('month', date::timestamp)`);

      return res.json({
        totalEvents: totalsRow?.totalEvents ?? 0,
        uniqueSessions: totalsRow?.uniqueSessions ?? 0,
        byAction,
        byPage,
        byWeek,
        byMonth,
      });
    } catch (err) {
      console.error("Admin analytics error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  // ─── End privacy-conscious usage analytics ────────────────────────────────────

  return httpServer;
}
