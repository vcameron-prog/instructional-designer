/**
 * Tests for GET /api/metrics – sessionSaveFail field.
 *
 * Two test surfaces are covered in this file:
 *
 *  1. Route integration (describe "GET /api/metrics – sessionSaveFail field")
 *     Verifies that the metrics endpoint correctly serialises whatever
 *     getSessionSaveFailMetrics() returns, including when count > 0 and
 *     lastAt is non-null.
 *
 *  2. persistSession failure path (describe "persistSession failure path –
 *     sessionSaveFail counter")
 *     Imports the REAL isAuthenticated from replitAuth.ts (bypassing the
 *     mocked index used by routes.ts) and injects a session whose save()
 *     callback fires with an error.  Confirms getSessionSaveFailMetrics()
 *     increments count and records lastAt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file, so
// any variables they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const {
  mockGetSessionSaveFailMetrics,
  mockRefreshTokenGrant,
  mockDiscovery,
  mockUpsertUser,
  mockGetAiFixRetryMetrics,
  mockDbSelectWhere,
} = vi.hoisted(() => ({
  mockGetSessionSaveFailMetrics: vi.fn().mockResolvedValue({ count: 0, lastAt: null, lifetimeCount: 0, thisMonthCount: 0 }),
  mockRefreshTokenGrant: vi.fn(),
  mockDiscovery: vi.fn(),
  mockUpsertUser: vi.fn(),
  mockGetAiFixRetryMetrics: vi.fn().mockResolvedValue({ retryCount: 0, lastRetryAt: null }),
  mockDbSelectWhere: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Mock: auth index (used by routes.ts).
// getSessionSaveFailMetrics is a controllable spy so individual tests can
// change what the route sees without touching module-level state.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  getSession: vi.fn(),
  getSessionSaveFailMetrics: mockGetSessionSaveFailMetrics,
}));

// ---------------------------------------------------------------------------
// Mocks needed so the REAL replitAuth.ts can be imported in section 2.
// These do NOT mock the index; they mock the underlying packages that
// replitAuth.ts imports directly.
// ---------------------------------------------------------------------------
vi.mock("openid-client", () => ({
  discovery: mockDiscovery,
  refreshTokenGrant: mockRefreshTokenGrant,
  buildEndSessionUrl: vi.fn(() => new URL("https://replit.com/logout")),
}));

vi.mock("./replit_integrations/auth/storage", () => ({
  authStorage: { upsertUser: mockUpsertUser },
}));

vi.mock("memoizee", () => ({ default: (fn: any) => fn }));

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
// Mock: db (routes.ts uses it for several operations; the metrics endpoint
// itself does not hit db directly, but route registration requires the module).
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: (_fields?: any) => ({ from: (_table: any) => ({ where: mockDbSelectWhere }) }),
    update: (_table: any) => ({
      set: (_data: any) => ({
        where: (_cond: any) => ({ returning: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    delete: (_table: any) => ({ where: () => Promise.resolve(undefined) }),
    insert: (_table: any) => ({ values: (_data: any) => ({ onConflictDoUpdate: () => Promise.resolve(undefined) }) }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton – only getAiFixRetryStats is called by /api/metrics.
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
  },
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine – getAiFixRetryMetrics is called by /api/metrics.
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  getAiFixRetryMetrics: mockGetAiFixRetryMetrics,
  getPersistAiFixRetryLastFailed: vi.fn().mockReturnValue(null),
  fixComplianceIssue: vi.fn(),
  fixAllAriaRoleMisuse: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: rateLimiters – exports used during route registration.
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
// Mock: misc modules required by routes.ts at module load time.
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

// ---------------------------------------------------------------------------
// Module under test (route layer) – imported AFTER all vi.mock() calls.
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Real replitAuth functions – imported from the concrete file, NOT from the
// mocked index, so these exercise the actual module-level counter logic.
// ---------------------------------------------------------------------------
import {
  isAuthenticated as realIsAuthenticated,
  getSessionSaveFailMetrics,
} from "./replit_integrations/auth/replitAuth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = req.session ?? {};
    next();
  });
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

const NOW = Math.floor(Date.now() / 1000);
const EXPIRED_AT = NOW - 300;
const VALID_AT = NOW + 3600;

function makeTokenResponse(exp = VALID_AT) {
  return {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    claims: () => ({
      sub: "user-001",
      email: "user@example.com",
      exp,
      first_name: "Test",
      last_name: "User",
      profile_image_url: null,
    }),
  };
}

/** Creates a minimal fake Express request with a controllable session.save(). */
function makeReq(
  userOverride: Record<string, unknown> = {},
  authenticated = true,
  sessionSaveShouldFail = false
) {
  const session: any = {
    save: vi.fn((cb: (err?: Error | null) => void) => {
      if (sessionSaveShouldFail) {
        cb(new Error("PG session store connection lost"));
      } else {
        cb(null);
      }
    }),
  };
  return {
    isAuthenticated: vi.fn(() => authenticated),
    session,
    user: userOverride,
    logout: vi.fn((cb: () => void) => cb()),
  };
}

/** Creates a minimal fake Express response with chainable .status().json(). */
function makeRes() {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

// ===========================================================================
// Section 1: Route integration tests – GET /api/metrics sessionSaveFail field
// ===========================================================================

describe("GET /api/metrics – sessionSaveFail field", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetAiFixRetryMetrics.mockResolvedValue({ retryCount: 0, lastRetryAt: null });
    app = await buildApp();
  });

  it("includes sessionSaveFail with count 0 and null lastAt when no failures have occurred", async () => {
    mockGetSessionSaveFailMetrics.mockResolvedValue({ count: 0, lastAt: null, lifetimeCount: 0, thisMonthCount: 0 });

    const response = await request(app).get("/api/metrics").expect(200);

    expect(response.body.sessionSaveFail).toMatchObject({ count: 0, lastAt: null });
  });

  it("reports sessionSaveFail.count > 0 and a non-null lastAt when failures have occurred", async () => {
    const failureTimestamp = "2026-06-22T12:00:00.000Z";
    mockGetSessionSaveFailMetrics.mockResolvedValue({ count: 2, lastAt: failureTimestamp, lifetimeCount: 2, thisMonthCount: 2 });

    const response = await request(app).get("/api/metrics").expect(200);

    expect(response.body.sessionSaveFail.count).toBeGreaterThan(0);
    expect(response.body.sessionSaveFail.lastAt).toBe(failureTimestamp);
  });

  it("propagates the exact count value returned by getSessionSaveFailMetrics", async () => {
    mockGetSessionSaveFailMetrics.mockResolvedValue({ count: 5, lastAt: "2026-06-01T00:00:00.000Z", lifetimeCount: 5, thisMonthCount: 3 });

    const response = await request(app).get("/api/metrics").expect(200);

    expect(response.body.sessionSaveFail.count).toBe(5);
  });

  it("sessionSaveFail is present alongside the other top-level metrics keys", async () => {
    mockGetSessionSaveFailMetrics.mockResolvedValue({ count: 0, lastAt: null, lifetimeCount: 0, thisMonthCount: 0 });

    const response = await request(app).get("/api/metrics").expect(200);

    expect(response.body).toHaveProperty("aiFixRetry");
    expect(response.body).toHaveProperty("sessionSaveFail");
    expect(response.body).toHaveProperty("rateLimitCleanup");
  });
});

// ===========================================================================
// Section 2: persistSession failure path – real replitAuth.ts module
// ===========================================================================

describe("persistSession failure path – sessionSaveFail counter", () => {
  const FAKE_OIDC_CONFIG = { issuer: "https://replit.com/oidc" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
    mockRefreshTokenGrant.mockResolvedValue(makeTokenResponse());
    mockUpsertUser.mockResolvedValue(undefined);
  });

  it("increments sessionSaveFail.count when session.save() rejects during token refresh", async () => {
    const req = makeReq(
      { expires_at: EXPIRED_AT, access_token: "old", refresh_token: "valid-rt" },
      true,
      true
    );
    const res = makeRes();
    const next = vi.fn();

    const countBefore = (await getSessionSaveFailMetrics()).count;

    await realIsAuthenticated(req as any, res as any, next);

    const { count, lastAt } = await getSessionSaveFailMetrics();
    expect(count).toBe(countBefore + 1);
    expect(lastAt).not.toBeNull();
  });

  it("still calls next() after a session.save() failure (non-fatal, in-memory session continues)", async () => {
    const req = makeReq(
      { expires_at: EXPIRED_AT, access_token: "old", refresh_token: "valid-rt" },
      true,
      true
    );
    const res = makeRes();
    const next = vi.fn();

    await realIsAuthenticated(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does NOT increment sessionSaveFail.count when session.save() succeeds", async () => {
    const req = makeReq(
      { expires_at: EXPIRED_AT, access_token: "old", refresh_token: "valid-rt" },
      true,
      false
    );
    const res = makeRes();
    const next = vi.fn();

    const countBefore = (await getSessionSaveFailMetrics()).count;

    await realIsAuthenticated(req as any, res as any, next);

    expect((await getSessionSaveFailMetrics()).count).toBe(countBefore);
  });

  it("sets lastAt to a recent ISO timestamp after a session.save() failure", async () => {
    const before = new Date();

    const req = makeReq(
      { expires_at: EXPIRED_AT, access_token: "old", refresh_token: "valid-rt" },
      true,
      true
    );
    await realIsAuthenticated(req as any, makeRes() as any, vi.fn());

    const { lastAt } = await getSessionSaveFailMetrics();
    expect(lastAt).not.toBeNull();
    const recorded = new Date(lastAt!);
    const after = new Date();
    expect(recorded.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
    expect(recorded.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
  });
});

// ===========================================================================
// Section 3: End-to-end – real failure counter flows through GET /api/metrics
// ===========================================================================

describe("End-to-end: real persistSession failure appears in GET /api/metrics", () => {
  const FAKE_OIDC_CONFIG = { issuer: "https://replit.com/oidc" };

  it("GET /api/metrics reflects sessionSaveFail.count > 0 after a real session.save() failure", async () => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
    mockRefreshTokenGrant.mockResolvedValue(makeTokenResponse());
    mockUpsertUser.mockResolvedValue(undefined);
    mockGetAiFixRetryMetrics.mockResolvedValue({ retryCount: 0, lastRetryAt: null });

    // Step 1: trigger real counter increment via the real replitAuth module
    const req = makeReq(
      { expires_at: EXPIRED_AT, access_token: "old", refresh_token: "valid-rt" },
      true,
      true
    );
    await realIsAuthenticated(req as any, makeRes() as any, vi.fn());

    // Step 2: sync the route's mock spy to reflect the real counter so the
    // metrics endpoint sees the incremented value in the same test flow.
    const realMetrics = await getSessionSaveFailMetrics();
    mockGetSessionSaveFailMetrics.mockResolvedValue(realMetrics);

    // Step 3: call GET /api/metrics and verify the counter is exposed
    const app = await buildApp();
    const response = await request(app).get("/api/metrics").expect(200);

    expect(response.body.sessionSaveFail.count).toBeGreaterThan(0);
    expect(response.body.sessionSaveFail.lastAt).not.toBeNull();
  });
});
