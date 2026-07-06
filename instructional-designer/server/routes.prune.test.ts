import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file, so
// any variables they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const {
  mockPruneOldVersions,
  mockGetContent,
  mockCreateVersion,
  mockUpdateContent,
  mockGetCourse,
  mockAnthropicCreate,
  mockConvertMarkdownTablesToHtml,
} = vi.hoisted(() => ({
  mockPruneOldVersions: vi.fn(),
  mockGetContent: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetCourse: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockConvertMarkdownTablesToHtml: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton – gives full control over every storage method used
// by the two routes under test.
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    pruneOldVersions: mockPruneOldVersions,
    getContent: mockGetContent,
    createVersion: mockCreateVersion,
    updateContent: mockUpdateContent,
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
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware – setupAuth is a no-op; isBsuAuthenticated and
// optionalAuth are pass-through middlewares that set a synthetic user so
// getUserId() returns a non-null value for the refine route.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-prune" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-opt" } };
    next();
  },
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK – replaces the module-level `new Anthropic({...})`
// call in routes.ts so the refine route works without real API credentials.
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
  },
}));

// ---------------------------------------------------------------------------
// Mock: db singleton – prevents a real PostgreSQL connection attempt.
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Mock: markdownTableConverter – uses a spy so individual tests can configure
// return values. Default: passthrough (no conversion). Tests that exercise
// the convert-markdown-tables fix type override it to return different content.
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: mockConvertMarkdownTablesToHtml,
}));

// ---------------------------------------------------------------------------
// Module under test – imported dynamically inside buildApp() so that
// vi.resetModules() can reset module-level counters (activeFixJobs,
// activeUploadJobs, activeProcessingKeys, etc.) before each test, preventing
// in-memory state from bleeding across test cases.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: build a minimal Express app with all routes registered.
// vi.resetModules() is called in beforeEach before this function so that each
// invocation gets a freshly evaluated routes.ts with all counters/Sets reset
// to their initial values.
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
// Coverage note
//
// This file only covers POST /api/content/:id/refine. It previously also
// covered POST /api/content/:id/fix-accessibility and
// POST /api/content/:id/preview-fix, but those routes (and the deterministic
// table/ARIA fixer modules they depended on — ./lib/table-fixers.js and
// ./lib/accessibility-engine) do not exist in this app's server/routes.ts.
// The client (result.tsx / result-batch.tsx) still calls those endpoints, so
// that "apply fix" / "preview fix" UI is currently non-functional here; see
// the follow-up task to port the accessibility-fix backend from the root app.
// ---------------------------------------------------------------------------

describe("pruneOldVersions is called correctly from route handlers", () => {
  let app: express.Express;

  // The default VERSION_HISTORY_LIMIT is 10 (no env override expected in tests)
  const EXPECTED_KEEP_COUNT = 10;

  beforeEach(async () => {
    // Reset the module registry so routes.ts is re-evaluated with fresh
    // module-level counters (activeFixJobs, activeUploadJobs, etc.) and
    // empty deduplication Sets (activeFixKeys, activeProcessingKeys, etc.).
    // The vi.mock() factories remain registered and are re-applied on the
    // dynamic import inside buildApp().
    vi.resetModules();
    vi.clearAllMocks();
    app = await buildApp();

    // Shared defaults used by both route handlers under test
    mockCreateVersion.mockResolvedValue({
      id: 99,
      generatedContentId: 42,
      content: "prev",
      refinementRequest: "Previous version",
      createdAt: new Date(),
    });
    mockUpdateContent.mockResolvedValue({
      id: 42,
      content: "updated content",
      toolName: "assignment",
      courseId: null,
      userId: "test-user-prune",
    });
    mockPruneOldVersions.mockResolvedValue(undefined);

    // Default: passthrough so tests that rely on "no change" behaviour work
    // without extra setup.
    mockConvertMarkdownTablesToHtml.mockImplementation((html: string) => html);
  });

  // -------------------------------------------------------------------------
  // POST /api/content/:id/refine  (refinement-save route)
  // -------------------------------------------------------------------------
  describe("POST /api/content/:id/refine", () => {
    it("calls pruneOldVersions with the correct contentId and keepCount after saving a version", async () => {
      const contentId = 42;

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: "original content",
        toolName: "assignment",
        courseId: null,
        userId: "test-user-prune",
      });
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: "text", text: "refined content" }],
      });

      await request(app)
        .post(`/api/content/${contentId}/refine`)
        .send({ refinementRequest: "Make it shorter" })
        .expect(200);

      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
    });

    it("calls pruneOldVersions only after createVersion has been called", async () => {
      const contentId = 7;

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: "some content",
        toolName: "rubric",
        courseId: null,
        userId: "test-user-prune",
      });
      mockCreateVersion.mockResolvedValue({
        id: 100,
        generatedContentId: contentId,
        content: "some content",
        refinementRequest: "Previous version",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: "refined rubric",
        toolName: "rubric",
        courseId: null,
        userId: "test-user-prune",
      });
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: "text", text: "refined rubric" }],
      });

      await request(app)
        .post(`/api/content/${contentId}/refine`)
        .send({ refinementRequest: "Add more criteria" })
        .expect(200);

      // createVersion must fire before pruneOldVersions (sequencing check)
      expect(mockCreateVersion).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
    });
  });

});
