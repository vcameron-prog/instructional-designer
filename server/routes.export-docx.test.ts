import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetContent, mockGetCourse, mockBuildContentDocx, currentUser } =
  vi.hoisted(() => ({
    mockGetContent: vi.fn(),
    mockGetCourse: vi.fn(),
    mockBuildContentDocx: vi.fn(),
    currentUser: { sub: "user-abc" },
  }));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getContent: mockGetContent,
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
    updateContent: vi.fn(),
    createVersion: vi.fn(),
    pruneOldVersions: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware — injects currentUser.sub so tests can change
// the authenticated user between cases by mutating currentUser.sub.
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
  optionalAuth: (_req: any, _res: any, next: any) => next(),
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
// Mock: db singleton — prevents real PostgreSQL connection
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Mock: content-docx — buildContentDocx returns a dummy buffer
// ---------------------------------------------------------------------------
vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: mockBuildContentDocx,
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
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/content/:id/export-docx — ownership checks", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser.sub = "user-abc";
    app = await buildApp();

    mockBuildContentDocx.mockResolvedValue(Buffer.from("fake-docx"));
  });

  it("returns 200 when the authenticated user owns the content (userId match)", async () => {
    mockGetContent.mockResolvedValue({
      id: 1,
      content: "# Hello",
      toolName: "assignment",
      courseId: null,
      userId: "user-abc",
    });

    await request(app)
      .get("/api/content/1/export-docx")
      .expect(200);

    expect(mockBuildContentDocx).toHaveBeenCalledTimes(1);
  });

  it("returns 200 when the content is course-linked and the user owns the course", async () => {
    mockGetContent.mockResolvedValue({
      id: 2,
      content: "# Hello",
      toolName: "syllabus",
      courseId: 10,
      userId: null,
    });
    mockGetCourse.mockResolvedValue({
      id: 10,
      courseNumber: "ENG101",
      userId: "user-abc",
    });

    await request(app)
      .get("/api/content/2/export-docx")
      .expect(200);

    expect(mockBuildContentDocx).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the content does not exist", async () => {
    mockGetContent.mockResolvedValue(null);

    await request(app)
      .get("/api/content/99/export-docx")
      .expect(404);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });

  it("returns 404 when the content is course-linked but the course belongs to another user", async () => {
    mockGetContent.mockResolvedValue({
      id: 3,
      content: "# Hello",
      toolName: "syllabus",
      courseId: 20,
      userId: null,
    });
    mockGetCourse.mockResolvedValue(null);

    await request(app)
      .get("/api/content/3/export-docx")
      .expect(404);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });

  it("returns 403 when another authenticated user tries to download content they do not own", async () => {
    mockGetContent.mockResolvedValue({
      id: 4,
      content: "# Hello",
      toolName: "rubric",
      courseId: null,
      userId: "user-xyz",
    });

    await request(app)
      .get("/api/content/4/export-docx")
      .expect(403);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous content (userId=null, courseId=null) — the ownership check must not be silently skipped", async () => {
    mockGetContent.mockResolvedValue({
      id: 5,
      content: "# Quick tool result",
      toolName: "assignment",
      courseId: null,
      userId: null,
    });

    await request(app)
      .get("/api/content/5/export-docx")
      .expect(403);

    expect(mockBuildContentDocx).not.toHaveBeenCalled();
  });
});
