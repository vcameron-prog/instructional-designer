import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetCourse,
  mockCreateContent,
  mockGetContentByCourse,
  mockAnthropicCreate,
} = vi.hoisted(() => ({
  mockGetCourse: vi.fn(),
  mockCreateContent: vi.fn(),
  mockGetContentByCourse: vi.fn(),
  mockAnthropicCreate: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getCourse: mockGetCourse,
    createContent: mockCreateContent,
    getContentByCourse: mockGetContentByCourse,
    getAllCourses: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    getContent: vi.fn(),
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
// Mock: Replit auth — isBsuAuthenticated injects a synthetic user.
// All requests in this suite run as "user-a". Ownership isolation is modelled
// at the storage layer: getCourse(courseId, userId) returns null when the
// course does not belong to the authenticated user, mimicking how the route
// denies access to any user who does not own the resource.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "user-a" } };
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
    messages = { create: mockAnthropicCreate };
  },
}));

// ---------------------------------------------------------------------------
// Mock: db singleton
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Mock: markdownTableConverter — passthrough
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: table-fixers — passthroughs
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
const COURSE_ID = 7;
const USER_A = "user-a";

const mockCourse = {
  id: COURSE_ID,
  userId: USER_A,
  courseName: "Intro to Testing",
  courseNumber: "TST-101",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Batch assignment+rubric generation and course content list", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    // AI calls return minimal valid responses
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Generated text" }],
    });

    // Default: course ownership check succeeds for user-a
    mockGetCourse.mockResolvedValue(mockCourse);
  });

  // -------------------------------------------------------------------------
  // Core requirement: POST then GET — both items appear in the content list
  //
  // This test drives the full round-trip:
  //   1. POST /api/generate-batch-assignment-rubric creates two content records
  //   2. The storage layer is configured to return those same records
  //   3. GET /api/courses/:id/content returns both, with the correct courseId
  //   4. The IDs returned by the POST response match the IDs in the list
  // -------------------------------------------------------------------------
  it("both assignment and rubric appear in GET /api/courses/:id/content after a batch POST", async () => {
    // Storage records the items that createContent creates, so that the
    // subsequent GET can return the very same objects.
    const persisted: any[] = [];
    let nextId = 100;

    mockCreateContent.mockImplementation(async (data: any) => {
      const record = {
        id: ++nextId,
        isApproved: false,
        createdAt: new Date(),
        ...data,
      };
      persisted.push(record);
      return record;
    });

    // Step 1: batch POST
    const postRes = await request(app)
      .post("/api/generate-batch-assignment-rubric")
      .send({
        courseId: COURSE_ID,
        formData: {
          assignmentType: "Essay",
          learningObjectives: "Critical thinking",
        },
        rubricConfig: { totalPoints: "100", levels: "4 levels" },
      })
      .expect(201);

    const { assignmentId, rubricId } = postRes.body;
    expect(assignmentId).toBeDefined();
    expect(rubricId).toBeDefined();

    // Both createContent calls must carry the correct courseId and toolType
    expect(mockCreateContent).toHaveBeenCalledTimes(2);
    expect(mockCreateContent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ courseId: COURSE_ID, toolType: "assignment" })
    );
    expect(mockCreateContent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ courseId: COURSE_ID, toolType: "rubric" })
    );

    // Step 2: configure the content list to return what was just persisted
    mockGetContentByCourse.mockResolvedValue(persisted);

    // Step 3: GET course content list
    const getRes = await request(app)
      .get(`/api/courses/${COURSE_ID}/content`)
      .expect(200);

    // Both items must be present
    expect(getRes.body).toHaveLength(2);

    const toolTypes = getRes.body.map((item: any) => item.toolType);
    expect(toolTypes).toContain("assignment");
    expect(toolTypes).toContain("rubric");

    // Every item must carry the correct courseId
    getRes.body.forEach((item: any) => {
      expect(item.courseId).toBe(COURSE_ID);
    });

    // IDs from the POST response must appear in the list (referential consistency)
    const returnedIds = getRes.body.map((item: any) => item.id);
    expect(returnedIds).toContain(assignmentId);
    expect(returnedIds).toContain(rubricId);
  });

  // -------------------------------------------------------------------------
  // Ownership isolation: another user cannot retrieve the course content list
  //
  // The route calls getCourse(courseId, userId). When the course belongs to
  // user-a and user-b makes the request, getCourse returns null — exactly as
  // the real storage layer would for a non-owner. The route must respond 404
  // without ever calling getContentByCourse, so the generated items are never
  // exposed to the wrong user.
  // -------------------------------------------------------------------------
  it("returns 404 and never fetches content when the requesting user does not own the course", async () => {
    // Simulate user-b (or any non-owner): getCourse finds no matching course
    mockGetCourse.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/courses/${COURSE_ID}/content`)
      .expect(404);

    expect(res.body).toMatchObject({ error: "Course not found" });

    // Content must never be queried when ownership fails
    expect(mockGetContentByCourse).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Batch endpoint rejects an invalid courseId before touching storage or AI
  // -------------------------------------------------------------------------
  it("returns 400 and skips AI and DB calls when courseId is not a valid integer", async () => {
    const res = await request(app)
      .post("/api/generate-batch-assignment-rubric")
      .send({
        courseId: "not-a-number",
        formData: { assignmentType: "Essay" },
      })
      .expect(400);

    expect(res.body).toMatchObject({ error: "Invalid courseId" });
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockCreateContent).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Batch endpoint returns 404 when the course does not belong to the user
  // -------------------------------------------------------------------------
  it("returns 404 and skips AI and DB calls when the course does not belong to the requesting user", async () => {
    mockGetCourse.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/generate-batch-assignment-rubric")
      .send({
        courseId: COURSE_ID,
        formData: { assignmentType: "Essay" },
      })
      .expect(404);

    expect(res.body).toMatchObject({ error: "Course not found" });
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockCreateContent).not.toHaveBeenCalled();
  });
});
