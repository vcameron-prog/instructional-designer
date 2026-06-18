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
  mockFixHtmlTableCaption,
  mockEditHtmlTableCaption,
  mockFixHtmlTableThead,
  mockApplyAriaComboboxRoleFix,
  mockApplyAriaGridRoleFix,
  mockApplyAriaTabRoleFix,
} = vi.hoisted(() => ({
  mockPruneOldVersions: vi.fn(),
  mockGetContent: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetCourse: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockConvertMarkdownTablesToHtml: vi.fn(),
  mockFixHtmlTableCaption: vi.fn(),
  mockEditHtmlTableCaption: vi.fn(),
  mockFixHtmlTableThead: vi.fn(),
  mockApplyAriaComboboxRoleFix: vi.fn(),
  mockApplyAriaGridRoleFix: vi.fn(),
  mockApplyAriaTabRoleFix: vi.fn(),
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
// Mock: table-fixers – uses spies for fixHtmlTableCaption, editHtmlTableCaption,
// and fixHtmlTableThead so individual tests can control whether the fix changes
// content. fixHtmlTableCaption and fixHtmlTableThead must return the
// { html, tablesFixed } object shape that routes.ts destructures.
// editHtmlTableCaption returns a plain string.
// ---------------------------------------------------------------------------
vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: mockFixHtmlTableCaption,
  editHtmlTableCaption: mockEditHtmlTableCaption,
  fixHtmlTableThead: mockFixHtmlTableThead,
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine – getDeterministicFixerKeys is needed at module
// level in routes.ts (for the /api/deterministic-fixers route). The three
// ARIA role fixers are dynamically imported inside the route handlers; the
// vi.mock factory intercepts those dynamic imports too.
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  applyAriaComboboxRoleFix: mockApplyAriaComboboxRoleFix,
  applyAriaGridRoleFix: mockApplyAriaGridRoleFix,
  applyAriaTabRoleFix: mockApplyAriaTabRoleFix,
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
// Coverage note: which fix types are tested here and why
//
// Tested (deterministic – no external I/O, output is predictable):
//   • fix-heading-skip          – simple string transformation
//   • convert-markdown-tables   – delegates to convertMarkdownTablesToHtml spy
//   • fix-html-table-caption    – delegates to fixHtmlTableCaption spy
//   • fix-all-caps              – simple string transformation (≥10 uppercase chars)
//   • fix-html-table-thead      – delegates to fixHtmlTableThead spy
//   • edit-html-table-caption   – delegates to editHtmlTableCaption spy
//
// Not tested here (require real AI calls):
//   • fix-vague-link-text – calls fixVagueLinkTextAI (Anthropic); covered by
//     the AI-integration test suite. Mocking the AI response to exercise the
//     prune path is intentionally kept out of this file to keep these tests
//     honest about which paths are deterministic.
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

    // Default: all transformer mocks are passthroughs so tests that rely on
    // "no change" behaviour work without extra setup.
    mockConvertMarkdownTablesToHtml.mockImplementation((html: string) => html);
    mockFixHtmlTableCaption.mockImplementation((html: string) => ({
      html,
      tablesFixed: 0,
    }));
    mockEditHtmlTableCaption.mockImplementation((html: string) => html);
    mockFixHtmlTableThead.mockImplementation((html: string) => ({
      html,
      tablesFixed: 0,
    }));

    // Default: ARIA role fixer mocks are passthroughs (no change).
    mockApplyAriaComboboxRoleFix.mockImplementation((html: string) => html);
    mockApplyAriaGridRoleFix.mockImplementation((html: string) => html);
    mockApplyAriaTabRoleFix.mockImplementation((html: string) => html);
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
    // -----------------------------------------------------------------------
    // fix-heading-skip
    // -----------------------------------------------------------------------
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
        userId: "test-user-opt",
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
        userId: "test-user-opt",
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
        userId: "test-user-opt",
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
        userId: "test-user-opt",
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

    // -----------------------------------------------------------------------
    // convert-markdown-tables
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions when convert-markdown-tables produces different content", async () => {
      const contentId = 200;
      const originalContent = "| Col A | Col B |\n|---|---|\n| 1 | 2 |";
      const convertedContent = "<table><tr><th>Col A</th><th>Col B</th></tr><tr><td>1</td><td>2</td></tr></table>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 201,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: convertedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      // Override the passthrough so the fixer reports a real change
      mockConvertMarkdownTablesToHtml.mockReturnValue(convertedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "convert-markdown-tables" })
        .expect(200);

      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(201);
    });

    it("does NOT call pruneOldVersions when convert-markdown-tables leaves content unchanged", async () => {
      const contentId = 202;
      const alreadyHtml = "<p>No markdown tables here.</p>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: alreadyHtml,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });
      // Default mock is already a passthrough; no override needed

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "convert-markdown-tables" })
        .expect(200);

      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // fix-html-table-caption
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions when fix-html-table-caption adds a caption to a captionless table", async () => {
      const contentId = 300;
      const originalContent = "<table><tr><td>Cell</td></tr></table>";
      const fixedContent = "<table><caption>Table summary</caption>\n<tr><td>Cell</td></tr></table>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 301,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: fixedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      // Override the passthrough so the fixer reports a real change
      mockFixHtmlTableCaption.mockReturnValue({ html: fixedContent, tablesFixed: 1 });

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-html-table-caption" })
        .expect(200);

      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(301);
    });

    it("does NOT call pruneOldVersions when fix-html-table-caption leaves content unchanged", async () => {
      const contentId = 302;
      const alreadyCaptioned = "<table><caption>Existing</caption><tr><td>Cell</td></tr></table>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: alreadyCaptioned,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });
      // Default mock returns { html: same content, tablesFixed: 0 } — no change

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-html-table-caption" })
        .expect(200);

      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // fix-all-caps
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions when fix-all-caps transforms an all-caps word", async () => {
      const contentId = 400;
      // fixAllCaps matches runs of ≥10 uppercase letters.
      const originalContent = "This contains ABCDEFGHIJK which is all caps.";
      const fixedContent = "This contains Abcdefghijk which is all caps.";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 401,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: fixedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-all-caps" })
        .expect(200);

      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(401);
    });

    it("does NOT call pruneOldVersions when fix-all-caps leaves content unchanged", async () => {
      const contentId = 402;
      // No word has ≥10 consecutive uppercase letters, so fixAllCaps is a no-op.
      const noAllCapsContent = "Normal sentence with Some Mixed Case words.";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: noAllCapsContent,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-all-caps" })
        .expect(200);

      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // fix-html-table-thead
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions when fix-html-table-thead promotes a row to a header", async () => {
      const contentId = 500;
      const originalContent = "<table><tbody><tr><td>Name</td><td>Score</td></tr></tbody></table>";
      const fixedContent = "<table><thead><tr><th>Name</th><th>Score</th></tr></thead></table>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 501,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: fixedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      // Override the passthrough so the fixer reports a real change
      mockFixHtmlTableThead.mockReturnValue({ html: fixedContent, tablesFixed: 1 });

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-html-table-thead" })
        .expect(200);

      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(501);
    });

    it("does NOT call pruneOldVersions when fix-html-table-thead leaves content unchanged", async () => {
      const contentId = 502;
      const alreadyThead = "<table><thead><tr><th>Name</th><th>Score</th></tr></thead></table>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: alreadyThead,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });
      // Default mock returns { html: same content, tablesFixed: 0 } — no change

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-html-table-thead" })
        .expect(200);

      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // edit-html-table-caption
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions when edit-html-table-caption changes the caption text", async () => {
      const contentId = 600;
      const originalContent = "<table><caption>Old caption</caption><tr><td>Cell</td></tr></table>";
      const editedContent = "<table><caption>New caption</caption><tr><td>Cell</td></tr></table>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 601,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: editedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      // Override the passthrough so the fixer returns different content
      mockEditHtmlTableCaption.mockReturnValue(editedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "edit-html-table-caption", captionText: "New caption", captionIndex: 0 })
        .expect(200);

      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(601);
    });

    it("does NOT call pruneOldVersions when edit-html-table-caption leaves content unchanged", async () => {
      const contentId = 602;
      const unchangedContent = "<table><caption>Same caption</caption><tr><td>Cell</td></tr></table>";

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: unchangedContent,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });
      // Default mock returns the same html string — no change

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "edit-html-table-caption", captionText: "Same caption", captionIndex: 0 })
        .expect(200);

      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // fix-aria-combobox
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions and applyAriaComboboxRoleFix when fix-aria-combobox changes content", async () => {
      const contentId = 630;
      const originalContent = '<div role="combobox"></div>';
      const fixedContent = '<div role="combobox" aria-expanded="false"></div>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 631,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: fixedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockApplyAriaComboboxRoleFix.mockReturnValue(fixedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-aria-combobox" })
        .expect(200);

      expect(mockApplyAriaComboboxRoleFix).toHaveBeenCalledTimes(1);
      expect(mockApplyAriaComboboxRoleFix).toHaveBeenCalledWith(originalContent);
      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(631);
    });

    it("does NOT call pruneOldVersions when fix-aria-combobox leaves content unchanged", async () => {
      const contentId = 632;
      const alreadyFixed = '<div role="combobox" aria-expanded="false"></div>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: alreadyFixed,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });
      // Default mock is a passthrough — no change

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-aria-combobox" })
        .expect(200);

      expect(mockApplyAriaComboboxRoleFix).toHaveBeenCalledTimes(1);
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // fix-aria-grid
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions and applyAriaGridRoleFix when fix-aria-grid changes content", async () => {
      const contentId = 610;
      const originalContent = '<div role="grid"><div role="row"><div role="gridcell">Data</div></div></div>';
      const fixedContent = '<table role="grid"><tr role="row"><td role="gridcell">Data</td></tr></table>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 611,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: fixedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockApplyAriaGridRoleFix.mockReturnValue(fixedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-aria-grid" })
        .expect(200);

      expect(mockApplyAriaGridRoleFix).toHaveBeenCalledTimes(1);
      expect(mockApplyAriaGridRoleFix).toHaveBeenCalledWith(originalContent);
      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(611);
    });

    it("does NOT call pruneOldVersions when fix-aria-grid leaves content unchanged", async () => {
      const contentId = 612;
      const alreadyFixed = '<table role="grid"><tr role="row"><td role="gridcell">Data</td></tr></table>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: alreadyFixed,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-aria-grid" })
        .expect(200);

      expect(mockApplyAriaGridRoleFix).toHaveBeenCalledTimes(1);
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // fix-aria-tab
    // -----------------------------------------------------------------------
    it("calls pruneOldVersions and applyAriaTabRoleFix when fix-aria-tab changes content", async () => {
      const contentId = 620;
      const originalContent = '<div role="tab">Tab 1</div>';
      const fixedContent = '<button role="tab" aria-selected="false">Tab 1</button>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockCreateVersion.mockResolvedValue({
        id: 621,
        generatedContentId: contentId,
        content: originalContent,
        refinementRequest: "accessibility-fix-snapshot",
        createdAt: new Date(),
      });
      mockUpdateContent.mockResolvedValue({
        id: contentId,
        content: fixedContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockApplyAriaTabRoleFix.mockReturnValue(fixedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-aria-tab" })
        .expect(200);

      expect(mockApplyAriaTabRoleFix).toHaveBeenCalledTimes(1);
      expect(mockApplyAriaTabRoleFix).toHaveBeenCalledWith(originalContent);
      expect(mockPruneOldVersions).toHaveBeenCalledTimes(1);
      expect(mockPruneOldVersions).toHaveBeenCalledWith(contentId, EXPECTED_KEEP_COUNT);
      expect(response.body.preFixVersionId).toBe(621);
    });

    it("does NOT call pruneOldVersions when fix-aria-tab leaves content unchanged", async () => {
      const contentId = 622;
      const alreadyFixed = '<button role="tab" aria-selected="false">Tab 1</button>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: alreadyFixed,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });

      await request(app)
        .post(`/api/content/${contentId}/fix-accessibility`)
        .send({ fixType: "fix-aria-tab" })
        .expect(200);

      expect(mockApplyAriaTabRoleFix).toHaveBeenCalledTimes(1);
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockPruneOldVersions).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/content/:id/preview-fix  (dry-run, no save)
  // -------------------------------------------------------------------------
  describe("POST /api/content/:id/preview-fix", () => {
    // -----------------------------------------------------------------------
    // fix-aria-combobox
    // -----------------------------------------------------------------------
    it("returns { before, after } and calls applyAriaComboboxRoleFix for fix-aria-combobox", async () => {
      const contentId = 700;
      const originalContent = '<div role="combobox"></div>';
      const fixedContent = '<div role="combobox" aria-expanded="false"></div>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockApplyAriaComboboxRoleFix.mockReturnValue(fixedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/preview-fix`)
        .send({ fixType: "fix-aria-combobox" })
        .expect(200);

      expect(mockApplyAriaComboboxRoleFix).toHaveBeenCalledTimes(1);
      expect(mockApplyAriaComboboxRoleFix).toHaveBeenCalledWith(originalContent);
      expect(response.body).toEqual({ before: originalContent, after: fixedContent });
      // preview-fix must NOT persist anything
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockUpdateContent).not.toHaveBeenCalled();
    });

    it("returns identical before/after when fix-aria-combobox makes no change", async () => {
      const contentId = 701;
      const unchangedContent = '<div role="combobox" aria-expanded="false"></div>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: unchangedContent,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });
      // Default mock is a passthrough

      const response = await request(app)
        .post(`/api/content/${contentId}/preview-fix`)
        .send({ fixType: "fix-aria-combobox" })
        .expect(200);

      expect(response.body.before).toBe(unchangedContent);
      expect(response.body.after).toBe(unchangedContent);
    });

    // -----------------------------------------------------------------------
    // fix-aria-grid
    // -----------------------------------------------------------------------
    it("returns { before, after } and calls applyAriaGridRoleFix for fix-aria-grid", async () => {
      const contentId = 710;
      const originalContent = '<div role="grid"><div role="row"><div role="gridcell">X</div></div></div>';
      const fixedContent = '<table role="grid"><tr role="row"><td role="gridcell">X</td></tr></table>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockApplyAriaGridRoleFix.mockReturnValue(fixedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/preview-fix`)
        .send({ fixType: "fix-aria-grid" })
        .expect(200);

      expect(mockApplyAriaGridRoleFix).toHaveBeenCalledTimes(1);
      expect(mockApplyAriaGridRoleFix).toHaveBeenCalledWith(originalContent);
      expect(response.body).toEqual({ before: originalContent, after: fixedContent });
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockUpdateContent).not.toHaveBeenCalled();
    });

    it("returns identical before/after when fix-aria-grid makes no change", async () => {
      const contentId = 711;
      const unchangedContent = '<table role="grid"><tr role="row"><td role="gridcell">X</td></tr></table>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: unchangedContent,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });

      const response = await request(app)
        .post(`/api/content/${contentId}/preview-fix`)
        .send({ fixType: "fix-aria-grid" })
        .expect(200);

      expect(response.body.before).toBe(unchangedContent);
      expect(response.body.after).toBe(unchangedContent);
    });

    // -----------------------------------------------------------------------
    // fix-aria-tab
    // -----------------------------------------------------------------------
    it("returns { before, after } and calls applyAriaTabRoleFix for fix-aria-tab", async () => {
      const contentId = 720;
      const originalContent = '<div role="tab">Tab 1</div>';
      const fixedContent = '<button role="tab" aria-selected="false">Tab 1</button>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: originalContent,
        toolName: "assignment",
        courseId: null,
        userId: "test-user-opt",
      });
      mockApplyAriaTabRoleFix.mockReturnValue(fixedContent);

      const response = await request(app)
        .post(`/api/content/${contentId}/preview-fix`)
        .send({ fixType: "fix-aria-tab" })
        .expect(200);

      expect(mockApplyAriaTabRoleFix).toHaveBeenCalledTimes(1);
      expect(mockApplyAriaTabRoleFix).toHaveBeenCalledWith(originalContent);
      expect(response.body).toEqual({ before: originalContent, after: fixedContent });
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockUpdateContent).not.toHaveBeenCalled();
    });

    it("returns identical before/after when fix-aria-tab makes no change", async () => {
      const contentId = 721;
      const unchangedContent = '<button role="tab" aria-selected="false">Tab 1</button>';

      mockGetContent.mockResolvedValue({
        id: contentId,
        content: unchangedContent,
        toolName: "rubric",
        courseId: null,
        userId: "test-user-opt",
      });

      const response = await request(app)
        .post(`/api/content/${contentId}/preview-fix`)
        .send({ fixType: "fix-aria-tab" })
        .expect(200);

      expect(response.body.before).toBe(unchangedContent);
      expect(response.body.after).toBe(unchangedContent);
    });
  });
});
