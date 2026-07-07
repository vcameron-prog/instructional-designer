import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { MAX_CONCURRENT_PDF_EXPORTS, INVALID_ID_ERROR } from "./routes";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted to the top of the file, so
// any variables they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const { mockBuildPdf, mockDbSelectWhere, mockCheckSharedRateLimit, mockCheckHeavyOpRateLimit, mockGetFirstHeadingLevel, mockBuildHeadingRenumberedNoteHtml } =
  vi.hoisted(() => ({
    mockBuildPdf: vi.fn(),
    mockDbSelectWhere: vi.fn(),
    mockCheckSharedRateLimit: vi.fn(),
    mockCheckHeavyOpRateLimit: vi.fn(),
    mockGetFirstHeadingLevel: vi.fn(),
    mockBuildHeadingRenumberedNoteHtml: vi.fn(),
  }));

// ---------------------------------------------------------------------------
// Mock: db — provides a chainable query-builder facade.
// The route uses: db.select().from(...).where(...)  → read conversion by id+owner
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbSelectWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: vi.fn() }) }) }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: pdf-builder — intercepts the dynamic import inside the route handler.
// Individual tests control when the promise resolves via mockBuildPdf.
// ---------------------------------------------------------------------------
vi.mock("./lib/pdf-builder", () => ({
  buildPdf: mockBuildPdf,
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware — all variants are pass-through so the route
// handler always runs without a real OIDC session.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => { req.session = req.session ?? {}; next(); },
  isBsuAuthenticated: (req: any, _res: any, next: any) => { req.session = req.session ?? {}; next(); },
  optionalAuth: (req: any, _res: any, next: any) => { req.session = req.session ?? {}; next(); },
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK — prevents a real API client from being instantiated.
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
  },
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", async () => {
  const { createAccessibilityEngineMock } = await import("./test-utils/accessibility-engine-mock");
  return createAccessibilityEngineMock({
    getFirstHeadingLevel: mockGetFirstHeadingLevel,
    buildHeadingRenumberedNoteHtml: mockBuildHeadingRenumberedNoteHtml,
  });
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
// Mock: rateLimiters — all checks pass by default so only concurrency tests
// need to worry about rate-limit behaviour.
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
// Module under test
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ACCESSIBLE_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Test Doc</title></head><body><main><h1>Test</h1></main></body></html>';

// Minimal conversion row that passes the route's pre-condition checks:
//   status === "completed" && accessibleHtml !== null
const BASE_CONVERSION = {
  id: 1,
  originalFilename: "test.pdf",
  status: "completed",
  accessibleHtml: ACCESSIBLE_HTML,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

// ---------------------------------------------------------------------------
// Helper: build a fresh Express app
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// ---------------------------------------------------------------------------
// Guard-path tests for GET /api/conversions/:id/download-pdf
//
// The 503 test manipulates in-flight state (activePdfExports /
// activePdfExportKeys) that lives at module level inside routes.ts.  The test
// uses "blocker" promises that never resolve until explicitly released, so the
// in-flight counters are incremented before the guard assertion is made.
// All blockers are released in a finally-style cleanup so the counter returns
// to zero before any subsequent test runs.
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-pdf — invalid ID guard", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns 400 for a non-numeric conversion ID without touching the DB or builder", async () => {
    const res = await request(app).get("/api/conversions/abc/download-pdf");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(INVALID_ID_ERROR);
    expect(mockDbSelectWhere).not.toHaveBeenCalled();
    expect(mockBuildPdf).not.toHaveBeenCalled();
  });
});

describe("GET /api/conversions/:id/download-pdf — guard paths", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    mockDbSelectWhere.mockResolvedValue([BASE_CONVERSION]);
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockBuildPdf.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  });

  // -----------------------------------------------------------------------
  // 503 — global concurrency cap (MAX_CONCURRENT_PDF_EXPORTS = 2 by default)
  //
  // Two blocker promises fill all available PDF-export slots; a third request
  // then hits the activePdfExports >= MAX_CONCURRENT_PDF_EXPORTS guard.
  // Different conversion IDs (10, 11) are used for the two in-flight requests
  // so they each get a unique per-document dedup key and bypass the 409 path.
  //
  // Uses the same .end() fire-and-forget pattern as routes.fix-issue.test.ts:
  //   - supertest only dispatches the HTTP request when awaited or .end() is
  //     called, so .end() is used to fire each blocker request immediately.
  //   - A short setTimeout(30 ms) between launches lets each handler run far
  //     enough to execute activePdfExports++ before the next is sent.
  //   - All blockers are resolved after the assertion so activePdfExports
  //     decrements back to 0 via the route's finally block, leaving no leaked
  //     state for subsequent tests.
  // -----------------------------------------------------------------------
  it("returns 503 when the concurrent PDF export cap is reached", async () => {
    const MAX_SLOTS = MAX_CONCURRENT_PDF_EXPORTS;
    const resolvers: Array<(buf: Buffer) => void> = [];
    const inflightDone: Promise<any>[] = [];

    // Wire up one blocker per available slot.
    for (let i = 0; i < MAX_SLOTS; i++) {
      const blocker = new Promise<Buffer>(resolve => {
        resolvers.push(resolve);
      });
      mockBuildPdf.mockImplementationOnce(() => blocker);
    }

    // Make the DB return a matching conversion for every ID used below.
    mockDbSelectWhere.mockResolvedValue([BASE_CONVERSION]);

    // Fire one request per slot using distinct conversion IDs (10, 11, …)
    // so each gets a unique per-document dedup key and none hit the 409 guard.
    for (let i = 0; i < MAX_SLOTS; i++) {
      inflightDone.push(
        new Promise<any>(resolve => {
          request(app)
            .get(`/api/conversions/${10 + i}/download-pdf`)
            .end((_err, res) => resolve(res));
        }),
      );
      // Yield to the event loop so each handler executes activePdfExports++
      // before the next request is evaluated.
      await new Promise(r => setTimeout(r, 30));
    }

    // One more request — all slots occupied, must get 503.
    const res = await request(app).get("/api/conversions/20/download-pdf");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/busy/i);

    // Release all blockers so in-flight jobs complete and activePdfExports
    // returns to 0, leaving no leaked state for subsequent test runs.
    const fakePdf = Buffer.from("%PDF-1.4 fake");
    resolvers.forEach(r => r(fakePdf));
    await Promise.all(inflightDone);
  }, 15_000);

  // -----------------------------------------------------------------------
  // 409 — per-conversion in-flight deduplication
  //
  // A blocker keeps the first request alive long enough for a second request
  // for the same conversion ID to see the key in activePdfExportKeys.
  // -----------------------------------------------------------------------
  it("returns 409 when a PDF export for the same conversion is already in progress", async () => {
    let resolvePdf!: (buf: Buffer) => void;
    const blocker = new Promise<Buffer>(resolve => {
      resolvePdf = resolve;
    });
    mockBuildPdf.mockImplementationOnce(() => blocker);

    // Fire req1 immediately via .end() without waiting for the response.
    const req1Done = new Promise<any>(resolve => {
      request(app)
        .get("/api/conversions/1/download-pdf")
        .end((_err, res) => resolve(res));
    });

    // Yield to the event loop so the handler runs far enough to add the dedup
    // key to activePdfExportKeys before req2 is sent.
    await new Promise(r => setTimeout(r, 50));

    // Second request for the same conversion ID must be rejected with 409.
    const res2 = await request(app).get("/api/conversions/1/download-pdf");

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already in progress/i);

    // Release the blocker so req1 completes and activePdfExports decrements.
    resolvePdf(Buffer.from("%PDF-1.4 fake"));
    await req1Done;
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Tests: renumbering notice survives PDF export
//
// When a document's topmost heading is not H1, the route calls
// getFirstHeadingLevel → buildHeadingRenumberedNoteHtml and splices the
// resulting notice into the HTML immediately after <body>.  These tests assert
// that the notice text is present in the HTML argument actually passed to
// buildPdf, so a silent drop or stripping in the HTML-preparation step is
// caught before it reaches the PDF renderer.
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-pdf — renumbering notice", () => {
  let app: express.Express;

  const H2_CONVERSION = {
    id: 1,
    accessibleHtml:
      '<html lang="en"><head><title>Lecture</title></head><body><h2>Section One</h2></body></html>',
    originalFilename: "lecture.pdf",
    status: "completed",
    updatedAt: new Date("2025-06-01T10:00:00Z"),
  };

  const NOTE_SENTINEL =
    '<div role="note" aria-label="Heading levels renumbered notice">Headings were shifted by 1 level</div>';

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    mockBuildPdf.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  });

  it("passes the renumbering notice to buildPdf when the topmost heading is not H1", async () => {
    mockDbSelectWhere.mockResolvedValue([H2_CONVERSION]);
    mockGetFirstHeadingLevel.mockReturnValue(2);
    mockBuildHeadingRenumberedNoteHtml.mockReturnValue(NOTE_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildPdf.mock.calls[0][0];
    expect(htmlArg).toContain(NOTE_SENTINEL);
    expect(mockBuildHeadingRenumberedNoteHtml).toHaveBeenCalledWith(2);
  });

  it("does not pass a renumbering notice to buildPdf when the topmost heading is already H1", async () => {
    mockDbSelectWhere.mockResolvedValue([H2_CONVERSION]);
    mockGetFirstHeadingLevel.mockReturnValue(1);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    expect(mockBuildHeadingRenumberedNoteHtml).not.toHaveBeenCalled();
  });

  it("does not pass a renumbering notice to buildPdf when no heading is detected", async () => {
    mockDbSelectWhere.mockResolvedValue([H2_CONVERSION]);
    mockGetFirstHeadingLevel.mockReturnValue(null);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    expect(mockBuildHeadingRenumberedNoteHtml).not.toHaveBeenCalled();
  });
});
