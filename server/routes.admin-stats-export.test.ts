/**
 * Tests for GET /api/admin/stats/export — export audit log accuracy.
 *
 * The handler registers a `res.once("finish", ...)` listener that writes one
 * row to `adminExports` only after the response is fully flushed.  These tests
 * verify:
 *
 *  1. Happy path  — a successful export causes exactly one insert into
 *     `adminExports` with the correct userId and rowCounts snapshot.
 *  2. Error path  — when the handler throws before the `finish` listener is
 *     registered (e.g. the first DB query fails), no audit row is written even
 *     though the error response still fires the `finish` event.
 *  3. isAdmin guard — a request that fails the admin check is rejected with
 *     403 and no audit row is written.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories run before imports, so all references
// they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const { mockInsertValues } = vi.hoisted(() => ({
  mockInsertValues: vi.fn().mockReturnValue({ catch: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Mock: db module
//
// makeSelectBuilder returns a thenable fluent query-builder whose terminal
// result is `resolvedValue`.  Every chain method (from, where, groupBy,
// orderBy, limit) returns the same builder so any Drizzle-style chain works.
// ---------------------------------------------------------------------------
vi.mock("./db", () => {
  function makeSelectBuilder(resolvedValue: any[]) {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then: (resolve: (v: any) => any, reject: (e: any) => any) =>
        Promise.resolve(resolvedValue).then(resolve, reject),
      catch: (fn: (e: any) => any) => Promise.resolve(resolvedValue).catch(fn),
    };
    return builder;
  }

  return {
    db: {
      // select() is the primary entry point; tests can set
      // globalThis.__forceSelectThrow to simulate a DB failure before
      // res.once("finish") is registered.
      select: (..._args: any[]) => {
        if ((globalThis as any).__forceSelectThrow) {
          throw new Error("Simulated DB failure");
        }
        // Return [] for all queries; the handler safely falls back to 0 for
        // missing count rows and skips the userInfoMap fetch when empty.
        return makeSelectBuilder([]);
      },
      insert: (_table: any) => ({ values: mockInsertValues }),
      update: (_table: any) => ({
        set: (_data: any) => ({
          where: (_cond: any) => ({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      delete: (_table: any) => ({ where: () => Promise.resolve(undefined) }),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware
//
// isAuthenticated injects an admin user so isAdmin (which reads
// process.env.ADMIN_USER_IDS and compares against claims.sub) also passes.
// ---------------------------------------------------------------------------
const ADMIN_USER_ID = "admin-test-user-001";

vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: ADMIN_USER_ID, email: "admin@example.com" } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: ADMIN_USER_ID, email: "admin@example.com" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: ADMIN_USER_ID, email: "admin@example.com" } };
    req.session = req.session ?? {};
    next();
  },
  getSession: vi.fn(),
  getSessionSaveFailMetrics: vi.fn().mockResolvedValue({ count: 0, lastAt: null, lifetimeCount: 0, thisMonthCount: 0 }),
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton — minimal surface needed for route registration
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getManualFixItems: vi.fn(),
    setManualFixItems: vi.fn(),
    logAiFixRetryEvent: vi.fn(),
    getAiFixRetryStats: vi.fn().mockResolvedValue({ lifetimeCount: 0, thisMonthCount: 0 }),
    getGeneratedContent: vi.fn(),
    getCourseByOwner: vi.fn(),
    toggleContentApproval: vi.fn(),
    getContent: vi.fn(),
    getCourse: vi.fn(),
    getAllCourses: vi.fn(),
    createContent: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    updateContent: vi.fn(),
    createVersion: vi.fn(),
    pruneOldVersions: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    getVersionsByContent: vi.fn(),
    getVersionById: vi.fn(),
    getAllSavedContent: vi.fn(),
    getSavedContent: vi.fn(),
    createSavedContent: vi.fn(),
    deleteSavedContent: vi.fn(),
  },
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
// Mock: accessibility-engine
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  getAiFixRetryMetrics: vi.fn().mockResolvedValue({ retryCount: 0, lastRetryAt: null }),
  getPersistAiFixRetryLastFailed: vi.fn().mockReturnValue(false),
  fixComplianceIssue: vi.fn(),
  fixAllAriaRoleMisuse: vi.fn(),
  applyAriaComboboxRoleFix: (html: string) => html,
  applyAriaGridRoleFix: (html: string) => html,
  applyAriaTabRoleFix: (html: string) => html,
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
  getRateLimitCleanupMetrics: vi.fn().mockReturnValue({
    lastRunAt: null,
    lastErrorAt: null,
    rowsDeletedTotal: 0,
  }),
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
// Mock: misc modules required at routes.ts load time
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: vi.fn(),
}));

vi.mock("./lib/docx-builder", () => ({
  buildDocx: vi.fn(),
}));

vi.mock("connect-pg-simple", () => ({
  default: () => class MockPgStore {},
}));

vi.mock("express-session", () => ({
  default: vi.fn(() => vi.fn()),
}));

vi.mock("passport", () => ({
  default: {
    initialize: vi.fn(() => vi.fn()),
    session: vi.fn(() => vi.fn()),
    use: vi.fn(),
    serializeUser: vi.fn(),
    deserializeUser: vi.fn(),
    authenticate: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER all vi.mock() calls
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Helper: build a fresh Express app with routes registered
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/stats/export — audit log accuracy", () => {
  let app: express.Express;
  const originalAdminIds = process.env.ADMIN_USER_IDS;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInsertValues.mockReturnValue({ catch: vi.fn() });
    delete (globalThis as any).__forceSelectThrow;

    // Ensure isAdmin passes for ADMIN_USER_ID
    process.env.ADMIN_USER_IDS = ADMIN_USER_ID;

    app = await buildApp();
  });

  afterEach(() => {
    if (originalAdminIds === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = originalAdminIds;
    }
    delete (globalThis as any).__forceSelectThrow;
  });

  // ─── Happy path ────────────────────────────────────────────────────────────

  it("inserts exactly one audit row after a successful export response", async () => {
    const response = await request(app)
      .get("/api/admin/stats/export")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/csv/);

    // The finish event fires before supertest resolves; the .values() call
    // is synchronous within the finish handler (mock returns plain object).
    expect(mockInsertValues).toHaveBeenCalledOnce();
  });

  it("inserts the audit row with the requesting admin's userId", async () => {
    await request(app).get("/api/admin/stats/export").expect(200);

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ADMIN_USER_ID }),
    );
  });

  it("inserts the audit row with a rowCounts snapshot containing the four expected keys", async () => {
    await request(app).get("/api/admin/stats/export").expect(200);

    const [arg] = mockInsertValues.mock.calls[0];
    expect(arg).toMatchObject({
      rowCounts: expect.objectContaining({
        courses: expect.any(Number),
        content: expect.any(Number),
        conversions: expect.any(Number),
        users: expect.any(Number),
      }),
    });
  });

  it("returns a CSV body that contains the section headers", async () => {
    const response = await request(app)
      .get("/api/admin/stats/export")
      .expect(200);

    expect(response.text).toContain("Section,Metric,Value");
    expect(response.text).toContain("Month,Courses,Content Generated,Conversions");
  });

  // ─── Error path ────────────────────────────────────────────────────────────

  it("does NOT insert any audit row when the first DB query throws before finish is registered", async () => {
    // Make the very first db.select() call throw so the handler reaches the
    // catch block before res.once("finish", ...) is registered.
    (globalThis as any).__forceSelectThrow = true;

    const response = await request(app)
      .get("/api/admin/stats/export")
      .expect(500);

    expect(response.body).toMatchObject({ error: "Failed to export admin stats" });

    // Even though res.status(500).json() also fires the finish event, the
    // listener was never registered, so no insert should have happened.
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("returns a 500 JSON error when the DB query fails", async () => {
    (globalThis as any).__forceSelectThrow = true;

    const response = await request(app)
      .get("/api/admin/stats/export")
      .expect(500);

    expect(response.body).toHaveProperty("error");
  });

  // ─── Dropped-connection path ──────────────────────────────────────────────

  it("does NOT insert any audit row when close fires without finish (dropped TCP connection mid-stream)", async () => {
    // Build a fresh app with an intercepting middleware inserted before the
    // route.  The middleware overrides res.once so the "finish" listener is
    // captured but never forwarded to the real EventEmitter — this simulates
    // a TCP drop after the response headers have been sent but before the body
    // is fully flushed (Node emits "close", not "finish", in that case).
    const closedApp = express();
    closedApp.use(express.json());

    let capturedFinishListener: ((...args: any[]) => void) | null = null;

    closedApp.use((_req: any, res: any, next: () => void) => {
      const originalOnce = res.once.bind(res) as typeof res.once;
      res.once = (event: string, listener: (...args: any[]) => void) => {
        if (event === "finish") {
          // Capture the listener but do NOT register it — finish will never fire.
          capturedFinishListener = listener;
          return res;
        }
        return originalOnce(event, listener);
      };
      next();
    });

    const httpServer = createServer(closedApp);
    await registerRoutes(httpServer, closedApp);

    // The handler still returns a 200 CSV response (headers are sent), but the
    // finish listener was silently dropped — as would happen if the socket closed
    // before the write buffer was flushed.
    await request(closedApp).get("/api/admin/stats/export").expect(200);

    // Sanity-check: the handler did try to register a finish listener.
    expect(capturedFinishListener).not.toBeNull();

    // The close event alone must NOT trigger the audit insert.
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  // ─── 403 guard — isAdmin middleware ───────────────────────────────────────

  it("returns 403 when ADMIN_USER_IDS is not set (non-admin request)", async () => {
    delete process.env.ADMIN_USER_IDS;

    const nonAdminApp = await buildApp();
    await request(nonAdminApp)
      .get("/api/admin/stats/export")
      .expect(403);

    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
