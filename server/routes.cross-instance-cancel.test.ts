/**
 * Integration proof for cross-instance cancel behaviour.
 *
 * The cancel endpoint atomically flips the DB row to "failed" and then calls
 * AbortController.abort() on the in-process Map — but that Map is
 * process-local.  On a multi-instance autoscaled deployment the cancel request
 * may reach a different instance than the one running the background job.  In
 * that case the DB status flip happens but the in-process signal never fires.
 *
 * The fix: `checkCancelledByDb()` is called at each expensive checkpoint
 * inside the background job.  If the DB row is no longer "processing", it
 * fires abort() locally and throws "aborted", stopping all further AI work
 * without waiting for the timeout.
 *
 * These tests verify that scenario:
 *   1. The DB status is flipped to "failed" externally (simulating the cancel
 *      landing on a different instance — no AbortController.abort() is called
 *      in-process).
 *   2. The background job's checkCancelledByDb poll detects the flip and
 *      terminates early.
 *   3. The completion write (status: "completed") is never issued.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock handles
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
// Mocks — same pattern as routes.truncation-warning.test.ts
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

function makeConversion(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: "test-user-1",
    visitorToken: null,
    originalFilename: "course-reader.pdf",
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

/**
 * Poll until `predicate` returns true against the recorded mockDbUpdateSet
 * calls, or throw after `timeoutMs`.
 */
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
    `Timed out waiting for matching db.update().set() call. Actual calls: ${JSON.stringify(
      mockDbUpdateSet.mock.calls.map(([d]: [any]) => d),
    )}`,
  );
}

/**
 * Wait until `generateAccessibleDocument` has been called (the job reached
 * the AI step), then yield for a few event-loop ticks to let the background
 * job finish the post-AI checkpoint and settle.
 */
async function waitForJobToFinishAfterAi(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mockGenerateAccessibleDocument.mock.calls.length > 0) {
      // Give the post-AI checkCancelledByDb and catch/finally blocks time to run.
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 20));
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Timed out waiting for generateAccessibleDocument to be called");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-instance cancel — DB status poll terminates the background job", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);
    mockNeedsOcr.mockReturnValue(false);
    app = await buildApp();
  });

  it(
    "POST /api/conversions/:id/process: job stops and does NOT write 'completed' " +
      "when DB status is flipped to 'failed' on another instance during AI generation",
    async () => {
      const conversion = makeConversion();

      // DB select call sequence:
      //   1. ownership / existence check      → returns the conversion row
      //   2. global concurrency count         → 0 active jobs
      //   3. checkCancelledByDb (post-extract) → still "processing"
      //   4. checkCancelledByDb (pre-AI gen)   → still "processing"
      //   5. checkCancelledByDb (post-AI gen)  → "failed" (cross-instance cancel)
      mockDbSelectWhere
        .mockResolvedValueOnce([conversion])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ status: "processing" }])
        .mockResolvedValueOnce([{ status: "processing" }])
        .mockResolvedValueOnce([{ status: "failed" }]);

      mockExtractPdfContent.mockResolvedValueOnce({
        text: "Some document text.",
        images: [],
        tables: [],
        metadata: {},
        pageCount: 10,
        warnings: [],
      });

      mockGenerateAccessibleDocument.mockResolvedValueOnce({
        accessibleHtml: "<html lang=\"en\"><body><h1>Doc</h1></body></html>",
        complianceReport: null,
        truncationWarning: undefined,
      });

      const res = await request(app).post("/api/conversions/1/process");
      expect(res.status).toBe(200);

      // Wait for AI generation to have been invoked, then let the job settle.
      await waitForJobToFinishAfterAi();

      // The job must have called generateAccessibleDocument (confirming it ran
      // that far), but must NOT have written the completion status.
      expect(mockGenerateAccessibleDocument).toHaveBeenCalledTimes(1);

      const completedCalls = mockDbUpdateSet.mock.calls.filter(
        ([data]: [any]) => data?.status === "completed",
      );
      expect(completedCalls).toHaveLength(0);
    },
  );

  it(
    "POST /api/conversions/:id/reprocess: job stops and does NOT write 'completed' " +
      "when DB status is flipped to 'failed' on another instance during AI generation",
    async () => {
      const conversion = makeConversion({
        status: "completed",
        extractedText: "Some document text.",
        extractionWarnings: null,
      });

      // DB select call sequence for reprocess:
      //   1. ownership / existence check      → returns the conversion row
      //   2. checkCancelledByDb (pre-AI gen)   → still "processing"
      //   3. checkCancelledByDb (post-AI gen)  → "failed" (cross-instance cancel)
      mockDbSelectWhere
        .mockResolvedValueOnce([conversion])
        .mockResolvedValueOnce([{ status: "processing" }])
        .mockResolvedValueOnce([{ status: "failed" }]);

      mockGenerateAccessibleDocument.mockResolvedValueOnce({
        accessibleHtml: "<html lang=\"en\"><body><h1>Doc</h1></body></html>",
        complianceReport: null,
        truncationWarning: undefined,
      });

      const res = await request(app).post("/api/conversions/1/reprocess").send({});
      expect(res.status).toBe(200);

      await waitForJobToFinishAfterAi();

      expect(mockGenerateAccessibleDocument).toHaveBeenCalledTimes(1);

      const completedCalls = mockDbUpdateSet.mock.calls.filter(
        ([data]: [any]) => data?.status === "completed",
      );
      expect(completedCalls).toHaveLength(0);

      _testDeleteReprocessKey(1);
    },
  );

  it(
    "POST /api/conversions/:id/process: job continues and completes when a " +
      "checkCancelledByDb DB read throws a transient error",
    async () => {
      const conversion = makeConversion();

      // DB select call sequence:
      //   1. ownership / existence check      → returns the conversion row
      //   2. global concurrency count         → 0 active jobs
      //   3. checkCancelledByDb (post-extract) → transient DB error (should be swallowed)
      //   4. checkCancelledByDb (pre-AI gen)   → still "processing"
      //   5. checkCancelledByDb (post-AI gen)  → still "processing"
      mockDbSelectWhere
        .mockResolvedValueOnce([conversion])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockRejectedValueOnce(new Error("connection timeout"))
        .mockResolvedValueOnce([{ status: "processing" }])
        .mockResolvedValueOnce([{ status: "processing" }]);

      mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);

      mockExtractPdfContent.mockResolvedValueOnce({
        text: "Some document text.",
        images: [],
        tables: [],
        metadata: {},
        pageCount: 2,
        warnings: [],
      });

      mockGenerateAccessibleDocument.mockResolvedValueOnce({
        accessibleHtml: "<html lang=\"en\"><body><h1>Doc</h1></body></html>",
        complianceReport: null,
        truncationWarning: undefined,
      });

      const res = await request(app).post("/api/conversions/1/process");
      expect(res.status).toBe(200);

      // Job must complete successfully despite the transient poll error.
      const completedPayload = await waitForUpdate((d) => d?.status === "completed");
      expect(completedPayload.status).toBe("completed");
    },
  );

  it(
    "POST /api/conversions/:id/reprocess: job continues and completes when a " +
      "checkCancelledByDb DB read throws a transient error",
    async () => {
      const conversion = makeConversion({
        status: "completed",
        extractedText: "Some document text.",
        extractionWarnings: null,
      });

      // DB select call sequence for reprocess:
      //   1. ownership / existence check    → returns the conversion row
      //   2. checkCancelledByDb (pre-AI)    → transient DB error (should be swallowed)
      //   3. checkCancelledByDb (post-AI)   → still "processing"
      mockDbSelectWhere
        .mockResolvedValueOnce([conversion])
        .mockRejectedValueOnce(new Error("connection timeout"))
        .mockResolvedValueOnce([{ status: "processing" }]);

      mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);

      mockGenerateAccessibleDocument.mockResolvedValueOnce({
        accessibleHtml: "<html lang=\"en\"><body><h1>Doc</h1></body></html>",
        complianceReport: null,
        truncationWarning: undefined,
      });

      const res = await request(app).post("/api/conversions/1/reprocess").send({});
      expect(res.status).toBe(200);

      // Job must complete successfully despite the transient poll error.
      const completedPayload = await waitForUpdate((d) => d?.status === "completed");
      expect(completedPayload.status).toBe("completed");

      _testDeleteReprocessKey(1);
    },
  );

  it(
    "POST /api/conversions/:id/process: job completes normally when DB status " +
      "stays 'processing' through all checkpoints (no cross-instance cancel)",
    async () => {
      const conversion = makeConversion();

      // All checkCancelledByDb calls return "processing" — job should complete.
      mockDbSelectWhere
        .mockResolvedValueOnce([conversion])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ status: "processing" }])
        .mockResolvedValueOnce([{ status: "processing" }])
        .mockResolvedValueOnce([{ status: "processing" }]);

      mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);

      mockExtractPdfContent.mockResolvedValueOnce({
        text: "Some document text.",
        images: [],
        tables: [],
        metadata: {},
        pageCount: 3,
        warnings: [],
      });

      mockGenerateAccessibleDocument.mockResolvedValueOnce({
        accessibleHtml: "<html lang=\"en\"><body><h1>Doc</h1></body></html>",
        complianceReport: null,
        truncationWarning: undefined,
      });

      const res = await request(app).post("/api/conversions/1/process");
      expect(res.status).toBe(200);

      const completedPayload = await waitForUpdate((d) => d?.status === "completed");
      expect(completedPayload.status).toBe("completed");
    },
  );
});
