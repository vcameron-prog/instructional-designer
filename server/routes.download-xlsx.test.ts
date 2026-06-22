import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { MAX_CONCURRENT_XLSX_EXPORTS, INVALID_ID_ERROR } from "./routes";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockBuildXlsx, mockDbSelectWhere, currentUser } = vi.hoisted(() => ({
  mockBuildXlsx: vi.fn(),
  mockDbSelectWhere: vi.fn(),
  currentUser: { sub: "user-abc" },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getContent: vi.fn(),
    getCourse: vi.fn(),
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
// Mock: db singleton — chainable query-builder facade
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbSelectWhere }) }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: xlsx-builder — buildXlsx is a spy so individual tests can block it
// ---------------------------------------------------------------------------
vi.mock("./lib/xlsx-builder", () => ({
  buildXlsx: mockBuildXlsx,
}));

// ---------------------------------------------------------------------------
// Mock: content-docx
// ---------------------------------------------------------------------------
vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: vi.fn(),
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
  buildDocx: vi.fn(),
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
const VALID_XLSX_CONVERSION = {
  accessibleHtml: "<html><head><title>Grades</title></head><body><table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>Alice</td><td>95</td></tr></tbody></table></body></html>",
  originalFilename: "grades.xlsx",
  status: "completed",
  sourceType: "xlsx",
};

// ---------------------------------------------------------------------------
// Tests: error cases (app rebuilt per test)
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-xlsx — error cases", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";
    app = await buildApp();

    mockBuildXlsx.mockResolvedValue(Buffer.from("PK\x03\x04fake-xlsx"));
  });

  it("returns 400 for a non-numeric ID without touching the database", async () => {
    const res = await request(app).get("/api/conversions/abc/download-xlsx");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(INVALID_ID_ERROR);
    expect(mockDbSelectWhere).not.toHaveBeenCalled();
    expect(mockBuildXlsx).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversion does not exist", async () => {
    mockDbSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/conversions/999/download-xlsx");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(mockBuildXlsx).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-spreadsheet source type (pdf)", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_XLSX_CONVERSION, sourceType: "pdf" },
    ]);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/spreadsheet/i);
    expect(mockBuildXlsx).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-spreadsheet source type (docx)", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_XLSX_CONVERSION, sourceType: "docx" },
    ]);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/spreadsheet/i);
    expect(mockBuildXlsx).not.toHaveBeenCalled();
  });

  it("returns 400 when the conversion is not yet completed", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_XLSX_CONVERSION, status: "processing", accessibleHtml: null },
    ]);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not available/i);
    expect(mockBuildXlsx).not.toHaveBeenCalled();
  });

  it("returns 400 when status is completed but accessibleHtml is missing", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_XLSX_CONVERSION, status: "completed", accessibleHtml: null },
    ]);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not available/i);
    expect(mockBuildXlsx).not.toHaveBeenCalled();
  });

  it("accepts all supported spreadsheet source types (google-sheet)", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_XLSX_CONVERSION, sourceType: "google-sheet" },
    ]);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(200);
    expect(mockBuildXlsx).toHaveBeenCalledTimes(1);
  });

  it("accepts ods as a spreadsheet source type", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_XLSX_CONVERSION, sourceType: "ods" },
    ]);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(200);
    expect(mockBuildXlsx).toHaveBeenCalledTimes(1);
  });

  it("accepts csv as a spreadsheet source type", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { ...VALID_XLSX_CONVERSION, sourceType: "csv" },
    ]);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(200);
    expect(mockBuildXlsx).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with correct headers for a valid xlsx conversion (happy path)", async () => {
    mockDbSelectWhere.mockResolvedValue([VALID_XLSX_CONVERSION]);

    const fakeBuffer = Buffer.from("PK\x03\x04fake-xlsx-content");
    mockBuildXlsx.mockResolvedValue(fakeBuffer);

    const res = await request(app).get("/api/conversions/1/download-xlsx");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(
      /vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/\.xlsx/);
    expect(mockBuildXlsx).toHaveBeenCalledTimes(1);
    expect(parseInt(res.headers["content-length"] ?? "0")).toBeGreaterThan(0);
  });

  it("passes the document title extracted from <title> to buildXlsx", async () => {
    mockDbSelectWhere.mockResolvedValue([VALID_XLSX_CONVERSION]);
    mockBuildXlsx.mockResolvedValue(Buffer.from("PK\x03\x04fake"));

    await request(app).get("/api/conversions/1/download-xlsx");

    expect(mockBuildXlsx).toHaveBeenCalledWith(
      VALID_XLSX_CONVERSION.accessibleHtml,
      "Grades",
    );
  });

  it("falls back to the filename stem when <title> is absent", async () => {
    mockDbSelectWhere.mockResolvedValue([
      {
        ...VALID_XLSX_CONVERSION,
        accessibleHtml: "<html><body><p>no title</p></body></html>",
        originalFilename: "report.xlsx",
      },
    ]);
    mockBuildXlsx.mockResolvedValue(Buffer.from("PK\x03\x04fake"));

    await request(app).get("/api/conversions/1/download-xlsx");

    expect(mockBuildXlsx).toHaveBeenCalledWith(
      expect.any(String),
      "report",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: concurrency/dedup guards (app built once in beforeAll)
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-xlsx — 503 concurrency cap", () => {
  let app: express.Express;

  beforeAll(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";

    app = await buildApp();

    mockDbSelectWhere.mockResolvedValue([VALID_XLSX_CONVERSION]);
    mockBuildXlsx.mockResolvedValue(Buffer.from("PK\x03\x04fake-xlsx"));
  });

  // -----------------------------------------------------------------------
  // 503 — global concurrency cap (MAX_CONCURRENT_XLSX_EXPORTS = 3 by default)
  //
  // Fill all slots with blocking requests using distinct conversion IDs so
  // none of them trigger the 409 dedup path.  A further request must then
  // receive 503.  Release all blockers at the end so activeXlsxExports
  // returns to 0 and no state leaks into subsequent test runs.
  // -----------------------------------------------------------------------
  it("returns 503 when the concurrent XLSX export cap is reached", async () => {
    const MAX_SLOTS = MAX_CONCURRENT_XLSX_EXPORTS;
    const resolvers: Array<(v: Buffer) => void> = [];
    const inflightDone: Promise<any>[] = [];

    for (let i = 0; i < MAX_SLOTS; i++) {
      const blocker = new Promise<Buffer>(resolve => {
        resolvers.push(resolve);
      });
      mockBuildXlsx.mockImplementationOnce(() => blocker);
    }

    for (let i = 0; i < MAX_SLOTS; i++) {
      inflightDone.push(
        new Promise<any>(resolve => {
          request(app)
            .get(`/api/conversions/${201 + i}/download-xlsx`)
            .end((_err, res) => resolve(res));
        }),
      );
      await new Promise(r => setTimeout(r, 30));
    }

    const res = await request(app).get("/api/conversions/300/download-xlsx");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/busy/i);

    resolvers.forEach(r => r(Buffer.from("PK\x03\x04fake-xlsx")));
    await Promise.all(inflightDone);
  }, 15_000);

  // -----------------------------------------------------------------------
  // 409 — per-conversion in-flight deduplication
  //
  // A blocker keeps the first request alive; a second request for the same
  // conversion ID must be rejected with 409.
  // -----------------------------------------------------------------------
  it("returns 409 when an XLSX export for the same conversion is already in progress", async () => {
    let resolveXlsx!: (buf: Buffer) => void;
    const blocker = new Promise<Buffer>(resolve => {
      resolveXlsx = resolve;
    });
    mockBuildXlsx.mockImplementationOnce(() => blocker);

    const req1Done = new Promise<any>(resolve => {
      request(app)
        .get("/api/conversions/42/download-xlsx")
        .end((_err, res) => resolve(res));
    });

    await new Promise(r => setTimeout(r, 50));

    const res2 = await request(app).get("/api/conversions/42/download-xlsx");

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already in progress/i);

    resolveXlsx(Buffer.from("PK\x03\x04fake-xlsx"));
    await req1Done;
  }, 15_000);
});
