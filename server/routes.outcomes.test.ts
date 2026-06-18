import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockUpdateSavedOutcome, mockDeleteSavedOutcome, authPassesHolder } = vi.hoisted(() => ({
  mockUpdateSavedOutcome: vi.fn(),
  mockDeleteSavedOutcome: vi.fn(),
  authPassesHolder: { value: true },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    updateSavedOutcome: mockUpdateSavedOutcome,
    getSavedOutcomes: vi.fn(),
    createSavedOutcome: vi.fn(),
    deleteSavedOutcome: mockDeleteSavedOutcome,
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
// Mock: Replit auth middleware
//
// isBsuAuthenticated checks authPassesHolder.value so individual tests can
// control whether the request is authenticated.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    if (!authPassesHolder.value) {
      return _res.status(401).json({ message: "Unauthorized" });
    }
    req.user = { claims: { sub: "owner-user-123" } };
    next();
  },
  isBsuAuthenticated: (req: any, res: any, next: any) => {
    if (!authPassesHolder.value) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = { claims: { sub: "owner-user-123" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "owner-user-123" } };
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
// Mock: db singleton
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Mock: auxiliary helpers
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
}));

// ---------------------------------------------------------------------------
// Helper: build a fresh Express app for each test
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
// Test suite
// ---------------------------------------------------------------------------
describe("PATCH /api/outcomes/:id", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    authPassesHolder.value = true;
    app = await buildApp();
  });

  // -------------------------------------------------------------------------
  // 200 — owner updates their own outcome
  // -------------------------------------------------------------------------
  it("returns 200 with the updated outcome when the authenticated owner patches their outcome", async () => {
    const outcomeId = 7;
    const updatedOutcome = {
      id: outcomeId,
      text: "Students will analyze rhetorical strategies in primary texts",
      userId: "owner-user-123",
      createdAt: new Date().toISOString(),
    };
    mockUpdateSavedOutcome.mockResolvedValue(updatedOutcome);

    const res = await request(app)
      .patch(`/api/outcomes/${outcomeId}`)
      .send({ text: "Students will analyze rhetorical strategies in primary texts" })
      .expect(200);

    expect(res.body).toMatchObject({ id: outcomeId, text: updatedOutcome.text });
    expect(mockUpdateSavedOutcome).toHaveBeenCalledTimes(1);
    expect(mockUpdateSavedOutcome).toHaveBeenCalledWith(
      outcomeId,
      "Students will analyze rhetorical strategies in primary texts",
      "owner-user-123",
    );
  });

  it("trims leading/trailing whitespace from the text before persisting", async () => {
    const outcomeId = 8;
    mockUpdateSavedOutcome.mockResolvedValue({
      id: outcomeId,
      text: "Trimmed outcome text",
      userId: "owner-user-123",
      createdAt: new Date().toISOString(),
    });

    await request(app)
      .patch(`/api/outcomes/${outcomeId}`)
      .send({ text: "  Trimmed outcome text  " })
      .expect(200);

    expect(mockUpdateSavedOutcome).toHaveBeenCalledWith(
      outcomeId,
      "Trimmed outcome text",
      "owner-user-123",
    );
  });

  // -------------------------------------------------------------------------
  // 401 — unauthenticated request
  // -------------------------------------------------------------------------
  it("returns 401 when the request has no authenticated session", async () => {
    authPassesHolder.value = false;

    await request(app)
      .patch("/api/outcomes/7")
      .send({ text: "Should be blocked" })
      .expect(401);

    expect(mockUpdateSavedOutcome).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 404 — outcome belongs to a different user (or does not exist)
  // -------------------------------------------------------------------------
  it("returns 404 when storage reports the outcome is not found or not owned by the caller", async () => {
    const outcomeId = 99;
    mockUpdateSavedOutcome.mockRejectedValue(
      new Error("Outcome not found or not owned by user"),
    );

    const res = await request(app)
      .patch(`/api/outcomes/${outcomeId}`)
      .send({ text: "Attempted cross-user edit" })
      .expect(404);

    expect(res.body).toHaveProperty("error");
  });

  // -------------------------------------------------------------------------
  // 400 — invalid / missing inputs
  // -------------------------------------------------------------------------
  it("returns 400 when the text field is missing", async () => {
    const res = await request(app)
      .patch("/api/outcomes/7")
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty("error");
    expect(mockUpdateSavedOutcome).not.toHaveBeenCalled();
  });

  it("returns 400 when the text field is a blank string", async () => {
    const res = await request(app)
      .patch("/api/outcomes/7")
      .send({ text: "   " })
      .expect(400);

    expect(res.body).toHaveProperty("error");
    expect(mockUpdateSavedOutcome).not.toHaveBeenCalled();
  });

  it("returns 400 when the :id param is not a valid integer", async () => {
    const res = await request(app)
      .patch("/api/outcomes/not-a-number")
      .send({ text: "Some outcome" })
      .expect(400);

    expect(res.body).toHaveProperty("error");
    expect(mockUpdateSavedOutcome).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 500 — unexpected storage failure
  // -------------------------------------------------------------------------
  it("returns 500 for an unexpected storage error that is not the ownership error", async () => {
    mockUpdateSavedOutcome.mockRejectedValue(new Error("Database connection lost"));

    const res = await request(app)
      .patch("/api/outcomes/7")
      .send({ text: "Valid text" })
      .expect(500);

    expect(res.body).toHaveProperty("error");
  });
});

describe("DELETE /api/outcomes/:id", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    authPassesHolder.value = true;
    app = await buildApp();
  });

  // -------------------------------------------------------------------------
  // 204 — owner successfully deletes their outcome
  // -------------------------------------------------------------------------
  it("returns 204 when the authenticated owner deletes their outcome", async () => {
    const outcomeId = 7;
    mockDeleteSavedOutcome.mockResolvedValue(1);

    await request(app).delete(`/api/outcomes/${outcomeId}`).expect(204);

    expect(mockDeleteSavedOutcome).toHaveBeenCalledTimes(1);
    expect(mockDeleteSavedOutcome).toHaveBeenCalledWith(outcomeId, "owner-user-123");
  });

  // -------------------------------------------------------------------------
  // 404 — outcome not found or belongs to a different user
  // -------------------------------------------------------------------------
  it("returns 404 when storage reports 0 rows deleted (not found or not owned)", async () => {
    const outcomeId = 99;
    mockDeleteSavedOutcome.mockResolvedValue(0);

    const res = await request(app).delete(`/api/outcomes/${outcomeId}`).expect(404);

    expect(res.body).toHaveProperty("error");
    expect(mockDeleteSavedOutcome).toHaveBeenCalledWith(outcomeId, "owner-user-123");
  });

  // -------------------------------------------------------------------------
  // 401 — unauthenticated request
  // -------------------------------------------------------------------------
  it("returns 401 when the request has no authenticated session", async () => {
    authPassesHolder.value = false;

    await request(app).delete("/api/outcomes/7").expect(401);

    expect(mockDeleteSavedOutcome).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 400 — invalid :id param
  // -------------------------------------------------------------------------
  it("returns 400 when the :id param is not a valid integer", async () => {
    const res = await request(app).delete("/api/outcomes/not-a-number").expect(400);

    expect(res.body).toHaveProperty("error");
    expect(mockDeleteSavedOutcome).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 500 — unexpected storage failure
  // -------------------------------------------------------------------------
  it("returns 500 for an unexpected storage error", async () => {
    mockDeleteSavedOutcome.mockRejectedValue(new Error("Database connection lost"));

    const res = await request(app).delete("/api/outcomes/7").expect(500);

    expect(res.body).toHaveProperty("error");
  });
});
