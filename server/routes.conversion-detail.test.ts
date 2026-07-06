/**
 * Tests for GET /api/conversions/:id — verifying that the stored errorMessage
 * is included in the API response body so the frontend can render it.
 *
 * When a Google Doc extraction fails the backend stores a user-friendly
 * errorMessage on the conversion record. This test confirms the GET endpoint
 * returns that field unchanged, which is the contract that
 * client/src/pages/pdf-conversion.tsx relies on to show:
 *
 *   <p data-testid="text-error-message">{conversion.errorMessage || fallback}</p>
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------
const { mockDbSelectWhere, mockDbUpdateSet, mockDbUpdateReturning } = vi.hoisted(
  () => ({
    mockDbSelectWhere: vi.fn(),
    mockDbUpdateSet: vi.fn(),
    mockDbUpdateReturning: vi.fn().mockResolvedValue([{ id: 1 }]),
  }),
);

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

// ---------------------------------------------------------------------------
// Mock: Replit auth — optionalAuth attaches an authenticated user
// ---------------------------------------------------------------------------
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
    updateSavedOutcome: vi.fn(),
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
  vi.resetModules();
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

/** Minimal failed conversion row returned by the DB select mock. */
function makeFailedConversion(sourceType: string, errorMessage: string) {
  return {
    id: 1,
    userId: "test-user-1",
    visitorToken: null,
    originalFilename: `test.${sourceType}`,
    fileSize: null,
    sourceType,
    status: "failed",
    pageCount: null,
    extractedText: null,
    accessibleHtml: null,
    complianceReport: null,
    originalComplianceReport: null,
    statusMessage: null,
    errorMessage,
    ocrApplied: false,
    extractionWarnings: null,
    processingStartedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/conversions/:id — errorMessage is surfaced in the response", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);
    app = await buildApp();
  });

  it("returns the friendly google-doc errorMessage in the response body", async () => {
    const friendlyMsg =
      "This Google Doc could not be extracted. It may be in an unsupported format or corrupted.";
    const conversion = makeFailedConversion("google-doc", friendlyMsg);

    mockDbSelectWhere.mockResolvedValueOnce([conversion]);

    const res = await request(app).get("/api/conversions/1");

    expect(res.status).toBe(200);
    expect(res.body.errorMessage).toBe(friendlyMsg);
    expect(res.body.status).toBe("failed");
    expect(res.body.sourceType).toBe("google-doc");
  });

  it("returns errorMessage: null when the conversion has no error", async () => {
    const conversion = makeFailedConversion("google-doc", null as any);
    conversion.status = "completed";

    mockDbSelectWhere.mockResolvedValueOnce([conversion]);

    const res = await request(app).get("/api/conversions/1");

    expect(res.status).toBe(200);
    expect(res.body.errorMessage).toBeNull();
  });

  it("returns 404 when the conversion does not belong to the requesting user", async () => {
    mockDbSelectWhere.mockResolvedValueOnce([]);

    const res = await request(app).get("/api/conversions/99");

    expect(res.status).toBe(404);
  });
});
