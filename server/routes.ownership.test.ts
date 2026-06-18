import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetContent,
  mockGetCourse,
  mockGetVersionById,
  mockUpdateContent,
  mockCreateVersion,
  mockPruneOldVersions,
  mockAnthropicCreate,
  currentUser,
} = vi.hoisted(() => ({
  mockGetContent: vi.fn(),
  mockGetCourse: vi.fn(),
  mockGetVersionById: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockPruneOldVersions: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  currentUser: { sub: "user-abc" as string | null },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getContent: mockGetContent,
    getCourse: mockGetCourse,
    getVersionById: mockGetVersionById,
    updateContent: mockUpdateContent,
    createVersion: mockCreateVersion,
    pruneOldVersions: mockPruneOldVersions,
    getAllCourses: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    getVersionsByContent: vi.fn(),
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
// Mock: Replit auth middleware
// isBsuAuthenticated always injects currentUser.sub (simulates BSU-authenticated
// user). optionalAuth injects the user when currentUser.sub is non-null,
// simulating an authenticated session; passes through anonymously when null.
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
    if (currentUser.sub !== null) {
      req.user = { claims: { sub: currentUser.sub } };
    }
    next();
  },
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
  },
}));

// ---------------------------------------------------------------------------
// Mock: db singleton
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({ db: {} }));

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
// Tests — ownership checks on content mutation routes
// ---------------------------------------------------------------------------

describe("POST /api/content/:id/refine — ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";
    app = await buildApp();

    mockCreateVersion.mockResolvedValue({ id: 1, generatedContentId: 10 });
    mockPruneOldVersions.mockResolvedValue(undefined);
    mockUpdateContent.mockResolvedValue({ id: 10, content: "refined" });
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "refined content" }],
    });
  });

  it("returns 200 when the authenticated user owns the content (userId match)", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "original",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
    });

    await request(app)
      .post("/api/content/10/refine")
      .send({ refinementRequest: "Make it shorter" })
      .expect(200);
  });

  it("returns 200 when the content is course-linked and the user owns the course", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "original",
      toolName: "syllabus",
      courseId: 5,
      userId: null,
    });
    mockGetCourse.mockResolvedValue({ id: 5, userId: "user-abc" });

    await request(app)
      .post("/api/content/10/refine")
      .send({ refinementRequest: "Expand section 2" })
      .expect(200);
  });

  it("returns 403 for anonymous content (userId=null, courseId=null) — ownership check must not be silently skipped", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "quick tool result",
      toolName: "assignment",
      courseId: null,
      userId: null,
    });

    await request(app)
      .post("/api/content/10/refine")
      .send({ refinementRequest: "Make it shorter" })
      .expect(403);

    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 403 when another authenticated user tries to refine content they do not own", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "original",
      toolName: "rubric",
      courseId: null,
      userId: "user-xyz",
    });

    await request(app)
      .post("/api/content/10/refine")
      .send({ refinementRequest: "Be more strict" })
      .expect(403);

    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 404 when the content does not exist", async () => {
    mockGetContent.mockResolvedValue(null);

    await request(app)
      .post("/api/content/99/refine")
      .send({ refinementRequest: "Whatever" })
      .expect(404);
  });
});

describe("POST /api/content/:id/fix-accessibility — ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";
    app = await buildApp();

    mockCreateVersion.mockResolvedValue({ id: 1, generatedContentId: 10 });
    mockPruneOldVersions.mockResolvedValue(undefined);
    mockUpdateContent.mockResolvedValue({ id: 10, content: "fixed" });
  });

  it("returns 200 when the authenticated user owns the content (userId match)", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
    });

    await request(app)
      .post("/api/content/10/fix-accessibility")
      .send({ fixType: "fix-heading-skip" })
      .expect(200);
  });

  it("returns 403 when an authenticated user tries to fix anonymous content (userId=null, courseId=null)", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
    });

    await request(app)
      .post("/api/content/10/fix-accessibility")
      .send({ fixType: "fix-heading-skip" })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 403 when an authenticated user tries to fix content owned by another user", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "rubric",
      courseId: null,
      userId: "user-xyz",
    });

    await request(app)
      .post("/api/content/10/fix-accessibility")
      .send({ fixType: "fix-heading-skip" })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers trying to fix anonymous content (userId=null, courseId=null) — same as authenticated callers", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
    });

    await request(app)
      .post("/api/content/10/fix-accessibility")
      .send({ fixType: "fix-heading-skip" })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });
});

describe("POST /api/content/:id/restore-version — ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";
    app = await buildApp();

    mockUpdateContent.mockResolvedValue({ id: 10, content: "restored" });
    mockGetVersionById.mockResolvedValue({
      id: 5,
      generatedContentId: 10,
      content: "previous version",
    });
  });

  it("returns 200 when the authenticated user owns the content (userId match)", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
    });

    await request(app)
      .post("/api/content/10/restore-version")
      .send({ versionId: 5 })
      .expect(200);
  });

  it("returns 403 when an authenticated user tries to restore anonymous content (userId=null, courseId=null)", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "assignment",
      courseId: null,
      userId: null,
    });

    await request(app)
      .post("/api/content/10/restore-version")
      .send({ versionId: 5 })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 403 when an authenticated user tries to restore content owned by another user", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "rubric",
      courseId: null,
      userId: "user-xyz",
    });

    await request(app)
      .post("/api/content/10/restore-version")
      .send({ versionId: 5 })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers trying to restore anonymous content (userId=null, courseId=null) — same as authenticated callers", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "assignment",
      courseId: null,
      userId: null,
    });

    await request(app)
      .post("/api/content/10/restore-version")
      .send({ versionId: 5 })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 404 when the version does not exist or belongs to a different content item", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
    });
    mockGetVersionById.mockResolvedValue(null);

    await request(app)
      .post("/api/content/10/restore-version")
      .send({ versionId: 999 })
      .expect(404);
  });
});
