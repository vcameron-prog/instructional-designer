/**
 * Tests for PATCH /api/content/:id/approval — ownership checks.
 *
 * The route applies ownership checks in this order:
 *  1. If content.userId is set, the requesting user must match it.
 *  2. If content.courseId is set (and userId is null), the requesting user
 *     must own the linked course (getCourseByOwner returns a row).
 *  3. Anything else → 404.
 *
 * This file covers the course-ownership cases that were absent from the
 * test suite: mismatch (→ 404) and match (→ 200).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------
const { mockDbSelectWhere, mockDbUpdateReturning } = vi.hoisted(() => ({
  mockDbSelectWhere: vi.fn(),
  mockDbUpdateReturning: vi.fn().mockResolvedValue([{ id: 1 }]),
}));

// ---------------------------------------------------------------------------
// Mock: db
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: (_fields?: any) => ({
      from: (_table: any) => ({
        where: mockDbSelectWhere,
      }),
    }),
    update: (_table: any) => ({
      set: (_data: any) => ({
        where: (_cond: any) => {
          const p: any = Promise.resolve(undefined);
          p.returning = mockDbUpdateReturning;
          return p;
        },
      }),
    }),
    delete: (_table: any) => ({
      where: () => Promise.resolve(undefined),
    }),
    insert: (_table: any) => ({
      values: () => Promise.resolve(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Hoisted mock handles for storage
// ---------------------------------------------------------------------------
const {
  mockGetGeneratedContent,
  mockGetCourseByOwner,
  mockToggleContentApproval,
} = vi.hoisted(() => ({
  mockGetGeneratedContent: vi.fn(),
  mockGetCourseByOwner: vi.fn(),
  mockToggleContentApproval: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getManualFixItems: vi.fn(),
    setManualFixItems: vi.fn(),
    logAiFixRetryEvent: vi.fn(),
    getAiFixRetryStats: vi.fn().mockResolvedValue({ lifetimeCount: 0, thisMonthCount: 0 }),
    getGeneratedContent: mockGetGeneratedContent,
    getCourseByOwner: mockGetCourseByOwner,
    toggleContentApproval: mockToggleContentApproval,
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
// Mock: Replit auth — isBsuAuthenticated attaches an authenticated user
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "requesting-user" } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "requesting-user" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "requesting-user" } };
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
// Mock: rateLimiters
// ---------------------------------------------------------------------------
vi.mock("./lib/rateLimiters.js", () => ({
  checkSharedRateLimit: vi.fn().mockResolvedValue(true),
  checkAnonRateLimit: vi.fn().mockReturnValue(true),
  checkHeavyOpRateLimit: vi.fn().mockReturnValue(true),
  checkAiGenRateLimit: vi.fn().mockReturnValue(true),
  checkUploadRateLimit: vi.fn().mockReturnValue(true),
  getRateLimitCleanupMetrics: vi.fn().mockReturnValue({}),
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
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("PATCH /api/content/:id/approval — course ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbSelectWhere.mockResolvedValue([]);
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);
    app = await buildApp();
  });

  it("returns 404 when the requesting user does not own the linked course", async () => {
    // Content is course-linked (no direct userId)
    mockGetGeneratedContent.mockResolvedValueOnce({
      id: 42,
      userId: null,
      courseId: 7,
    });
    // getCourseByOwner returns null → requesting user does not own course 7
    mockGetCourseByOwner.mockResolvedValueOnce(null);

    const res = await request(app).patch("/api/content/42/approval");

    expect(res.status).toBe(404);
    expect(mockGetCourseByOwner).toHaveBeenCalledWith(7, "requesting-user");
    expect(mockToggleContentApproval).not.toHaveBeenCalled();
  });

  it("returns 200 and toggles approval when the requesting user owns the linked course", async () => {
    // Content is course-linked (no direct userId)
    mockGetGeneratedContent.mockResolvedValueOnce({
      id: 42,
      userId: null,
      courseId: 7,
    });
    // getCourseByOwner returns a row → requesting user owns course 7
    mockGetCourseByOwner.mockResolvedValueOnce({ id: 7 });
    // toggleContentApproval returns the updated approval state
    mockToggleContentApproval.mockResolvedValueOnce({ id: 42, isApproved: true });

    const res = await request(app).patch("/api/content/42/approval");

    expect(res.status).toBe(200);
    expect(mockGetCourseByOwner).toHaveBeenCalledWith(7, "requesting-user");
    expect(mockToggleContentApproval).toHaveBeenCalledWith(42);
    expect(res.body).toMatchObject({ id: 42, isApproved: true });
  });
});
