/**
 * Tests for the extraction error-message infrastructure.
 *
 * Part 1 — Unit tests for server/lib/extraction-error-messages.ts:
 *   - EXTRACTION_ERROR_MESSAGES has an entry for every supported format key.
 *   - Looking up an unknown key returns EXTRACTION_ERROR_FALLBACK.
 *
 * Part 2 — Integration tests for the extraction error-mapping block in server/routes.ts:
 *   When an extractor throws for a given sourceType the route's catch block must:
 *     1. Map the raw error to a user-friendly message for that format.
 *     2. Store that message as `errorMessage` on the conversion record (status: "failed").
 *
 *   Each test mocks the relevant extractor to throw, fires POST /api/conversions/:id/process,
 *   and then waits for the background IIFE to write the failure row to the (mocked) DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EXTRACTION_ERROR_MESSAGES,
  EXTRACTION_ERROR_FALLBACK,
  SUPPORTED_FORMAT_KEYS,
} from "./lib/extraction-error-messages.js";

// ---------------------------------------------------------------------------
// Part 1: Unit tests for the EXTRACTION_ERROR_MESSAGES constant
// ---------------------------------------------------------------------------

const FORMAT_KEYWORDS: Record<string, RegExp> = {
  pdf:            /pdf/i,
  docx:           /word|docx/i,
  xlsx:           /excel|spreadsheet/i,
  pptx:           /powerpoint|presentation/i,
  csv:            /csv/i,
  rtf:            /rtf/i,
  html:           /html/i,
  odt:            /opendocument/i,
  ods:            /opendocument|spreadsheet/i,
  odp:            /opendocument|presentation/i,
  epub:           /epub/i,
  doc:            /\.doc/i,
  "google-doc":   /google/i,
  "google-sheet": /google/i,
  "google-slide": /google/i,
};

describe("EXTRACTION_ERROR_MESSAGES constant", () => {
  it("contains a non-empty string entry for every supported format key", () => {
    for (const key of SUPPORTED_FORMAT_KEYS) {
      expect(
        EXTRACTION_ERROR_MESSAGES[key],
        `Expected a message for format key "${key}"`,
      ).toBeDefined();
      expect(
        typeof EXTRACTION_ERROR_MESSAGES[key],
        `Message for "${key}" must be a string`,
      ).toBe("string");
      expect(
        EXTRACTION_ERROR_MESSAGES[key].length,
        `Message for "${key}" must not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(SUPPORTED_FORMAT_KEYS)(
    'has a message for "%s"',
    (key) => {
      expect(EXTRACTION_ERROR_MESSAGES[key]).toBeDefined();
    },
  );

  it("returns undefined for an unknown format key (caller should use EXTRACTION_ERROR_FALLBACK)", () => {
    expect(EXTRACTION_ERROR_MESSAGES["unknown-format"]).toBeUndefined();
    expect(EXTRACTION_ERROR_MESSAGES["xyz"]).toBeUndefined();
    expect(EXTRACTION_ERROR_MESSAGES[""]).toBeUndefined();
  });

  it("EXTRACTION_ERROR_FALLBACK is a non-empty string", () => {
    expect(typeof EXTRACTION_ERROR_FALLBACK).toBe("string");
    expect(EXTRACTION_ERROR_FALLBACK.length).toBeGreaterThan(0);
  });

  it("EXTRACTION_ERROR_FALLBACK is distinct from every per-format message", () => {
    for (const key of SUPPORTED_FORMAT_KEYS) {
      expect(
        EXTRACTION_ERROR_MESSAGES[key],
        `Per-format message for "${key}" should not equal the generic fallback`,
      ).not.toBe(EXTRACTION_ERROR_FALLBACK);
    }
  });

  it("FORMAT_KEYWORDS and SUPPORTED_FORMAT_KEYS contain identical keys so adding a new format to one without the other is caught", () => {
    const formatKeywordKeys = new Set(Object.keys(FORMAT_KEYWORDS));
    const supportedKeys = new Set(SUPPORTED_FORMAT_KEYS as readonly string[]);

    const inKeywordsNotSupported = [...formatKeywordKeys].filter(
      (k) => !supportedKeys.has(k),
    );
    const inSupportedNotKeywords = [...supportedKeys].filter(
      (k) => !formatKeywordKeys.has(k),
    );

    expect(
      inKeywordsNotSupported,
      `Keys in FORMAT_KEYWORDS but missing from SUPPORTED_FORMAT_KEYS: ${inKeywordsNotSupported.join(", ")}`,
    ).toEqual([]);

    expect(
      inSupportedNotKeywords,
      `Keys in SUPPORTED_FORMAT_KEYS but missing from FORMAT_KEYWORDS: ${inSupportedNotKeywords.join(", ")}`,
    ).toEqual([]);
  });

  it("EXTRACTION_ERROR_MESSAGES and SUPPORTED_FORMAT_KEYS contain identical keys so adding a new format without an error message is caught", () => {
    const messageKeys = new Set(Object.keys(EXTRACTION_ERROR_MESSAGES));
    const supportedKeys = new Set(SUPPORTED_FORMAT_KEYS as readonly string[]);

    const inMessagesNotSupported = [...messageKeys].filter(
      (k) => !supportedKeys.has(k),
    );
    const inSupportedNotMessages = [...supportedKeys].filter(
      (k) => !messageKeys.has(k),
    );

    expect(
      inMessagesNotSupported,
      `Keys in EXTRACTION_ERROR_MESSAGES but missing from SUPPORTED_FORMAT_KEYS: ${inMessagesNotSupported.join(", ")}`,
    ).toEqual([]);

    expect(
      inSupportedNotMessages,
      `Keys in SUPPORTED_FORMAT_KEYS but missing from EXTRACTION_ERROR_MESSAGES: ${inSupportedNotMessages.join(", ")}`,
    ).toEqual([]);
  });

  it("applying EXTRACTION_ERROR_FALLBACK when a key is missing produces a string", () => {
    const result =
      EXTRACTION_ERROR_MESSAGES["not-a-real-format"] ?? EXTRACTION_ERROR_FALLBACK;
    expect(result).toBe(EXTRACTION_ERROR_FALLBACK);
  });

  it("each per-format message contains a human-readable reference to its format", () => {
    for (const key of SUPPORTED_FORMAT_KEYS) {
      const msg = EXTRACTION_ERROR_MESSAGES[key];
      const pattern = FORMAT_KEYWORDS[key];
      expect(
        pattern.test(msg),
        `Message for "${key}" must contain a human-readable reference to its format. Got: "${msg}"`,
      ).toBe(true);
    }
  });

  it("EXTRACTION_ERROR_FALLBACK is a human-readable sentence", () => {
    expect(
      EXTRACTION_ERROR_FALLBACK,
      "Fallback must start with a capital letter",
    ).toMatch(/^[A-Z]/);
    expect(
      EXTRACTION_ERROR_FALLBACK,
      "Fallback must end with a period",
    ).toMatch(/\.$/);
    expect(
      EXTRACTION_ERROR_FALLBACK,
      "Fallback must contain at least one space (must be a sentence, not a jargon word)",
    ).toMatch(/\s/);
    expect(
      EXTRACTION_ERROR_FALLBACK,
      "Fallback must not contain raw technical output (stack traces, error codes, identifiers)",
    ).not.toMatch(/Error:|at\s+\w+\s*\(|ENOENT|EACCES|undefined|null\b|stack/i);
  });

  it("EXTRACTION_ERROR_FALLBACK does not mention any specific format name", () => {
    for (const [key, pattern] of Object.entries(FORMAT_KEYWORDS)) {
      expect(
        pattern.test(EXTRACTION_ERROR_FALLBACK),
        `EXTRACTION_ERROR_FALLBACK must not match the format-specific pattern for "${key}" (/${pattern.source}/${pattern.flags}). Got: "${EXTRACTION_ERROR_FALLBACK}"`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Part 2: Integration tests (route-level)
// ---------------------------------------------------------------------------
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock handles — created before any vi.mock() factory runs.
// ---------------------------------------------------------------------------
const {
  mockDbSelectWhere,
  mockDbUpdateSet,
  mockDbUpdateReturning,
  mockExtractDocContent,
  mockExtractCsvContent,
  mockExtractEpubContent,
  mockExtractOdfContent,
  mockExtractHtmlContent,
  mockExtractRtfContent,
  mockExtractDocxContent,
  mockExtractXlsxContent,
  mockExtractPptxContent,
  mockCheckSharedRateLimit,
  mockCheckHeavyOpRateLimit,
} = vi.hoisted(() => ({
  mockDbSelectWhere: vi.fn(),
  mockDbUpdateSet: vi.fn(),
  mockDbUpdateReturning: vi.fn().mockResolvedValue([{ id: 1 }]),
  mockExtractDocContent: vi.fn(),
  mockExtractCsvContent: vi.fn(),
  mockExtractEpubContent: vi.fn(),
  mockExtractOdfContent: vi.fn(),
  mockExtractHtmlContent: vi.fn(),
  mockExtractRtfContent: vi.fn(),
  mockExtractDocxContent: vi.fn(),
  mockExtractXlsxContent: vi.fn(),
  mockExtractPptxContent: vi.fn(),
  mockCheckSharedRateLimit: vi.fn().mockResolvedValue(true),
  mockCheckHeavyOpRateLimit: vi.fn().mockReturnValue(true),
}));

// ---------------------------------------------------------------------------
// Mock: db — chainable query-builder facade.
//
// db.update(table).set(data).where(cond)                 — awaitable, no returning
// db.update(table).set(data).where(cond).returning(...)  — returns [{ id }]
// db.select(...).from(...).where(...)                     — returns configured rows
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: (_fields?: any) => ({
      from: (_table: any) => ({
        where: mockDbSelectWhere,
      }),
    }),
    update: (_table: any) => ({
      set: (data: any) => {
        mockDbUpdateSet(data);
        return {
          where: (_cond: any) => {
            const p: any = Promise.resolve(undefined);
            p.returning = mockDbUpdateReturning;
            return p;
          },
        };
      },
    }),
    delete: (_table: any) => ({
      where: () => Promise.resolve(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: format-specific extractors (dynamically imported by the route)
// ---------------------------------------------------------------------------
vi.mock("./lib/doc-extractor", () => ({ extractDocContent: mockExtractDocContent }));
vi.mock("./lib/csv-extractor", () => ({ extractCsvContent: mockExtractCsvContent }));
vi.mock("./lib/epub-extractor", () => ({ extractEpubContent: mockExtractEpubContent }));
vi.mock("./lib/odf-extractor", () => ({ extractOdfContent: mockExtractOdfContent }));
vi.mock("./lib/html-extractor", () => ({ extractHtmlContent: mockExtractHtmlContent }));
vi.mock("./lib/rtf-extractor", () => ({ extractRtfContent: mockExtractRtfContent }));
vi.mock("./lib/docx-extractor", () => ({ extractDocxContent: mockExtractDocxContent }));
vi.mock("./lib/xlsx-extractor", () => ({ extractXlsxContent: mockExtractXlsxContent }));
vi.mock("./lib/pptx-extractor", () => ({ extractPptxContent: mockExtractPptxContent }));
vi.mock("./lib/pdf-processor", () => ({
  extractPdfContent: vi.fn(),
  needsOcr: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth — optionalAuth always attaches an authenticated user so
// getUserId() returns "test-user-1" and the authenticated rate-limit path runs.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-1" } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-1" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-1" } };
    next();
  },
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getAllCourses: vi.fn(),
    getCourse: vi.fn(),
    getContent: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    getVersionsByContent: vi.fn(),
    getVersionById: vi.fn(),
    getAllSavedContent: vi.fn(),
    getSavedContent: vi.fn(),
    createSavedContent: vi.fn(),
    deleteSavedContent: vi.fn(),
    getSavedOutcomes: vi.fn(),
    createSavedOutcome: vi.fn(),
    updateSavedOutcome: vi.fn(),
    deleteSavedOutcome: vi.fn(),
    createContent: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    toggleContentApproval: vi.fn(),
    updateContent: vi.fn(),
    createVersion: vi.fn(),
    pruneOldVersions: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    getUserPreferences: vi.fn(),
    setUserPreferences: vi.fn(),
    getConversionsByUser: vi.fn(),
    getConversionById: vi.fn(),
    createConversion: vi.fn(),
    updateConversion: vi.fn(),
    deleteConversion: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", async () => {
  const { createAccessibilityEngineMock } = await import("./test-utils/accessibility-engine-mock");
  return createAccessibilityEngineMock();
});

// ---------------------------------------------------------------------------
// Mock: markdownTableConverter
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: table-fixers
// ---------------------------------------------------------------------------
vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: rateLimiters — all checks pass so only the extraction error is exercised.
// ---------------------------------------------------------------------------
vi.mock("./lib/rateLimiters.js", () => {
  mockCheckSharedRateLimit.mockResolvedValue(true);
  mockCheckHeavyOpRateLimit.mockReturnValue(true);
  return {
    checkSharedRateLimit: mockCheckSharedRateLimit,
    checkAnonRateLimit: vi.fn().mockReturnValue(true),
    checkHeavyOpRateLimit: mockCheckHeavyOpRateLimit,
    checkAiGenRateLimit: vi.fn().mockReturnValue(true),
    checkUploadRateLimit: vi.fn().mockReturnValue(true),
    SHARED_ANON_UPLOAD_RATE_LIMIT: 10,
    SHARED_HEAVY_OP_RATE_LIMIT: 5,
    AI_GEN_RATE_LIMIT: 20,
    AI_GEN_RATE_WINDOW_MS: 60 * 60 * 1000,
    UPLOAD_RATE_LIMIT: 30,
    UPLOAD_RATE_WINDOW_MS: 60 * 60 * 1000,
    ANON_RATE_LIMIT: 10,
    ANON_RATE_WINDOW_MS: 60 * 60 * 1000,
    HEAVY_OP_RATE_WINDOW_MS: 60 * 60 * 1000,
    sharedRateLimitCleanupInterval: undefined,
    anonRateLimitCleanupInterval: undefined,
    heavyOpRateLimitCleanupInterval: undefined,
    aiGenRateLimitCleanupInterval: undefined,
    uploadRateLimitCleanupInterval: undefined,
    anonRateLimits: new Map(),
    heavyOpRateLimits: new Map(),
    aiGenRateLimits: new Map(),
    uploadRateLimits: new Map(),
  };
});

// ---------------------------------------------------------------------------
// Module under test — imported after all mocks are registered.
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake pdfData: base64-encoded bytes used by the route to construct the file buffer. */
const FAKE_PDF_DATA = Buffer.from("fake-file-bytes").toString("base64");

/** Build a minimal conversion row that passes all of the route's pre-flight checks. */
function makeConversion(sourceType: string) {
  return {
    id: 1,
    userId: "test-user-1",
    visitorToken: null,
    originalFilename: `test.${sourceType}`,
    sourceType,
    status: "uploaded",
    pdfData: FAKE_PDF_DATA,
    accessibleHtml: null,
    extractedText: null,
    complianceReport: null,
    originalComplianceReport: null,
    statusMessage: null,
    errorMessage: null,
    pageCount: null,
    ocrApplied: false,
    selectedSheet: null,
    processingStartedAt: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

async function buildApp() {
  vi.resetModules();
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

/**
 * Wait (via polling) until mockDbUpdateSet has been called with { status: "failed" }.
 * Returns the full payload of that call.
 */
async function waitForFailureWrite(timeoutMs = 5000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failCall = mockDbUpdateSet.mock.calls.find(
      ([data]: [any]) => data?.status === "failed",
    );
    if (failCall) return failCall[0];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `Timed out waiting for db.update with status:"failed". ` +
      `Actual set() calls: ${JSON.stringify(mockDbUpdateSet.mock.calls.map(([d]: [any]) => d))}`,
  );
}

// ---------------------------------------------------------------------------
// Test cases — one per format covered by the error-mapping block.
// ---------------------------------------------------------------------------

const FORMAT_CASES: Array<{
  srcType: string;
  setupExtractorThrow: () => void;
  expectedMessage: string;
  rawError: string;
}> = [
  {
    srcType: "doc",
    setupExtractorThrow: () =>
      mockExtractDocContent.mockRejectedValueOnce(new Error("antiword failed")),
    expectedMessage:
      "This file could not be read. It may be corrupted or in an unsupported variant of the .doc format.",
    rawError: "antiword failed",
  },
  {
    srcType: "csv",
    setupExtractorThrow: () =>
      mockExtractCsvContent.mockRejectedValueOnce(new Error("parse error at row 3")),
    expectedMessage:
      "This CSV file could not be parsed. Check that it is a valid, well-formed CSV file.",
    rawError: "parse error at row 3",
  },
  {
    srcType: "epub",
    setupExtractorThrow: () =>
      mockExtractEpubContent.mockRejectedValueOnce(new Error("invalid epub structure")),
    expectedMessage:
      "This EPUB file could not be opened. It may be corrupted or not a valid EPUB.",
    rawError: "invalid epub structure",
  },
  {
    srcType: "odt",
    setupExtractorThrow: () =>
      mockExtractOdfContent.mockRejectedValueOnce(new Error("zip error")),
    expectedMessage:
      "This OpenDocument Text file could not be read. It may be corrupted or in an unsupported format.",
    rawError: "zip error",
  },
  {
    srcType: "ods",
    setupExtractorThrow: () =>
      mockExtractOdfContent.mockRejectedValueOnce(new Error("zip error")),
    expectedMessage:
      "This OpenDocument Spreadsheet could not be read. It may be corrupted or in an unsupported format.",
    rawError: "zip error",
  },
  {
    srcType: "odp",
    setupExtractorThrow: () =>
      mockExtractOdfContent.mockRejectedValueOnce(new Error("zip error")),
    expectedMessage:
      "This OpenDocument Presentation could not be read. It may be corrupted or in an unsupported format.",
    rawError: "zip error",
  },
  {
    srcType: "html",
    setupExtractorThrow: () =>
      mockExtractHtmlContent.mockRejectedValueOnce(new Error("parse error")),
    expectedMessage:
      "This HTML file could not be parsed. Check that it is a valid HTML document.",
    rawError: "parse error",
  },
  {
    srcType: "rtf",
    setupExtractorThrow: () =>
      mockExtractRtfContent.mockRejectedValueOnce(new Error("unexpected token")),
    expectedMessage:
      "This RTF file could not be read. It may be corrupted or in an unsupported format.",
    rawError: "unexpected token",
  },
  // --- New cases: xlsx, docx, pptx, google-sheet, google-slide ---
  {
    srcType: "xlsx",
    setupExtractorThrow: () =>
      mockExtractXlsxContent.mockRejectedValueOnce(new Error("corrupted workbook")),
    expectedMessage:
      "This Excel spreadsheet could not be read. It may be corrupted, password-protected, or in an unsupported format.",
    rawError: "corrupted workbook",
  },
  {
    srcType: "docx",
    setupExtractorThrow: () =>
      mockExtractDocxContent.mockRejectedValueOnce(new Error("mammoth failed")),
    expectedMessage:
      "This Word document could not be read. It may be corrupted, password-protected, or in an unsupported format.",
    rawError: "mammoth failed",
  },
  {
    srcType: "pptx",
    setupExtractorThrow: () =>
      mockExtractPptxContent.mockRejectedValueOnce(new Error("slide parse error")),
    expectedMessage:
      "This PowerPoint file could not be read. It may be corrupted, password-protected, or in an unsupported format.",
    rawError: "slide parse error",
  },
  {
    srcType: "google-doc",
    setupExtractorThrow: () =>
      mockExtractDocxContent.mockRejectedValueOnce(new Error("mammoth extraction failed")),
    expectedMessage:
      "This Google Doc could not be extracted. It may be in an unsupported format or corrupted.",
    rawError: "mammoth extraction failed",
  },
  {
    srcType: "google-sheet",
    setupExtractorThrow: () =>
      mockExtractXlsxContent.mockRejectedValueOnce(new Error("network timeout")),
    expectedMessage:
      "This Google Sheet could not be read. It may be in an unsupported format or corrupted.",
    rawError: "network timeout",
  },
  {
    srcType: "google-slide",
    setupExtractorThrow: () =>
      mockExtractPptxContent.mockRejectedValueOnce(new Error("presentation corrupt")),
    expectedMessage:
      "This Google Slides file could not be read. It may be in an unsupported format or corrupted.",
    rawError: "presentation corrupt",
  },
];

describe("POST /api/conversions/:id/process — extraction error mapping", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);
    mockCheckSharedRateLimit.mockResolvedValue(true);
    app = await buildApp();
  });

  for (const { srcType, setupExtractorThrow, expectedMessage, rawError } of FORMAT_CASES) {
    it(`stores the correct user-friendly errorMessage for a broken ${srcType} file`, async () => {
      const conversion = makeConversion(srcType);

      // db.select(...).from(...).where(...):
      //   call 1 — ownership / existence check  → the conversion row
      //   call 2 — global concurrency count     → 0 active jobs
      mockDbSelectWhere
        .mockResolvedValueOnce([conversion])
        .mockResolvedValueOnce([{ count: 0 }]);

      // Make the extractor for this format throw a raw technical error.
      setupExtractorThrow();

      // Fire the process request — the route returns immediately with 200.
      const res = await request(app).post("/api/conversions/1/process");
      expect(res.status).toBe(200);

      // Wait for the background IIFE to write the failure row.
      const failedPayload = await waitForFailureWrite();

      // The stored errorMessage must be the friendly string, not the raw error.
      expect(failedPayload.status).toBe("failed");
      expect(failedPayload.errorMessage).toBe(expectedMessage);
      expect(failedPayload.errorMessage).not.toMatch(new RegExp(rawError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    });
  }

  it("stores a generic fallback message for an unrecognised sourceType", async () => {
    const conversion = makeConversion("unknown-format");
    // Unrecognised srcType falls through to the pdf-processor branch in the
    // extraction try/catch, but the error-mapping lookup key is still
    // "unknown-format" (not "pdf"), so friendlyMessages[srcType] is undefined
    // and the generic fallback string is used.
    const { extractPdfContent } = await import("./lib/pdf-processor");
    vi.mocked(extractPdfContent).mockRejectedValueOnce(new Error("unexpected binary"));

    mockDbSelectWhere
      .mockResolvedValueOnce([conversion])
      .mockResolvedValueOnce([{ count: 0 }]);

    const res = await request(app).post("/api/conversions/1/process");
    expect(res.status).toBe(200);

    const failedPayload = await waitForFailureWrite();

    expect(failedPayload.status).toBe("failed");
    // Generic fallback — not the raw technical error message.
    expect(failedPayload.errorMessage).toBe(
      "This file could not be read. It may be corrupted or in an unsupported format.",
    );
    expect(failedPayload.errorMessage).not.toMatch(/unexpected binary/i);
  });
});
