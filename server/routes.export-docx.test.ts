import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { INVALID_ID_ERROR, MAX_CONCURRENT_DOCX_EXPORTS } from "./routes";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockBuildDocx, mockDbSelectWhere, currentUser } = vi.hoisted(() => ({
  mockBuildDocx: vi.fn(),
  mockDbSelectWhere: vi.fn(),
  currentUser: { sub: "user-abc" },
}));

// ---------------------------------------------------------------------------
// Mock: db — chainable query-builder facade
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbSelectWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: vi.fn() }) }) }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware
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
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  fixComplianceIssue: vi.fn(),
  fixAllAriaRoleMisuse: vi.fn(),
  getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
  applyAriaComboboxRoleFix: (html: string) => html,
  applyAriaGridRoleFix: (html: string) => html,
  applyAriaTabRoleFix: (html: string) => html,
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
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: rateLimiters — all checks pass by default
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
// Mock: docx-builder
// ---------------------------------------------------------------------------
vi.mock("./lib/docx-builder", () => ({
  buildDocx: mockBuildDocx,
}));

// ---------------------------------------------------------------------------
// Mock: content-docx
// ---------------------------------------------------------------------------
vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: vi.fn(),
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
// Test data
// ---------------------------------------------------------------------------
const VALID_DOCX_CONVERSION = {
  accessibleHtml:
    "<html lang=\"en\"><head><title>Lecture Notes</title></head><body><p>Hello</p></body></html>",
  originalFilename: "lecture-notes.pdf",
  status: "completed",
  updatedAt: new Date("2025-01-15T10:00:00Z"),
};

// ---------------------------------------------------------------------------
// Tests: GET /api/conversions/:id/download-docx
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-docx — error cases", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";
    app = await buildApp();

    mockBuildDocx.mockResolvedValue(
      Buffer.from("PK\x03\x04fake-docx-content"),
    );
  });

  it("returns 400 for a non-numeric ID without touching the database", async () => {
    const res = await request(app).get("/api/conversions/abc/download-docx");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(INVALID_ID_ERROR);
    expect(mockDbSelectWhere).not.toHaveBeenCalled();
    expect(mockBuildDocx).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversion does not exist", async () => {
    mockDbSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/conversions/999/download-docx");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(mockBuildDocx).not.toHaveBeenCalled();
  });

  it("returns 400 when the conversion is not yet completed", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_DOCX_CONVERSION, status: "processing", accessibleHtml: null },
    ]);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not available/i);
    expect(mockBuildDocx).not.toHaveBeenCalled();
  });

  it("returns 400 when status is completed but accessibleHtml is missing", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_DOCX_CONVERSION, status: "completed", accessibleHtml: null },
    ]);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not available/i);
    expect(mockBuildDocx).not.toHaveBeenCalled();
  });

  it("returns 200 with correct headers for a valid DOCX conversion (happy path)", async () => {
    mockDbSelectWhere.mockResolvedValue([VALID_DOCX_CONVERSION]);

    const fakeBuffer = Buffer.from("PK\x03\x04fake-docx-bytes");
    mockBuildDocx.mockResolvedValue(fakeBuffer);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(
      /vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
    );
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/\.docx/);
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    expect(parseInt(res.headers["content-length"] ?? "0")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: concurrency/dedup guards (app built once in beforeAll)
//
// The app is built once so that module-level state (activeDocxExports,
// activeDocxExportKeys) persists across requests within each describe block.
// Per-test resetModules/clearAllMocks would tear that state down, which would
// prevent the blocker pattern from working.
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-docx — 503 concurrency cap", () => {
  let app: express.Express;

  const VALID_CONVERSION = {
    accessibleHtml:
      "<html lang=\"en\"><head><title>Doc</title></head><body><p>Hi</p></body></html>",
    originalFilename: "test.pdf",
    status: "completed",
    updatedAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";

    app = await buildApp();

    mockDbSelectWhere.mockResolvedValue([VALID_CONVERSION]);
    mockBuildDocx.mockResolvedValue(Buffer.from("PK\x03\x04fake-docx"));
  });

  // -----------------------------------------------------------------------
  // 503 — global concurrency cap (MAX_CONCURRENT_DOCX_EXPORTS = 3 by default)
  //
  // Fill all slots with blocking requests using distinct conversion IDs so
  // none of them trigger the 409 dedup path.  A further request must then
  // receive 503.  Release all blockers at the end so activeDocxExports
  // returns to 0 and no state leaks into subsequent test runs.
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

    for (let i = 0; i < MAX_SLOTS; i++) {
      inflightDone.push(
        new Promise<any>(resolve => {
          request(app)
            .get(`/api/conversions/${101 + i}/download-docx`)
            .end((_err, res) => resolve(res));
        }),
      );
      await new Promise(r => setTimeout(r, 30));
    }

    const res = await request(app).get("/api/conversions/200/download-docx");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/busy/i);

    resolvers.forEach(r => r(Buffer.from("PK\x03\x04fake-docx")));
    await Promise.all(inflightDone);
  }, 15_000);

  // -----------------------------------------------------------------------
  // 409 — per-conversion in-flight deduplication
  //
  // A blocker keeps the first request alive; a second request for the same
  // conversion ID must be rejected with 409.  The blocker is released after
  // the assertion so activeDocxExports and activeDocxExportKeys return to 0,
  // leaving no leaked state for subsequent tests.
  // -----------------------------------------------------------------------
  it("returns 409 when a DOCX export for the same conversion is already in progress", async () => {
    let resolveDocx!: (buf: Buffer) => void;
    const blocker = new Promise<Buffer>(resolve => {
      resolveDocx = resolve;
    });
    mockBuildDocx.mockImplementationOnce(() => blocker);

    const req1Done = new Promise<any>(resolve => {
      request(app)
        .get("/api/conversions/42/download-docx")
        .end((_err, res) => resolve(res));
    });

    await new Promise(r => setTimeout(r, 50));

    const res2 = await request(app).get("/api/conversions/42/download-docx");

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already in progress/i);

    resolveDocx(Buffer.from("PK\x03\x04fake-docx"));
    await req1Done;
  }, 15_000);
});
