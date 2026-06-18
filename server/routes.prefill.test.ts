import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetCourse,
  mockGetContentByCourse,
} = vi.hoisted(() => ({
  mockGetCourse: vi.fn(),
  mockGetContentByCourse: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getCourse: mockGetCourse,
    getContentByCourse: mockGetContentByCourse,
    getAllCourses: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    getContent: vi.fn(),
    createContent: vi.fn(),
    updateContent: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    createVersion: vi.fn(),
    getVersionsByContent: vi.fn(),
    getVersionById: vi.fn(),
    pruneOldVersions: vi.fn(),
    getAllSavedContent: vi.fn(),
    getSavedContent: vi.fn(),
    createSavedContent: vi.fn(),
    deleteSavedContent: vi.fn(),
    toggleContentApproval: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth – isBsuAuthenticated passes through with a synthetic user
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-prefill-user" } };
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
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const COURSE_ID = 42;

const mockCourse = {
  id: COURSE_ID,
  userId: "test-prefill-user",
  courseName: "Test Course",
  courseNumber: "TST-101",
};

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    courseId: COURSE_ID,
    userId: "test-prefill-user",
    toolType: "assignment",
    toolName: "Assignment Builder",
    formData: { assignmentType: "Essay", learningObjectives: "Critical thinking" },
    content: "Assignment content",
    isApproved: false,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: GET /api/courses/:id/content — pre-fill route
// ---------------------------------------------------------------------------
describe("GET /api/courses/:id/content — pre-fill query param filtering", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    mockGetCourse.mockResolvedValue(mockCourse);
  });

  // -------------------------------------------------------------------------
  // Happy path: toolType filter returns matching items
  // -------------------------------------------------------------------------
  describe("when the course has a prior Assignment and toolType=assignment is requested", () => {
    it("returns the assignment item so the pre-fill dropdown has content", async () => {
      const assignmentItem = makeContent({ toolType: "assignment" });
      mockGetContentByCourse.mockResolvedValue([assignmentItem]);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].toolType).toBe("assignment");
    });

    it("includes the formData so the frontend can map assignmentType and learningObjectives", async () => {
      const assignmentItem = makeContent({
        formData: { assignmentType: "Essay", learningObjectives: "Demonstrate critical thinking" },
      });
      mockGetContentByCourse.mockResolvedValue([assignmentItem]);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment`)
        .expect(200);

      expect(res.body[0].formData).toMatchObject({
        assignmentType: "Essay",
        learningObjectives: "Demonstrate critical thinking",
      });
    });

    it("returns multiple assignment items when several exist", async () => {
      const items = [
        makeContent({ id: 1, toolType: "assignment", toolName: "Assignment Builder" }),
        makeContent({ id: 2, toolType: "assignment", toolName: "Assignment Builder" }),
      ];
      mockGetContentByCourse.mockResolvedValue(items);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body.every((item: any) => item.toolType === "assignment")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // No compatible items: dropdown must be hidden
  // -------------------------------------------------------------------------
  describe("when the course has only Rubric content and toolType=assignment is requested", () => {
    it("returns an empty array so the frontend hides the pre-fill dropdown", async () => {
      const rubricItem = makeContent({ id: 10, toolType: "rubric", toolName: "Rubric Builder" });
      mockGetContentByCourse.mockResolvedValue([rubricItem]);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it("returns an empty array when the course has no content at all", async () => {
      mockGetContentByCourse.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it("excludes rubric and syllabus items when filtering for assignment", async () => {
      const mixedItems = [
        makeContent({ id: 10, toolType: "rubric" }),
        makeContent({ id: 11, toolType: "syllabus" }),
        makeContent({ id: 12, toolType: "schedule" }),
      ];
      mockGetContentByCourse.mockResolvedValue(mixedItems);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-type filter: comma-separated toolType values
  // -------------------------------------------------------------------------
  describe("when multiple toolTypes are requested (e.g. alignment pre-fill)", () => {
    it("returns all items whose toolType is in the comma-separated list", async () => {
      const items = [
        makeContent({ id: 1, toolType: "assignment" }),
        makeContent({ id: 2, toolType: "rubric" }),
        makeContent({ id: 3, toolType: "syllabus" }),
      ];
      mockGetContentByCourse.mockResolvedValue(items);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment,rubric`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      const toolTypes = res.body.map((item: any) => item.toolType);
      expect(toolTypes).toContain("assignment");
      expect(toolTypes).toContain("rubric");
      expect(toolTypes).not.toContain("syllabus");
    });
  });

  // -------------------------------------------------------------------------
  // No filter: all content returned
  // -------------------------------------------------------------------------
  describe("when no toolType filter is provided", () => {
    it("returns all content for the course regardless of type", async () => {
      const allItems = [
        makeContent({ id: 1, toolType: "assignment" }),
        makeContent({ id: 2, toolType: "rubric" }),
        makeContent({ id: 3, toolType: "syllabus" }),
      ];
      mockGetContentByCourse.mockResolvedValue(allItems);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/content`)
        .expect(200);

      expect(res.body).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Ownership: course not found returns 404
  // -------------------------------------------------------------------------
  describe("ownership enforcement", () => {
    it("returns 404 when the course does not belong to the requesting user", async () => {
      mockGetCourse.mockResolvedValue(null);

      await request(app)
        .get(`/api/courses/${COURSE_ID}/content?toolType=assignment`)
        .expect(404);
    });
  });
});
