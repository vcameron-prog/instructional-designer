/**
 * Tests for GET/PUT /api/conversions/:id/manual-fixes — criterion round-trip.
 *
 * The `criterion` field on a manual fix item links the issue to a specific
 * WCAG success criterion (e.g. "1.1.1").  These tests prove that:
 *
 *   1. PUT preserves the criterion field when storing items.
 *   2. GET returns the criterion field that was previously stored.
 *   3. Items without a criterion are handled correctly (no spurious field).
 *
 * This guards against silent regressions where a future refactor drops the
 * field and the WCAG link disappears from the UI after a page reload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------
const { mockDbSelectWhere, mockGetManualFixItems, mockSetManualFixItems } =
  vi.hoisted(() => ({
    mockDbSelectWhere: vi.fn(),
    mockGetManualFixItems: vi.fn(),
    mockSetManualFixItems: vi.fn(),
  }));

// ---------------------------------------------------------------------------
// Mock: db — ownership check uses db.select().from().where()
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: (_fields?: any) => ({
      from: (_table: any) => ({
        where: mockDbSelectWhere,
      }),
    }),
    update: (_table: any) => ({
      set: (_data: any) => ({
        where: (_cond: any) => {
          const p: any = Promise.resolve(undefined);
          p.returning = vi.fn().mockResolvedValue([{ id: 1 }]);
          return p;
        },
      }),
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
// Mock: storage — only the manual fix methods matter for these tests
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getManualFixItems: mockGetManualFixItems,
    setManualFixItems: mockSetManualFixItems,
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
    logAiFixRetryEvent: vi.fn(),
    getAiFixRetryStats: vi.fn(),
    getGeneratedContent: vi.fn(),
    getCourseByOwner: vi.fn(),
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
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

/** Simulates the ownership-check row returned by the DB select mock. */
const OWNED_ROW = [{ id: 1 }];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT /api/conversions/:id/manual-fixes — criterion round-trip", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSetManualFixItems.mockResolvedValue(undefined);
    app = await buildApp();
  });

  it("passes criterion through to setManualFixItems when provided", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);

    const items = [
      {
        title: "Missing image alt text",
        reason: "Image has no alternative text.",
        criterion: "1.1.1",
      },
    ];

    const res = await request(app)
      .put("/api/conversions/1/manual-fixes")
      .send({ items });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(mockSetManualFixItems).toHaveBeenCalledOnce();
    const saved = mockSetManualFixItems.mock.calls[0][1] as any[];
    expect(saved).toHaveLength(1);
    expect(saved[0].criterion).toBe("1.1.1");
    expect(saved[0].title).toBe("Missing image alt text");
    expect(saved[0].reason).toBe("Image has no alternative text.");
  });

  it("saves multiple items each with their own criterion", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);

    const items = [
      { title: "Missing alt text", reason: "Image has no alt.", criterion: "1.1.1" },
      { title: "Low contrast text", reason: "Text contrast ratio is 2.5:1.", criterion: "1.4.3" },
      { title: "Missing page title", reason: "Page has no <title> element.", criterion: "2.4.2" },
    ];

    await request(app)
      .put("/api/conversions/1/manual-fixes")
      .send({ items });

    const saved = mockSetManualFixItems.mock.calls[0][1] as any[];
    expect(saved).toHaveLength(3);
    expect(saved[0].criterion).toBe("1.1.1");
    expect(saved[1].criterion).toBe("1.4.3");
    expect(saved[2].criterion).toBe("2.4.2");
  });

  it("omits criterion from the saved object when not provided", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);

    const items = [
      { title: "Complex table", reason: "Table needs manual header associations." },
    ];

    await request(app)
      .put("/api/conversions/1/manual-fixes")
      .send({ items });

    const saved = mockSetManualFixItems.mock.calls[0][1] as any[];
    expect(saved).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(saved[0], "criterion")).toBe(false);
  });

  it("returns 404 when the conversion does not belong to the requesting user", async () => {
    mockDbSelectWhere.mockResolvedValue([]);

    const res = await request(app)
      .put("/api/conversions/99/manual-fixes")
      .send({ items: [{ title: "T", reason: "R", criterion: "1.1.1" }] });

    expect(res.status).toBe(404);
    expect(mockSetManualFixItems).not.toHaveBeenCalled();
  });
});

describe("GET /api/conversions/:id/manual-fixes — criterion round-trip", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns criterion in the response when the stored item has one", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);
    mockGetManualFixItems.mockResolvedValue([
      {
        title: "Missing image alt text",
        reason: "Image has no alternative text.",
        criterion: "1.1.1",
      },
    ]);

    const res = await request(app).get("/api/conversions/1/manual-fixes");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].criterion).toBe("1.1.1");
    expect(res.body.items[0].title).toBe("Missing image alt text");
  });

  it("returns all criteria when multiple items are stored", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);
    mockGetManualFixItems.mockResolvedValue([
      { title: "Alt text", reason: "Missing alt.", criterion: "1.1.1" },
      { title: "Contrast", reason: "Low contrast.", criterion: "1.4.3" },
      { title: "Title", reason: "No page title.", criterion: "2.4.2" },
    ]);

    const res = await request(app).get("/api/conversions/1/manual-fixes");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0].criterion).toBe("1.1.1");
    expect(res.body.items[1].criterion).toBe("1.4.3");
    expect(res.body.items[2].criterion).toBe("2.4.2");
  });

  it("returns items without criterion when the stored item has none", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);
    mockGetManualFixItems.mockResolvedValue([
      { title: "Complex table", reason: "Table needs manual header associations." },
    ]);

    const res = await request(app).get("/api/conversions/1/manual-fixes");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].criterion).toBeUndefined();
  });

  it("returns an empty array when there are no manual fix items", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);
    mockGetManualFixItems.mockResolvedValue(null);

    const res = await request(app).get("/api/conversions/1/manual-fixes");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("returns 404 when the conversion does not belong to the requesting user", async () => {
    mockDbSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/conversions/99/manual-fixes");

    expect(res.status).toBe(404);
    expect(mockGetManualFixItems).not.toHaveBeenCalled();
  });
});

describe("criterion end-to-end: PUT then GET returns same criterion", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("criterion stored via PUT is returned by a subsequent GET", async () => {
    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);

    const itemsToStore = [
      { title: "Alt text missing", reason: "Needs description.", criterion: "1.1.1" },
      { title: "No page title", reason: "Title element absent.", criterion: "2.4.2" },
    ];

    mockSetManualFixItems.mockImplementation(async (_id: number, items: any[]) => {
      mockGetManualFixItems.mockResolvedValue(items);
    });

    const putRes = await request(app)
      .put("/api/conversions/1/manual-fixes")
      .send({ items: itemsToStore });

    expect(putRes.status).toBe(200);

    mockDbSelectWhere.mockResolvedValue(OWNED_ROW);

    const getRes = await request(app).get("/api/conversions/1/manual-fixes");

    expect(getRes.status).toBe(200);
    expect(getRes.body.items).toHaveLength(2);
    expect(getRes.body.items[0].criterion).toBe("1.1.1");
    expect(getRes.body.items[1].criterion).toBe("2.4.2");
    expect(getRes.body.items[0].title).toBe("Alt text missing");
    expect(getRes.body.items[1].title).toBe("No page title");
  });
});
