/**
 * End-to-end coverage for the chunk-cap truncation warning
 * (`truncationWarning` from `generateAccessibleDocument`) being merged into
 * `extractionWarnings` on the saved conversion record, on both the
 * initial-conversion route (`POST /api/conversions/:id/process`) and the
 * reprocess route (`POST /api/conversions/:id/reprocess`).
 *
 * Both tests assert that:
 *   1. `result.truncationWarning` ends up inside the saved `extractionWarnings`.
 *   2. Any pre-existing extraction warnings are preserved alongside it
 *      (i.e. the write does not clobber existing warnings).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  mockExtractPdfContent,
  mockNeedsOcr,
  mockGenerateAccessibleDocument,
} = vi.hoisted(() => ({
  mockDbSelectWhere: vi.fn(),
  mockDbUpdateSet: vi.fn(),
  mockDbUpdateReturning: vi.fn().mockResolvedValue([{ id: 1 }]),
  mockExtractPdfContent: vi.fn(),
  mockNeedsOcr: vi.fn().mockReturnValue(false),
  mockGenerateAccessibleDocument: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: db — chainable query-builder facade, mirroring
// server/routes.extraction-error.test.ts.
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

vi.mock("./lib/pdf-processor", () => ({
  extractPdfContent: mockExtractPdfContent,
  needsOcr: mockNeedsOcr,
}));

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

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

vi.mock("./storage", () => ({
  storage: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return vi.fn().mockResolvedValue(null);
      },
    },
  ),
}));

vi.mock("./lib/accessibility-engine", async () => {
  const { createAccessibilityEngineMock } = await import(
    "./test-utils/accessibility-engine-mock.js"
  );
  return createAccessibilityEngineMock({
    generateAccessibleDocument: mockGenerateAccessibleDocument,
    evaluateOriginalDocument: vi.fn().mockReturnValue(null),
    predictTruncationWarning: vi.fn().mockReturnValue(undefined),
  });
});

vi.mock("./lib/accessibility-engine.js", async () => {
  const { createAccessibilityEngineMock } = await import(
    "./test-utils/accessibility-engine-mock.js"
  );
  return createAccessibilityEngineMock({
    generateAccessibleDocument: mockGenerateAccessibleDocument,
    evaluateOriginalDocument: vi.fn().mockReturnValue(null),
    predictTruncationWarning: vi.fn().mockReturnValue(undefined),
  });
});

vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: vi.fn().mockResolvedValue(Buffer.from("")),
}));

vi.mock("./lib/parseVersionHistoryLimit.js", () => ({
  parseVersionHistoryLimit: vi.fn().mockReturnValue(5),
}));

vi.mock("./lib/rateLimiters.js", () => ({
  checkSharedRateLimit: vi.fn().mockResolvedValue(true),
  checkAnonRateLimit: vi.fn().mockReturnValue(true),
  checkHeavyOpRateLimit: vi.fn().mockReturnValue(true),
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
  getRateLimitCleanupMetrics: vi.fn().mockReturnValue({ count: 0, lastAt: null }),
}));

// ---------------------------------------------------------------------------
// Module under test — imported after all mocks are registered.
// ---------------------------------------------------------------------------
import { registerRoutes, _testDeleteReprocessKey } from "./routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_PDF_DATA = Buffer.from("fake-file-bytes").toString("base64");
const TRUNCATION_WARNING =
  "This document was very large (65 sections). Only the first 60 sections were converted; approximately 52,795 characters at the end of the document were not processed.";

function makeConversion(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: "test-user-1",
    visitorToken: null,
    originalFilename: "huge-syllabus.pdf",
    sourceType: "pdf",
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
    extractionWarnings: null,
    processingStartedAt: null,
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
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

/** Poll mockDbUpdateSet until a call matching `predicate` shows up. */
async function waitForUpdate(
  predicate: (data: any) => boolean,
  timeoutMs = 5000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = mockDbUpdateSet.mock.calls.find(([data]: [any]) => predicate(data));
    if (found) return found[0];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `Timed out waiting for matching db.update(...).set(...) call. Actual calls: ${JSON.stringify(
      mockDbUpdateSet.mock.calls.map(([d]: [any]) => d),
    )}`,
  );
}

describe("truncationWarning propagation into extractionWarnings", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);
    mockNeedsOcr.mockReturnValue(false);
    app = await buildApp();
  });

  it("POST /api/conversions/:id/process appends truncationWarning to extractionWarnings without dropping existing extraction warnings", async () => {
    const conversion = makeConversion();

    // db.select(...).from(...).where(...):
    //   call 1 — ownership / existence check          → the conversion row
    //   call 2 — global concurrency count             → 0 active jobs
    //   calls 3-5 — checkCancelledByDb at each checkpoint → still "processing"
    mockDbSelectWhere
      .mockResolvedValueOnce([conversion])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ status: "processing" }])
      .mockResolvedValueOnce([{ status: "processing" }])
      .mockResolvedValueOnce([{ status: "processing" }]);

    mockExtractPdfContent.mockResolvedValueOnce({
      text: "Some extracted document text.",
      images: [],
      tables: [],
      metadata: {},
      pageCount: 65,
      warnings: ["Some pages required OCR and may be less accurate."],
    });

    mockGenerateAccessibleDocument.mockResolvedValueOnce({
      accessibleHtml: "<html lang=\"en\"><body><h1>Doc</h1></body></html>",
      complianceReport: null,
      originalComplianceReport: null,
      truncationWarning: TRUNCATION_WARNING,
    });

    const res = await request(app).post("/api/conversions/1/process");
    expect(res.status).toBe(200);

    const completedPayload = await waitForUpdate((d) => d?.status === "completed");

    expect(completedPayload.extractionWarnings).toContain(TRUNCATION_WARNING);
    expect(completedPayload.extractionWarnings).toContain(
      "Some pages required OCR and may be less accurate.",
    );
    expect(completedPayload.extractionWarnings).toHaveLength(2);
  });

  it("POST /api/conversions/:id/reprocess appends truncationWarning to extractionWarnings without dropping existing extraction warnings", async () => {
    const conversion = makeConversion({
      status: "completed",
      extractedText: "Some extracted document text.",
      extractionWarnings: ["Some pages required OCR and may be less accurate."],
    });

    // db.select calls: ownership check, then checkCancelledByDb (pre-AI + post-AI)
    mockDbSelectWhere
      .mockResolvedValueOnce([conversion])
      .mockResolvedValueOnce([{ status: "processing" }])
      .mockResolvedValueOnce([{ status: "processing" }]);
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);

    mockGenerateAccessibleDocument.mockResolvedValueOnce({
      accessibleHtml: "<html lang=\"en\"><body><h1>Doc</h1></body></html>",
      complianceReport: null,
      truncationWarning: TRUNCATION_WARNING,
    });

    const res = await request(app).post("/api/conversions/1/reprocess").send({});
    expect(res.status).toBe(200);

    const completedPayload = await waitForUpdate((d) => d?.status === "completed");

    expect(completedPayload.extractionWarnings).toContain(TRUNCATION_WARNING);
    expect(completedPayload.extractionWarnings).toContain(
      "Some pages required OCR and may be less accurate.",
    );
    expect(completedPayload.extractionWarnings).toHaveLength(2);

    _testDeleteReprocessKey(1);
  });
});
