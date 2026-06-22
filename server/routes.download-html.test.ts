import { describe, it, expect, vi, beforeEach } from "vitest";
import { INVALID_ID_ERROR } from "./routes";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockDbSelectWhere } = vi.hoisted(() => ({
  mockDbSelectWhere: vi.fn(),
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
  buildDocx: vi.fn(),
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
// Tests: invalid-ID guard for GET /api/conversions/:id/download (HTML)
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download — invalid ID guard", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns 400 for a non-numeric conversion ID without touching the database", async () => {
    const res = await request(app).get("/api/conversions/abc/download");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(INVALID_ID_ERROR);
    expect(mockDbSelectWhere).not.toHaveBeenCalled();
  });
});
