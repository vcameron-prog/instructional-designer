import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetAltTextParseFailMetrics, mockGetRateLimitCleanupMetrics } = vi.hoisted(() => ({
  mockGetAltTextParseFailMetrics: vi.fn(),
  mockGetRateLimitCleanupMetrics: vi.fn(),
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
    getSavedOutcomes: vi.fn(),
    createSavedOutcome: vi.fn(),
    updateSavedOutcome: vi.fn(),
    deleteSavedOutcome: vi.fn(),
    getConversionsByUser: vi.fn(),
    getConversionById: vi.fn(),
    createConversion: vi.fn(),
    updateConversion: vi.fn(),
    deleteConversion: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "owner-user-123" } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "owner-user-123" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "owner-user-123" } };
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
// Mock: db singleton
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Mock: auxiliary helpers
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
}));

vi.mock("./lib/altTextMetrics.js", () => ({
  recordAltTextParseFail: vi.fn().mockResolvedValue(undefined),
  getAltTextParseFailMetrics: mockGetAltTextParseFailMetrics,
}));

vi.mock("./lib/rateLimiters.js", () => ({
  checkSharedRateLimit: vi.fn().mockResolvedValue(true),
  checkAiGenRateLimit: vi.fn().mockReturnValue(true),
  AI_GEN_RATE_LIMIT: 20,
  AI_GEN_RATE_WINDOW_MS: 60 * 60 * 1000,
  ANON_RATE_LIMIT: 10,
  ANON_RATE_WINDOW_MS: 60 * 60 * 1000,
  SHARED_ANON_UPLOAD_RATE_LIMIT: 10,
  checkAnonRateLimit: vi.fn().mockReturnValue(true),
  getRateLimitCleanupMetrics: mockGetRateLimitCleanupMetrics,
}));

// ---------------------------------------------------------------------------
// Helper: build a fresh Express app for each test
// ---------------------------------------------------------------------------
async function buildApp() {
  const { registerRoutes } = await import("./routes.js");
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

describe("GET /api/metrics", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetAltTextParseFailMetrics.mockReturnValue({ count: 0, lastAt: null });
    mockGetRateLimitCleanupMetrics.mockReturnValue({
      lastRunAt: null,
      lastErrorAt: null,
      rowsDeletedTotal: 0,
    });
    app = await buildApp();
  });

  it("returns zeroed counters with no auth required when nothing has happened yet", async () => {
    const res = await request(app).get("/api/metrics").expect(200);

    expect(res.body).toEqual({
      altTextParseFail: { count: 0, lastAt: null },
      rateLimitCleanup: {
        lastRunAt: null,
        lastErrorAt: null,
        rowsDeletedTotal: 0,
      },
    });
  });

  it("surfaces non-zero altTextParseFail and rateLimitCleanup counters", async () => {
    mockGetAltTextParseFailMetrics.mockReturnValue({
      count: 3,
      lastAt: "2026-07-01T12:00:00.000Z",
    });
    mockGetRateLimitCleanupMetrics.mockReturnValue({
      lastRunAt: "2026-07-06T09:00:00.000Z",
      lastErrorAt: "2026-07-05T08:00:00.000Z",
      rowsDeletedTotal: 42,
    });

    const res = await request(app).get("/api/metrics").expect(200);

    expect(res.body).toEqual({
      altTextParseFail: { count: 3, lastAt: "2026-07-01T12:00:00.000Z" },
      rateLimitCleanup: {
        lastRunAt: "2026-07-06T09:00:00.000Z",
        lastErrorAt: "2026-07-05T08:00:00.000Z",
        rowsDeletedTotal: 42,
      },
    });
  });
});
