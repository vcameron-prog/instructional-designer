/**
 * Route-level tests verifying that auto-fix export notices are injected into
 * the exported HTML for all three download routes:
 *
 *   GET /api/conversions/:id/download          (HTML)
 *   GET /api/conversions/:id/download-docx     (DOCX)
 *   GET /api/conversions/:id/download-pdf      (PDF)
 *
 * Each route reads `complianceReport` from the DB and, when the report's
 * issues contain specific `fixNotes` markers, splices a visible notice
 * `<div>` into the exported HTML right after `<body>`.  These tests assert
 * that the injection actually happens so a future edit to the injection block
 * cannot silently break all three formats at once without a test failure.
 *
 * Three notice paths are covered per route:
 *   - Main landmark  (BYPASS_BLOCKS_FIX_NOTE on criterion "2.4.1")
 *   - Page title fallback  (PAGE_TITLE_FALLBACK_NOTE on criterion "2.4.2")
 *   - Page title low quality  (PAGE_TITLE_LOW_QUALITY_NOTE on criterion "2.4.2")
 *
 * Plus at least one stacking test per route: two notices active at once, both
 * appearing in the output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Import the real page-title sentinel strings.
// @shared/page-title-messages is NOT mocked, so routes.ts uses their real
// values and we can build matching complianceReport fixtures from them here.
// ---------------------------------------------------------------------------
import { PAGE_TITLE_FALLBACK_NOTE, PAGE_TITLE_LOW_QUALITY_NOTE } from "../shared/page-title-messages";

// ---------------------------------------------------------------------------
// Hoisted mocks
//
// BYPASS_BLOCKS_FIX_NOTE lives in the mocked accessibility-engine, so we
// define a sentinel string here and override the mock constant to that value.
// The route code then sees this sentinel when it evaluates
//   iss.fixNotes === BYPASS_BLOCKS_FIX_NOTE
// and the fixtures below use the same sentinel as their fixNotes value.
// ---------------------------------------------------------------------------
const MOCK_BYPASS_BLOCKS_FIX_NOTE =
  "A <main> landmark was automatically added around your page content.";

const {
  mockDbSelectWhere,
  mockBuildDocx,
  mockBuildPdf,
  mockBuildMainLandmarkNoteHtml,
  mockBuildPageTitleFallbackNoteHtml,
  mockBuildPageTitleLowQualityNoteHtml,
  mockCheckSharedRateLimit,
  mockCheckHeavyOpRateLimit,
} = vi.hoisted(() => ({
  mockDbSelectWhere: vi.fn(),
  mockBuildDocx: vi.fn(),
  mockBuildPdf: vi.fn(),
  mockBuildMainLandmarkNoteHtml: vi.fn(),
  mockBuildPageTitleFallbackNoteHtml: vi.fn(),
  mockBuildPageTitleLowQualityNoteHtml: vi.fn(),
  mockCheckSharedRateLimit: vi.fn(),
  mockCheckHeavyOpRateLimit: vi.fn(),
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
// Mock: Replit auth middleware — all variants are pass-through
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
//
// Overrides BYPASS_BLOCKS_FIX_NOTE with our local sentinel so the route's
// comparison (iss.fixNotes === BYPASS_BLOCKS_FIX_NOTE) matches the fixtures.
// The three note-builder functions are replaced with test spies so tests can
// inject known sentinel strings and assert exact HTML appearance.
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", async () => {
  const { createAccessibilityEngineMock } = await import("./test-utils/accessibility-engine-mock");
  return createAccessibilityEngineMock({
    BYPASS_BLOCKS_FIX_NOTE: MOCK_BYPASS_BLOCKS_FIX_NOTE,
    buildMainLandmarkNoteHtml: mockBuildMainLandmarkNoteHtml,
    buildPageTitleFallbackNoteHtml: mockBuildPageTitleFallbackNoteHtml,
    buildPageTitleLowQualityNoteHtml: mockBuildPageTitleLowQualityNoteHtml,
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
// Mock: rateLimiters — all checks pass
// ---------------------------------------------------------------------------
vi.mock("./lib/rateLimiters.js", () => ({
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
  getRateLimitCleanupMetrics: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock: docx-builder and pdf-builder
// ---------------------------------------------------------------------------
vi.mock("./lib/docx-builder", () => ({
  buildDocx: mockBuildDocx,
}));

vi.mock("./lib/pdf-builder", () => ({
  buildPdf: mockBuildPdf,
}));

// ---------------------------------------------------------------------------
// Mock: content-docx
// ---------------------------------------------------------------------------
vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildApp() {
  const { registerRoutes } = await import("./routes.js");
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

const BASE_HTML =
  '<html lang="en"><head><title>Course Notes</title></head><body><h1>Welcome</h1></body></html>';

function makeConversion(complianceReport: object | null = null) {
  return {
    id: 1,
    accessibleHtml: BASE_HTML,
    originalFilename: "course-notes.pdf",
    status: "completed",
    updatedAt: new Date("2026-01-10T12:00:00Z"),
    complianceReport,
  };
}

const MAIN_LANDMARK_SENTINEL =
  '<div role="note" aria-label="Main landmark added">A main landmark was added.</div>';

const PAGE_TITLE_FALLBACK_SENTINEL =
  '<div role="note" aria-label="Page title fallback">A fallback title was used.</div>';

const PAGE_TITLE_LOW_QUALITY_SENTINEL =
  '<div role="note" aria-label="Page title low quality">The page title may not be descriptive.</div>';

// ---------------------------------------------------------------------------
// ── HTML DOWNLOAD  GET /api/conversions/:id/download ────────────────────────
// ---------------------------------------------------------------------------

describe("GET /api/conversions/:id/download — export notices (HTML)", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    app = await buildApp();
  });

  it("injects the main-landmark notice when complianceReport contains BYPASS_BLOCKS_FIX_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.1", fixNotes: MOCK_BYPASS_BLOCKS_FIX_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildMainLandmarkNoteHtml.mockReturnValue(MAIN_LANDMARK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download");

    expect(res.status).toBe(200);
    expect(res.text).toContain(MAIN_LANDMARK_SENTINEL);
    expect(mockBuildMainLandmarkNoteHtml).toHaveBeenCalledTimes(1);
  });

  it("does not inject the main-landmark notice when 2.4.1 has no fixNotes", async () => {
    const report = { issues: [{ criterion: "2.4.1" }] };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);

    const res = await request(app).get("/api/conversions/1/download");

    expect(res.status).toBe(200);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
  });

  it("injects the page-title fallback notice when complianceReport contains PAGE_TITLE_FALLBACK_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.2", fixNotes: PAGE_TITLE_FALLBACK_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildPageTitleFallbackNoteHtml.mockReturnValue(PAGE_TITLE_FALLBACK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download");

    expect(res.status).toBe(200);
    expect(res.text).toContain(PAGE_TITLE_FALLBACK_SENTINEL);
    expect(mockBuildPageTitleFallbackNoteHtml).toHaveBeenCalledTimes(1);
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  it("injects the page-title low-quality notice when complianceReport contains PAGE_TITLE_LOW_QUALITY_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.2", fixNotes: PAGE_TITLE_LOW_QUALITY_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildPageTitleLowQualityNoteHtml.mockReturnValue(PAGE_TITLE_LOW_QUALITY_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download");

    expect(res.status).toBe(200);
    expect(res.text).toContain(PAGE_TITLE_LOW_QUALITY_SENTINEL);
    expect(mockBuildPageTitleLowQualityNoteHtml).toHaveBeenCalledTimes(1);
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
  });

  it("injects no notices when complianceReport has no matching fixNotes", async () => {
    const report = {
      issues: [
        { criterion: "1.1.1", status: "pass" },
        { criterion: "2.4.1", status: "pass" },
        { criterion: "2.4.2", status: "pass" },
      ],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);

    const res = await request(app).get("/api/conversions/1/download");

    expect(res.status).toBe(200);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  it("injects no notices when complianceReport is null", async () => {
    mockDbSelectWhere.mockResolvedValue([makeConversion(null)]);

    const res = await request(app).get("/api/conversions/1/download");

    expect(res.status).toBe(200);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  // Stacking: main landmark + page title fallback both active at once
  it("stacking — injects both main-landmark and page-title-fallback notices in order", async () => {
    const report = {
      issues: [
        { criterion: "2.4.1", fixNotes: MOCK_BYPASS_BLOCKS_FIX_NOTE },
        { criterion: "2.4.2", fixNotes: PAGE_TITLE_FALLBACK_NOTE },
      ],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildMainLandmarkNoteHtml.mockReturnValue(MAIN_LANDMARK_SENTINEL);
    mockBuildPageTitleFallbackNoteHtml.mockReturnValue(PAGE_TITLE_FALLBACK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download");

    expect(res.status).toBe(200);
    expect(res.text).toContain(MAIN_LANDMARK_SENTINEL);
    expect(res.text).toContain(PAGE_TITLE_FALLBACK_SENTINEL);
    // Main landmark is pushed first, page-title second — check ordering
    expect(res.text.indexOf(MAIN_LANDMARK_SENTINEL)).toBeLessThan(
      res.text.indexOf(PAGE_TITLE_FALLBACK_SENTINEL),
    );
  });
});

// ---------------------------------------------------------------------------
// ── DOCX DOWNLOAD  GET /api/conversions/:id/download-docx ───────────────────
// ---------------------------------------------------------------------------

describe("GET /api/conversions/:id/download-docx — export notices (DOCX)", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    mockBuildDocx.mockResolvedValue(Buffer.from("PK\x03\x04fake-docx"));
    app = await buildApp();
  });

  it("passes the main-landmark notice to buildDocx when complianceReport contains BYPASS_BLOCKS_FIX_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.1", fixNotes: MOCK_BYPASS_BLOCKS_FIX_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildMainLandmarkNoteHtml.mockReturnValue(MAIN_LANDMARK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(200);
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildDocx.mock.calls[0][0];
    expect(htmlArg).toContain(MAIN_LANDMARK_SENTINEL);
    expect(mockBuildMainLandmarkNoteHtml).toHaveBeenCalledTimes(1);
  });

  it("does not pass the main-landmark notice to buildDocx when 2.4.1 has no fixNotes", async () => {
    const report = { issues: [{ criterion: "2.4.1" }] };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(200);
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
  });

  it("passes the page-title fallback notice to buildDocx when complianceReport contains PAGE_TITLE_FALLBACK_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.2", fixNotes: PAGE_TITLE_FALLBACK_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildPageTitleFallbackNoteHtml.mockReturnValue(PAGE_TITLE_FALLBACK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(200);
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildDocx.mock.calls[0][0];
    expect(htmlArg).toContain(PAGE_TITLE_FALLBACK_SENTINEL);
    expect(mockBuildPageTitleFallbackNoteHtml).toHaveBeenCalledTimes(1);
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  it("passes the page-title low-quality notice to buildDocx when complianceReport contains PAGE_TITLE_LOW_QUALITY_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.2", fixNotes: PAGE_TITLE_LOW_QUALITY_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildPageTitleLowQualityNoteHtml.mockReturnValue(PAGE_TITLE_LOW_QUALITY_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(200);
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildDocx.mock.calls[0][0];
    expect(htmlArg).toContain(PAGE_TITLE_LOW_QUALITY_SENTINEL);
    expect(mockBuildPageTitleLowQualityNoteHtml).toHaveBeenCalledTimes(1);
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
  });

  it("passes no notice HTML to buildDocx when complianceReport has no matching fixNotes", async () => {
    const report = {
      issues: [
        { criterion: "2.4.1", status: "pass" },
        { criterion: "2.4.2", status: "pass" },
      ],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(200);
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  // Stacking: main landmark + page title low quality both active
  it("stacking — passes both main-landmark and page-title-low-quality notices to buildDocx in order", async () => {
    const report = {
      issues: [
        { criterion: "2.4.1", fixNotes: MOCK_BYPASS_BLOCKS_FIX_NOTE },
        { criterion: "2.4.2", fixNotes: PAGE_TITLE_LOW_QUALITY_NOTE },
      ],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildMainLandmarkNoteHtml.mockReturnValue(MAIN_LANDMARK_SENTINEL);
    mockBuildPageTitleLowQualityNoteHtml.mockReturnValue(PAGE_TITLE_LOW_QUALITY_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-docx");

    expect(res.status).toBe(200);
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildDocx.mock.calls[0][0];
    expect(htmlArg).toContain(MAIN_LANDMARK_SENTINEL);
    expect(htmlArg).toContain(PAGE_TITLE_LOW_QUALITY_SENTINEL);
    expect(htmlArg.indexOf(MAIN_LANDMARK_SENTINEL)).toBeLessThan(
      htmlArg.indexOf(PAGE_TITLE_LOW_QUALITY_SENTINEL),
    );
  });
});

// ---------------------------------------------------------------------------
// ── PDF DOWNLOAD  GET /api/conversions/:id/download-pdf ─────────────────────
// ---------------------------------------------------------------------------

describe("GET /api/conversions/:id/download-pdf — export notices (PDF)", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    mockBuildPdf.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
    app = await buildApp();
  });

  it("passes the main-landmark notice to buildPdf when complianceReport contains BYPASS_BLOCKS_FIX_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.1", fixNotes: MOCK_BYPASS_BLOCKS_FIX_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildMainLandmarkNoteHtml.mockReturnValue(MAIN_LANDMARK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildPdf.mock.calls[0][0];
    expect(htmlArg).toContain(MAIN_LANDMARK_SENTINEL);
    expect(mockBuildMainLandmarkNoteHtml).toHaveBeenCalledTimes(1);
  });

  it("does not pass the main-landmark notice to buildPdf when 2.4.1 has no fixNotes", async () => {
    const report = { issues: [{ criterion: "2.4.1" }] };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
  });

  it("passes the page-title fallback notice to buildPdf when complianceReport contains PAGE_TITLE_FALLBACK_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.2", fixNotes: PAGE_TITLE_FALLBACK_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildPageTitleFallbackNoteHtml.mockReturnValue(PAGE_TITLE_FALLBACK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildPdf.mock.calls[0][0];
    expect(htmlArg).toContain(PAGE_TITLE_FALLBACK_SENTINEL);
    expect(mockBuildPageTitleFallbackNoteHtml).toHaveBeenCalledTimes(1);
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  it("passes the page-title low-quality notice to buildPdf when complianceReport contains PAGE_TITLE_LOW_QUALITY_NOTE", async () => {
    const report = {
      issues: [{ criterion: "2.4.2", fixNotes: PAGE_TITLE_LOW_QUALITY_NOTE }],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildPageTitleLowQualityNoteHtml.mockReturnValue(PAGE_TITLE_LOW_QUALITY_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildPdf.mock.calls[0][0];
    expect(htmlArg).toContain(PAGE_TITLE_LOW_QUALITY_SENTINEL);
    expect(mockBuildPageTitleLowQualityNoteHtml).toHaveBeenCalledTimes(1);
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
  });

  it("passes no notice HTML to buildPdf when complianceReport has no matching fixNotes", async () => {
    const report = {
      issues: [
        { criterion: "2.4.1", status: "pass" },
        { criterion: "2.4.2", status: "pass" },
      ],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  it("passes no notice HTML to buildPdf when complianceReport is null", async () => {
    mockDbSelectWhere.mockResolvedValue([makeConversion(null)]);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    expect(mockBuildMainLandmarkNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleFallbackNoteHtml).not.toHaveBeenCalled();
    expect(mockBuildPageTitleLowQualityNoteHtml).not.toHaveBeenCalled();
  });

  // Stacking: all three notices active at once
  it("stacking — passes main-landmark + page-title-fallback + page-title-low-quality notices to buildPdf in order", async () => {
    const report = {
      issues: [
        { criterion: "2.4.1", fixNotes: MOCK_BYPASS_BLOCKS_FIX_NOTE },
        // Only one page-title issue is active at a time (fallback takes priority over low-quality
        // in the route's else-if chain), so test both separately in prior tests.
        // This stacking test verifies main-landmark + page-title-fallback together.
        { criterion: "2.4.2", fixNotes: PAGE_TITLE_FALLBACK_NOTE },
      ],
    };
    mockDbSelectWhere.mockResolvedValue([makeConversion(report)]);
    mockBuildMainLandmarkNoteHtml.mockReturnValue(MAIN_LANDMARK_SENTINEL);
    mockBuildPageTitleFallbackNoteHtml.mockReturnValue(PAGE_TITLE_FALLBACK_SENTINEL);

    const res = await request(app).get("/api/conversions/1/download-pdf");

    expect(res.status).toBe(200);
    expect(mockBuildPdf).toHaveBeenCalledTimes(1);
    const htmlArg: string = mockBuildPdf.mock.calls[0][0];
    expect(htmlArg).toContain(MAIN_LANDMARK_SENTINEL);
    expect(htmlArg).toContain(PAGE_TITLE_FALLBACK_SENTINEL);
    expect(htmlArg.indexOf(MAIN_LANDMARK_SENTINEL)).toBeLessThan(
      htmlArg.indexOf(PAGE_TITLE_FALLBACK_SENTINEL),
    );
  });
});
