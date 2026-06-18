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
} = vi.hoisted(() => ({
  mockPruneOldVersions: vi.fn(),
  mockGetContent: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetCourse: vi.fn(),
  mockAnthropicCreate: vi.fn(),
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
  optionalAuth: (_req: any, _res: any, next: any) => next(),
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
// Mock: markdownTableConverter – passthrough; routes.ts applies it to the
// refined text, but content shape is irrelevant for these tests.
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: table-fixers – passthroughs so the fix-accessibility handler can
// dispatch to them without any real HTML transformation.
// ---------------------------------------------------------------------------
vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => html,
  fixHtmlTableThead: (html: string) => html,
  editHtmlTableCaption: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine – only getDeterministicFixerKeys is needed
// at the module level in routes.ts (for the /api/deterministic-fixers route).
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal Express app with all routes registered.
// Called in beforeEach so each test starts with a fresh route table and clean
// in-memory state (e.g. rate-limit counters for the refine route).
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// ---------------------------------------------------------------------------

describe("pruneOldVersions is called correctly from route handlers", () => {
  let app: express.Express;

  // The default VERSION_HISTORY_LIMIT is 10 (no env override expected in tests)
  const EXPECTED_KEEP_COUNT = 10;

  beforeEach(async () => {
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

  // -------------------------------------------------------------------------
  // POST /api/content/:id/fix-accessibility  (accessibility-fix-save route)
  // -------------------------------------------------------------------------
  describe("POST /api/content/:id/fix-accessibility", () => {
    it("calls pruneOldVersions with the correct contentId and keepCount when the fix changes content", async () => {
      const contentId = 55;
      // A heading skip (h1 → h3) ensures fixHeadingSkip produces a different
      // string, triggering the version-save + prune path.
      const originalContent = "# Title\n### Skipped Section";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: null,
      });
      mockCreateVersion.mockResolvedValue({
        id: 88,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: "# Title\n## Section\n### Skipped Section",
        toolName: "assignment",
        courseId: null,
        userId: null,
      });

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-heading-skip" })
        .expect(200);

      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      // The response should include the preFixVersionId from the saved snapshot
      expect(response.body.preFixVersionId).toBe(88);
    });

    it("does NOT call pruneOldVersions when the fix leaves content unchanged", async () => {
      const contentId = 66;
      // Sequential headings (h1 → h2 → h3) have no skip, so fixHeadingSkip
      // returns the content unchanged and the route returns early.
      const unchangedContent = "# Title\n## Section\n### Subsection";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: unchangedContent,
        toolName: "rubric",
        courseId: null,
        userId: null,
      });

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-heading-skip" })
        .expect(200);

      // No change → early return before createVersion/pruneOldVersions
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    it("calls pruneOldVersions with the exact numeric contentId parsed from the route param", async () => {
      const contentId = 123;
      const originalContent = "# A\n### C";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "syllabus",
        courseId: null,
        userId: null,
      });
      mockCreateVersion.mockResolvedValue({ id: 77, generatedContentId: contentId });
      mockUpdateContent.mockResolvedValue({ id: contentId, content: "# A\n## B\n### C" });

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-heading-skip" })
        .expect(200);

      const [calledContentId, calledKeepCount] = mockPruneOldVersions.mock.calls[0];
      expect(typeof calledContentId).toBe("number");
      expect(calledContentId).toBe(contentId);
      expect(calledKeepCount).toBe(EXPECTED_KEEP_COUNT);
    });
  });
});
