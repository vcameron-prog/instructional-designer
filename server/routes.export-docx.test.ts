import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { MAX_CONCURRENT_DOCX_EXPORTS } from "./routes";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetContent, mockGetCourse, mockBuildContentDocx, mockBuildDocx, mockDbSelectWhere, currentUser } =
  vi.hoisted(() => ({
    mockGetContent: vi.fn(),
    mockGetCourse: vi.fn(),
    mockBuildContentDocx: vi.fn(),
    mockBuildDocx: vi.fn(),
    mockDbSelectWhere: vi.fn(),
    currentUser: { sub: "user-abc" },
  }));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getContent: mockGetContent,
    getCourse: mockGetCourse,
    getAllCourses: vi.fn(),
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
// Mock: Replit auth middleware — injects currentUser.sub so tests can change
// the authenticated user between cases by mutating currentUser.sub.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: currentUser.sub } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: currentUser.sub } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: currentUser.sub } };
    req.session = req.session ?? {};
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
// Mock: db singleton — chainable query-builder facade used by the conversions
// download-docx route.  The existing content export tests do not touch db
// directly (they go through storage), so the chainable shape is safe for all
// tests in this file.
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbSelectWhere }) }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: content-docx — buildContentDocx returns a dummy buffer
// ---------------------------------------------------------------------------
vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: mockBuildContentDocx,
}));

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
  editHtmlTableCaption: (html: string) => html,
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  applyAriaComboboxRoleFix: (html: string) => html,
  applyAriaGridRoleFix: (html: string) => html,
  applyAriaTabRoleFix: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: rateLimiters — all checks pass by default so routes reach the guard
// under test without being blocked by rate-limit checks first.
// ---------------------------------------------------------------------------
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
  sharedRateLimitCleanupInterval: undefined,
  anonRateLimitCleanupInterval: undefined,
  heavyOpRateLimitCleanupInterval: undefined,
  aiGenRateLimitCleanupInterval: undefined,
  uploadRateLimitCleanupInterval: undefined,
  anonRateLimits: new Map(),
  heavyOpRateLimits: new Map(),
  aiGenRateLimits: new Map(),
  uploadRateLimits: new Map(),
  getRateLimitCleanupMetrics: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock: docx-builder — buildDocx is a spy so individual tests can block it
// ---------------------------------------------------------------------------
vi.mock("./lib/docx-builder", () => ({
  buildDocx: mockBuildDocx,
}));

// ---------------------------------------------------------------------------
// Helper: build a fresh Express app each test
// ---------------------------------------------------------------------------
async function buildApp() {
  const { registerRoutes } = await import("./routes.js");
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/content/:id/export-docx — ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";
    app = await buildApp();

    mockBuildContentDocx.mockResolvedValue(Buffer.from("fake-docx"));
  });

  it("returns 200 when the authenticated user owns the content (userId match)", async () => {
    mockGetContent.mockResolvedValue({
      id: 1,
      content: "# Hello",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
    });

    await request(app)
      .get("/api/content/1/export-docx")
      .expect(200);

    expect(mockBuildContentDocx).toHaveBeenCalledTimes(1);
  });

  it("returns 200 when the content is course-linked and the user owns the course", async () => {
    mockGetContent.mockResolvedValue({
      id: 2,
      content: "# Hello",
      toolName: "syllabus",
      courseId: 10,
      userId: null,
    });
    mockGetCourse.mockResolvedValue({
      id: 10,
      courseNumber: "ENG101",
      userId: "user-abc",
    });

    await request(app)
      .get("/api/content/2/export-docx")
      .expect(200);

    expect(mockBuildContentDocx).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the content does not exist", async () => {
    mockGetContent.mockResolvedValue(null);

    await request(app)
      .get("/api/content/99/export-docx")
      .expect(404);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });

  it("returns 404 when the content is course-linked but the course belongs to another user", async () => {
    mockGetContent.mockResolvedValue({
      id: 3,
      content: "# Hello",
      toolName: "syllabus",
      courseId: 20,
      userId: null,
    });
    mockGetCourse.mockResolvedValue(null);

    await request(app)
      .get("/api/content/3/export-docx")
      .expect(404);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });

  it("returns 403 when another authenticated user tries to download content they do not own", async () => {
    mockGetContent.mockResolvedValue({
      id: 4,
      content: "# Hello",
      toolName: "rubric",
      courseId: null,
      userId: "user-xyz",
    });

    await request(app)
      .get("/api/content/4/export-docx")
      .expect(403);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous content (userId=null, courseId=null) — the ownership check must not be silently skipped", async () => {
    mockGetContent.mockResolvedValue({
      id: 5,
      content: "# Quick tool result",
      toolName: "assignment",
      courseId: null,
      userId: null,
    });

    await request(app)
      .get("/api/content/5/export-docx")
      .expect(403);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 503 concurrency-cap tests for GET /api/conversions/:id/download-docx
//
// MAX_CONCURRENT_DOCX_EXPORTS slots are filled with in-flight requests that
// block inside buildDocx (which is intercepted by vi.mock("./lib/docx-builder",
// ...)); a further request must receive 503.  Each blocker uses a distinct
// conversion ID (101, 102, 103) to avoid the 409 dedup path.  The blockers
// are released at the end so activeDocxExports returns to 0 and no state
// leaks into subsequent tests.
//
// The app is built once in beforeAll (not per-test) so that the db mock and
// rate-limiter mock set up here remain active for the duration of this suite
// without being cleared by per-test resetModules/clearAllMocks cycles.
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-docx — 503 concurrency cap", () => {
  let app: express.Express;

  const VALID_CONVERSION = {
    accessibleHtml: "<html><head><title>Doc</title></head><body><p>Hi</p></body></html>",
    originalFilename: "test.pdf",
    status: "completed",
    updatedAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";

    app = await buildApp();

    // db.select chain returns VALID_CONVERSION for every conversion lookup.
    mockDbSelectWhere.mockResolvedValue([VALID_CONVERSION]);
    // Default buildDocx return value — overridden per-test for the blocker path.
    mockBuildDocx.mockResolvedValue(Buffer.from("fake-docx"));
  });

  // -----------------------------------------------------------------------
  // 503 — global concurrency cap (MAX_CONCURRENT_DOCX_EXPORTS = 3 by default)
  //
  // Three blocker promises fill all available slots; a fourth request then
  // hits the activeDocxExports >= MAX_CONCURRENT_DOCX_EXPORTS guard.  Each
  // blocker is released at the end so the slot counter is correctly
  // decremented.  Different conversion IDs (101, 102, 103) are used so each
  // gets a unique dedup key and none trigger the 409 path.
  //
  // MAX_CONCURRENT_DOCX_EXPORTS is imported so the slot count is not hardcoded.
  // -----------------------------------------------------------------------
  it("returns 503 when the concurrent DOCX export cap is reached", async () => {
    const MAX_SLOTS = MAX_CONCURRENT_DOCX_EXPORTS;
    const resolvers: Array<(v: Buffer) => void> = [];
    const inflightDone: Promise<any>[] = [];

    for (let i = 0; i < MAX_SLOTS; i++) {
      const blocker = new Promise<Buffer>(resolve => {
        resolvers.push(resolve);
      });
      mockBuildDocx.mockImplementationOnce(() => blocker);
    }

    // Fire one request per slot using distinct conversion IDs (101, 102, 103)
    // so each gets a unique dedup key and none trigger the 409 guard.
    for (let i = 0; i < MAX_SLOTS; i++) {
      inflightDone.push(
        new Promise<any>(resolve => {
          request(app)
            .get(`/api/conversions/${101 + i}/download-docx`)
            .end((_err, res) => resolve(res));
        }),
      );
      // Pause between launches so each handler executes activeDocxExports++
      // before the next request is evaluated.
      await new Promise(r => setTimeout(r, 30));
    }

    // One more request — all slots occupied, must get 503.
    const res = await request(app).get("/api/conversions/200/download-docx");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/busy/i);

    // Release all blockers so in-flight jobs complete and activeDocxExports
    // returns to 0, leaving no leaked state for subsequent test runs.
    resolvers.forEach(r => r(Buffer.from("fake-docx")));
    await Promise.all(inflightDone);
  }, 15_000);

  // -----------------------------------------------------------------------
  // 409 — per-conversion in-flight deduplication
  //
  // A blocker keeps the first request alive long enough for a second request
  // for the same conversion ID to see the key in activeDocxExportKeys.
  // The blocker is released after the assertion so activeDocxExports and
  // activeDocxExportKeys return to 0, leaving no leaked state.
  // -----------------------------------------------------------------------
  it("returns 409 when a DOCX export for the same conversion is already in progress", async () => {
    let resolveDocx!: (buf: Buffer) => void;
    const blocker = new Promise<Buffer>(resolve => {
      resolveDocx = resolve;
    });
    mockBuildDocx.mockImplementationOnce(() => blocker);

    // Fire req1 immediately via .end() without waiting for the response.
    const req1Done = new Promise<any>(resolve => {
      request(app)
        .get("/api/conversions/1/download-docx")
        .end((_err, res) => resolve(res));
    });

    // Yield to the event loop so the handler runs far enough to add the dedup
    // key to activeDocxExportKeys before req2 is sent.
    await new Promise(r => setTimeout(r, 50));

    // Second request for the same conversion ID must be rejected with 409.
    const res2 = await request(app).get("/api/conversions/1/download-docx");

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already in progress/i);

    // Release the blocker so req1 completes and activeDocxExports decrements.
    resolveDocx(Buffer.from("fake-docx"));
    await req1Done;
  }, 15_000);
});
