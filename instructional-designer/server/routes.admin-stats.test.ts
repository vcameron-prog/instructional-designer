import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { adminUserIdHolder } = vi.hoisted(() => ({
  adminUserIdHolder: { value: "test-admin-366" },
}));

// ---------------------------------------------------------------------------
// Chainable DB mock
//
// Every db.select().<chain...> call is awaitable and returns an empty array.
// This covers all the query patterns used by /api/admin/stats without needing
// per-query configuration.
// ---------------------------------------------------------------------------
function makeChain(result: unknown[] = []): any {
  const chain: any = {
    from:    () => chain,
    where:   () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit:   () => chain,
    then(onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve(result).catch(onRejected);
    },
  };
  return chain;
}

vi.mock("./db", () => ({
  db: {
    select: () => makeChain([]),
  },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
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
// isAuthenticated passes; the user sub is set to adminUserIdHolder.value so
// it can be matched against ADMIN_USER_IDS in the route's checkIsAdmin logic.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: adminUserIdHolder.value, email: "admin@test.invalid" } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: adminUserIdHolder.value, email: "admin@test.invalid" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: adminUserIdHolder.value, email: "admin@test.invalid" } };
    next();
  },
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK – prevents real API calls
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

// ---------------------------------------------------------------------------
// Mock: auxiliary helpers not under test
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead:   (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("GET /api/admin/stats — System Configuration card data", () => {
  let app: express.Express;
  let savedAdminIds: string | undefined;

  beforeEach(async () => {
    savedAdminIds = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = adminUserIdHolder.value;

    app = express();
    app.use(express.json());
    const server = createServer(app);
    const { registerRoutes } = await import("./routes");
    await registerRoutes(server, app);
  });

  afterEach(() => {
    if (savedAdminIds === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = savedAdminIds;
    }
    vi.resetModules();
  });

  it("returns config.versionHistoryLimit as a positive integer — data source for the admin dashboard version history limit card (data-testid='stat-version-history-limit')", async () => {
    const res = await request(app).get("/api/admin/stats");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("config");
    expect(res.body.config).toHaveProperty("versionHistoryLimit");

    const limit: unknown = res.body.config.versionHistoryLimit;
    expect(typeof limit).toBe("number");
    expect(Number.isInteger(limit)).toBe(true);
    expect(limit as number).toBeGreaterThan(0);
  });

  it("returns 403 for a non-admin user — the card is only visible to admins", async () => {
    const originalAdminIds = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = "some-other-id-not-in-mock";
    try {
      const res = await request(app).get("/api/admin/stats");
      expect(res.status).toBe(403);
    } finally {
      process.env.ADMIN_USER_IDS = originalAdminIds;
    }
  });
});
