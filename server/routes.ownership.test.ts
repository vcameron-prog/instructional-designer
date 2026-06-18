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
  mockGetVersionsByContent,
  mockUpdateContent,
  mockCreateVersion,
  mockPruneOldVersions,
  mockAnthropicCreate,
  mockDeleteContent,
  currentUser,
} = vi.hoisted(() => ({
  mockGetContent: vi.fn(),
  mockGetCourse: vi.fn(),
  mockGetVersionById: vi.fn(),
  mockGetVersionsByContent: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockPruneOldVersions: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockDeleteContent: vi.fn(),
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
    deleteContent: mockDeleteContent,
    getAllCourses: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    getVersionsByContent: mockGetVersionsByContent,
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
// Helper: build a fresh Express app each test.
// A thin session mock is added so getVisitorToken / ensureVisitorToken can
// read from req.session.  Tests may inject a visitor token via the custom
// x-visitor-token request header.
// ---------------------------------------------------------------------------
async function buildApp() {
  const { registerRoutes } = await import("./routes.js");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = { visitorToken: (req.headers["x-visitor-token"] as string) || null };
    next();
  });
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

  it("returns 403 for anonymous callers trying to fix anonymous content without a visitor token", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/fix-accessibility")
      .send({ fixType: "fix-heading-skip" })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers whose visitor token does not match the stored one", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/fix-accessibility")
      .set("x-visitor-token", "token-intruder")
      .send({ fixType: "fix-heading-skip" })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 200 for the anonymous caller whose visitor token matches the stored one", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });
    mockCreateVersion.mockResolvedValue({ id: 1, generatedContentId: 10 });
    mockPruneOldVersions.mockResolvedValue(undefined);
    mockUpdateContent.mockResolvedValue({ id: 10, content: "# A\n## B\n### C" });

    await request(app)
      .post("/api/content/10/fix-accessibility")
      .set("x-visitor-token", "token-owner")
      .send({ fixType: "fix-heading-skip" })
      .expect(200);
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

  it("returns 403 for anonymous callers trying to restore anonymous content without a visitor token", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/restore-version")
      .send({ versionId: 5 })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers whose visitor token does not match the stored one", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/restore-version")
      .set("x-visitor-token", "token-intruder")
      .send({ versionId: 5 })
      .expect(403);

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("returns 200 for the anonymous caller whose visitor token matches the stored one", async () => {
    currentUser.sub = null;

    mockGetContent.mockResolvedValue({
      id: 10,
      content: "current",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/restore-version")
      .set("x-visitor-token", "token-owner")
      .send({ versionId: 5 })
      .expect(200);
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

describe("POST /api/content/:id/preview-fix — visitor-token ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = null;
    app = await buildApp();
  });

  it("returns 403 for anonymous callers trying to preview anonymous content without a visitor token", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/preview-fix")
      .send({ fixType: "fix-heading-skip" })
      .expect(403);
  });

  it("returns 403 for anonymous callers whose visitor token does not match the stored one", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/preview-fix")
      .set("x-visitor-token", "token-intruder")
      .send({ fixType: "fix-heading-skip" })
      .expect(403);
  });

  it("returns 200 for the anonymous caller whose visitor token matches the stored one", async () => {
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "# A\n### C",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .post("/api/content/10/preview-fix")
      .set("x-visitor-token", "token-owner")
      .send({ fixType: "fix-heading-skip" })
      .expect(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/content/:id — visitor-token ownership checks
// ---------------------------------------------------------------------------

describe("GET /api/content/:id — visitor-token ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns 200 when the authenticated user owns the content (userId match)", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "hello",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
      visitorToken: null,
    });

    await request(app).get("/api/content/10").expect(200);
  });

  it("returns 200 when the content is course-linked and the user owns the course", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "hello",
      toolName: "syllabus",
      courseId: 5,
      userId: null,
      visitorToken: null,
    });
    mockGetCourse.mockResolvedValue({ id: 5, userId: "user-abc" });

    await request(app).get("/api/content/10").expect(200);
  });

  it("returns 403 when an authenticated user reads anonymous content (userId=null, courseId=null)", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app).get("/api/content/10").expect(403);
  });

  it("returns 403 when an authenticated user reads content owned by another user", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "hello",
      toolName: "rubric",
      courseId: null,
      userId: "user-xyz",
      visitorToken: null,
    });

    await request(app).get("/api/content/10").expect(403);
  });

  it("returns 403 for anonymous callers reading anonymous content without a visitor token", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app).get("/api/content/10").expect(403);
  });

  it("returns 403 for anonymous callers whose visitor token does not match the stored one", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .get("/api/content/10")
      .set("x-visitor-token", "token-intruder")
      .expect(403);
  });

  it("returns 200 for the anonymous caller whose visitor token matches the stored one", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .get("/api/content/10")
      .set("x-visitor-token", "token-owner")
      .expect(200);
  });

  it("returns 403 when the course-linked content is requested without authentication", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "course content",
      toolName: "syllabus",
      courseId: 5,
      userId: null,
      visitorToken: null,
    });

    await request(app).get("/api/content/10").expect(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/content/:id — visitor-token ownership checks
// ---------------------------------------------------------------------------

describe("DELETE /api/content/:id — visitor-token ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockDeleteContent.mockResolvedValue(undefined);
    app = await buildApp();
  });

  it("returns 204 when the authenticated user owns the content (userId match)", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "hello",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
      visitorToken: null,
    });

    await request(app).delete("/api/content/10").expect(204);
    expect(mockDeleteContent).toHaveBeenCalledWith(10, "user-abc");
  });

  it("returns 403 when an authenticated user deletes anonymous content (userId=null, courseId=null)", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app).delete("/api/content/10").expect(403);
    expect(mockDeleteContent).not.toHaveBeenCalled();
  });

  it("returns 403 when an authenticated user deletes content owned by another user", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "hello",
      toolName: "rubric",
      courseId: null,
      userId: "user-xyz",
      visitorToken: null,
    });

    await request(app).delete("/api/content/10").expect(403);
    expect(mockDeleteContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers deleting anonymous content without a visitor token", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app).delete("/api/content/10").expect(403);
    expect(mockDeleteContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers whose visitor token does not match the stored one", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .delete("/api/content/10")
      .set("x-visitor-token", "token-intruder")
      .expect(403);
    expect(mockDeleteContent).not.toHaveBeenCalled();
  });

  it("returns 204 for the anonymous caller whose visitor token matches the stored one", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .delete("/api/content/10")
      .set("x-visitor-token", "token-owner")
      .expect(204);
    expect(mockDeleteContent).toHaveBeenCalledWith(10, null, "token-owner");
  });

  it("returns 403 when the course-linked content is deleted without authentication", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "course content",
      toolName: "syllabus",
      courseId: 5,
      userId: null,
      visitorToken: null,
    });

    await request(app).delete("/api/content/10").expect(403);
    expect(mockDeleteContent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/content/:id/versions — visitor-token ownership checks
// ---------------------------------------------------------------------------

describe("GET /api/content/:id/versions — visitor-token ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    app = await buildApp();
    mockGetVersionsByContent.mockResolvedValue([]);
  });

  it("returns 200 for the authenticated user who owns the content", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "hello",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
      visitorToken: null,
    });

    await request(app).get("/api/content/10/versions").expect(200);
  });

  it("returns 403 when an authenticated user reads another user's version history", async () => {
    currentUser.sub = "user-abc";
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "hello",
      toolName: "assignment",
      courseId: null,
      userId: "user-xyz",
      visitorToken: null,
    });

    await request(app).get("/api/content/10/versions").expect(403);
    expect(mockGetVersionsByContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers reading anonymous content without a visitor token", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app).get("/api/content/10/versions").expect(403);
    expect(mockGetVersionsByContent).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous callers whose visitor token does not match", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .get("/api/content/10/versions")
      .set("x-visitor-token", "token-intruder")
      .expect(403);
    expect(mockGetVersionsByContent).not.toHaveBeenCalled();
  });

  it("returns 200 for the anonymous caller whose visitor token matches", async () => {
    currentUser.sub = null;
    mockGetContent.mockResolvedValue({
      id: 10,
      content: "anon result",
      toolName: "assignment",
      courseId: null,
      userId: null,
      visitorToken: "token-owner",
    });

    await request(app)
      .get("/api/content/10/versions")
      .set("x-visitor-token", "token-owner")
      .expect(200);
    expect(mockGetVersionsByContent).toHaveBeenCalledWith(10);
  });
});
