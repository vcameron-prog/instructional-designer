/**
 * Unit tests for the token-refresh / session-persist paths in replitAuth.ts.
 *
 * These tests guard against the regression where a successful token refresh
 * would NOT call req.session.save() or would NOT write req.session.passport,
 * causing the browser to receive a Set-Cookie header that immediately expired
 * ("session expired" bug).
 *
 * Three middleware functions are covered:
 *   • isAuthenticated
 *   • isBsuAuthenticated
 *   • optionalAuth
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks – must be established before any import of the module under test.
// ---------------------------------------------------------------------------
const { mockRefreshTokenGrant, mockDiscovery, mockUpsertUser, mockDbInsert, mockDbSelect } = vi.hoisted(() => ({
  mockRefreshTokenGrant: vi.fn(),
  mockDiscovery: vi.fn(),
  mockUpsertUser: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock("openid-client", () => ({
  discovery: mockDiscovery,
  refreshTokenGrant: mockRefreshTokenGrant,
  buildEndSessionUrl: vi.fn(() => new URL("https://replit.com/logout")),
}));

vi.mock("./storage", () => ({
  authStorage: {
    upsertUser: mockUpsertUser,
  },
}));

// Bypass memoize so getOidcConfig is a plain async function during tests.
vi.mock("memoizee", () => ({ default: (fn: any) => fn }));

vi.mock("connect-pg-simple", () => ({
  default: () => class MockPgStore {},
}));

vi.mock("../../db", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
  },
}));

vi.mock("@shared/schema", async () => {
  const actual = await vi.importActual<typeof import("@shared/schema")>("@shared/schema");
  return {
    ...actual,
    appMetrics: { key: "key", count: "count", lastAt: "last_at" },
  };
});

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
// Module under test – imported AFTER all vi.mock() calls.
// ---------------------------------------------------------------------------
import {
  isAuthenticated,
  isBsuAuthenticated,
  optionalAuth,
  getSessionSaveFailMetrics,
  SESSION_SAVE_FAIL_METRIC_KEY,
} from "./replitAuth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FAKE_OIDC_CONFIG = { issuer: "https://replit.com/oidc" };
const NOW = Math.floor(Date.now() / 1000);
const EXPIRED_AT = NOW - 300;   // 5 minutes ago — definitely expired
const VALID_AT = NOW + 3600;    // 1 hour from now — definitely valid

/** Builds a fake Express request object with an in-memory session. */
function makeReq(userOverride: Record<string, unknown> = {}, authenticated = true) {
  const session: any = {
    save: vi.fn((cb: (err?: Error | null) => void) => cb(null)),
  };
  return {
    isAuthenticated: vi.fn(() => authenticated),
    session,
    user: userOverride,
    logout: vi.fn((cb: () => void) => cb()),
  };
}

/** Builds a fake Express response with chainable .status().json(). */
function makeRes() {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

/** Builds a token response object that mirrors openid-client's shape. */
function makeTokenResponse(exp = VALID_AT, email = "user@example.com") {
  return {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    claims: () => ({
      sub: "user-001",
      email,
      exp,
      first_name: "Test",
      last_name: "User",
      profile_image_url: null,
    }),
  };
}

// ---------------------------------------------------------------------------
// isAuthenticated
// ---------------------------------------------------------------------------
describe("isAuthenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
    mockRefreshTokenGrant.mockResolvedValue(makeTokenResponse());
    mockUpsertUser.mockResolvedValue(undefined);
  });

  it("passes through immediately when the token is still valid", async () => {
    const req = makeReq({ expires_at: VALID_AT, access_token: "old", refresh_token: "rt" });
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is not authenticated at all", async () => {
    const req = makeReq({}, false);
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is expired and no refresh_token is present", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT });
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
  });

  it("calls refreshTokenGrant, writes req.session.passport.user, calls session.save(), then calls next() on a successful refresh", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT, access_token: "old-access", refresh_token: "valid-rt" });
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    // Token refresh was attempted with the stored refresh token.
    expect(mockRefreshTokenGrant).toHaveBeenCalledOnce();
    expect(mockRefreshTokenGrant).toHaveBeenCalledWith(FAKE_OIDC_CONFIG, "valid-rt");

    // Session passport.user contains updated token values.
    expect(req.session.passport).toBeDefined();
    expect(req.session.passport.user.access_token).toBe("new-access-token");
    expect(req.session.passport.user.refresh_token).toBe("new-refresh-token");
    expect(req.session.passport.user.expires_at).toBe(VALID_AT);

    // session.save() was called so the cookie is persisted.
    expect(req.session.save).toHaveBeenCalledOnce();

    // Middleware chain continued.
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 and does NOT call next() when the refresh grant throws", async () => {
    mockRefreshTokenGrant.mockRejectedValueOnce(new Error("token revoked"));
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "stale-rt" });
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    // No originalUrl/url set on this mock req, so saveReturnTo skips save
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("still calls next() when session.save() fails after a successful token refresh", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "valid-rt" });
    req.session.save = vi.fn((cb: (err?: Error | null) => void) => cb(new Error("DB unavailable")));
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    // Token was refreshed and in-memory state was updated.
    expect(mockRefreshTokenGrant).toHaveBeenCalledOnce();
    expect(req.session.passport.user.access_token).toBe("new-access-token");

    // session.save() was attempted but failed — that must not produce a 401.
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();

    // Middleware chain still continued.
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// isBsuAuthenticated
// ---------------------------------------------------------------------------
describe("isBsuAuthenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
    mockRefreshTokenGrant.mockResolvedValue(makeTokenResponse(VALID_AT, "faculty@bridgew.edu"));
    mockUpsertUser.mockResolvedValue(undefined);
  });

  it("passes through when the token is valid and the email is @bridgew.edu", async () => {
    const req = makeReq({
      expires_at: VALID_AT,
      access_token: "tok",
      claims: { email: "prof@bridgew.edu" },
    });
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
  });

  it("returns 403 when the token is valid but email is not @bridgew.edu", async () => {
    const req = makeReq({
      expires_at: VALID_AT,
      access_token: "tok",
      claims: { email: "user@gmail.com" },
    });
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    const req = makeReq({}, false);
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("refreshes token, writes req.session.passport.user, calls session.save(), then proceeds to email check on a successful refresh", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT, access_token: "old", refresh_token: "bsu-rt" });
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    // Token was refreshed.
    expect(mockRefreshTokenGrant).toHaveBeenCalledOnce();
    expect(mockRefreshTokenGrant).toHaveBeenCalledWith(FAKE_OIDC_CONFIG, "bsu-rt");

    // Session passport.user contains updated token values.
    expect(req.session.passport).toBeDefined();
    expect(req.session.passport.user.access_token).toBe("new-access-token");
    expect(req.session.passport.user.refresh_token).toBe("new-refresh-token");
    expect(req.session.passport.user.expires_at).toBe(VALID_AT);

    // session.save() was called.
    expect(req.session.save).toHaveBeenCalledOnce();

    // Email is @bridgew.edu so next() is called.
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when expired, has refresh_token, but refresh grant throws", async () => {
    mockRefreshTokenGrant.mockRejectedValueOnce(new Error("network error"));
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "bad-rt" });
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    // No originalUrl/url set on this mock req, so saveReturnTo skips save
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("returns 401 when expired with no refresh_token", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT });
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("still proceeds to the email check when session.save() fails after a successful token refresh", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "bsu-rt" });
    req.session.save = vi.fn((cb: (err?: Error | null) => void) => cb(new Error("DB unavailable")));
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    // Token was refreshed.
    expect(mockRefreshTokenGrant).toHaveBeenCalledOnce();
    expect(req.session.passport.user.access_token).toBe("new-access-token");

    // session.save() was attempted but failed — must not produce a 401.
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalledWith(401);

    // The refreshed token has a @bridgew.edu email so next() is called.
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// optionalAuth
// ---------------------------------------------------------------------------
describe("optionalAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
    mockRefreshTokenGrant.mockResolvedValue(makeTokenResponse());
    mockUpsertUser.mockResolvedValue(undefined);
  });

  it("calls next() immediately when the request is unauthenticated (anonymous flow)", async () => {
    const req = makeReq({}, false);
    const res = makeRes();
    const next = vi.fn();

    await optionalAuth(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
  });

  it("calls next() without refreshing when the token is valid", async () => {
    const req = makeReq({ expires_at: VALID_AT, refresh_token: "rt" });
    const res = makeRes();
    const next = vi.fn();

    await optionalAuth(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("refreshes token, writes req.session.passport.user, calls session.save(), then calls next() on a successful refresh", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT, access_token: "old", refresh_token: "valid-rt" });
    const res = makeRes();
    const next = vi.fn();

    await optionalAuth(req as any, res as any, next);

    // Token refresh was attempted.
    expect(mockRefreshTokenGrant).toHaveBeenCalledOnce();
    expect(mockRefreshTokenGrant).toHaveBeenCalledWith(FAKE_OIDC_CONFIG, "valid-rt");

    // Session passport.user contains updated token values.
    expect(req.session.passport).toBeDefined();
    expect(req.session.passport.user.access_token).toBe("new-access-token");
    expect(req.session.passport.user.refresh_token).toBe("new-refresh-token");
    expect(req.session.passport.user.expires_at).toBe(VALID_AT);

    // session.save() was called so the cookie is persisted.
    expect(req.session.save).toHaveBeenCalledOnce();

    // Middleware chain continued (optionalAuth always calls next).
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls logout() and still calls next() when the refresh grant throws", async () => {
    mockRefreshTokenGrant.mockRejectedValueOnce(new Error("refresh failed"));
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "bad-rt" });
    const res = makeRes();
    const next = vi.fn();

    await optionalAuth(req as any, res as any, next);

    expect(req.logout).toHaveBeenCalledOnce();
    expect(req.session.save).not.toHaveBeenCalled();
    // optionalAuth never blocks — it always calls next.
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() without refreshing when no refresh_token is present on an expired session", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT });
    const res = makeRes();
    const next = vi.fn();

    await optionalAuth(req as any, res as any, next);

    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(req.session.save).not.toHaveBeenCalled();
    // Still calls next even though refresh was skipped.
    expect(next).toHaveBeenCalledOnce();
  });

  it("still calls next() when session.save() fails after a successful token refresh", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "valid-rt" });
    req.session.save = vi.fn((cb: (err?: Error | null) => void) => cb(new Error("DB unavailable")));
    const res = makeRes();
    const next = vi.fn();

    await optionalAuth(req as any, res as any, next);

    // Token was refreshed and in-memory state was updated.
    expect(mockRefreshTokenGrant).toHaveBeenCalledOnce();
    expect(req.session.passport.user.access_token).toBe("new-access-token");

    // session.save() was attempted but failed — optionalAuth must still call next().
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// saveReturnTo — session persistence for post-login redirect
// ---------------------------------------------------------------------------
describe("saveReturnTo (via isAuthenticated 401 paths)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
    mockUpsertUser.mockResolvedValue(undefined);
  });

  it("writes returnTo to the session and calls session.save() when the store is healthy", async () => {
    const req = makeReq({}, false) as any;
    req.originalUrl = "/courses/123";
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    expect(req.session.returnTo).toBe("/courses/123");
    expect(req.session.save).toHaveBeenCalledOnce();
  });

  it("still writes returnTo in memory and does not throw when session.save() fails (degraded store)", async () => {
    const req = makeReq({}, false) as any;
    req.originalUrl = "/dashboard";
    req.session.save = vi.fn((cb: (err?: Error | null) => void) =>
      cb(new Error("PostgreSQL session store unavailable"))
    );
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    // returnTo is still set in memory even though the store failed
    expect(req.session.returnTo).toBe("/dashboard");
    // save was attempted (and failed), but no error propagated — 401 was still returned cleanly
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not call session.save() when the URL is missing (no url to save)", async () => {
    const req = makeReq({}, false) as any;
    req.originalUrl = "";
    req.url = "";
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    // No valid URL — returnTo is not set and session.save is not called
    expect(req.session.returnTo).toBeUndefined();
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("does not save returnTo for protocol-relative URLs (// prefix)", async () => {
    const req = makeReq({}, false) as any;
    req.originalUrl = "//evil.com/phish";
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    expect(req.session.returnTo).toBeUndefined();
    expect(req.session.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getSessionSaveFailMetrics and persistSessionSaveFail
// ---------------------------------------------------------------------------
describe("getSessionSaveFailMetrics and persistSessionSaveFail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
    mockRefreshTokenGrant.mockResolvedValue(makeTokenResponse());
    mockUpsertUser.mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      }),
    });
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    }));
  });

  it("SESSION_SAVE_FAIL_METRIC_KEY has the canonical string value 'session_save_fail'", () => {
    expect(SESSION_SAVE_FAIL_METRIC_KEY).toBe("session_save_fail");
  });

  it("getSessionSaveFailMetrics queries the DB using the exported constant as the key", async () => {
    let capturedWhereArg: unknown;

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation((sqlArg: unknown) => {
          capturedWhereArg = sqlArg;
          return Promise.resolve([]);
        }),
      })),
    }));

    await getSessionSaveFailMetrics();

    expect(mockDbSelect).toHaveBeenCalledOnce();
    expect(JSON.stringify(capturedWhereArg)).toContain(SESSION_SAVE_FAIL_METRIC_KEY);
  });

  it("getSessionSaveFailMetrics maps lifetime DB row to lifetimeCount", async () => {
    const now = new Date("2026-06-15T10:00:00.000Z");

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([
          { key: SESSION_SAVE_FAIL_METRIC_KEY, count: 42, lastAt: now },
        ]),
      })),
    }));

    const result = await getSessionSaveFailMetrics();

    expect(result.lifetimeCount).toBe(42);
    expect(result.thisMonthCount).toBe(0);
  });

  it("getSessionSaveFailMetrics maps the monthly DB row to thisMonthCount independently of the lifetime row", async () => {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const monthKey = `${SESSION_SAVE_FAIL_METRIC_KEY}.month.${yyyy}-${mm}`;

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([
          { key: SESSION_SAVE_FAIL_METRIC_KEY, count: 10, lastAt: now },
          { key: monthKey, count: 3, lastAt: now },
        ]),
      })),
    }));

    const result = await getSessionSaveFailMetrics();

    expect(result.lifetimeCount).toBe(10);
    expect(result.thisMonthCount).toBe(3);
  });

  it("getSessionSaveFailMetrics falls back to in-memory values when the DB throws", async () => {
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockRejectedValue(new Error("DB unavailable")),
      })),
    }));

    const result = await getSessionSaveFailMetrics();

    expect(result).toEqual({
      count: expect.any(Number),
      lastAt: expect.toSatisfy((v: unknown) => v === null || typeof v === "string"),
      lifetimeCount: expect.any(Number),
      thisMonthCount: 0,
    });
  });

  it("persistSessionSaveFail upserts the lifetime key as the first DB write when session.save() fails", async () => {
    type InsertValues = { key: string; count: number; lastAt: Date };
    type OnConflictSet = { count: unknown; lastAt: unknown };
    const capturedRows: InsertValues[] = [];
    const capturedSets: OnConflictSet[] = [];
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((v: InsertValues) => {
        capturedRows.push(v);
        return {
          onConflictDoUpdate: vi.fn().mockImplementation(({ set }: { set: OnConflictSet }) => {
            capturedSets.push(set);
            return Promise.resolve({});
          }),
        };
      }),
    });

    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "valid-rt" });
    req.session.save = vi.fn((cb: (err?: Error | null) => void) => cb(new Error("session store error")));
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(capturedRows.length).toBeGreaterThanOrEqual(1);
    expect(capturedRows[0].key).toBe(SESSION_SAVE_FAIL_METRIC_KEY);
    expect(capturedRows[0].count).toBe(1);
    expect(capturedRows[0].lastAt).toBeInstanceOf(Date);
    expect(capturedSets[0]).toHaveProperty("count");
    expect(capturedSets[0]).toHaveProperty("lastAt");
  });

  it("persistSessionSaveFail upserts the monthly key with YYYY-MM format as the second DB write", async () => {
    type InsertValues = { key: string; count: number; lastAt: Date };
    type OnConflictSet = { count: unknown; lastAt: unknown };
    const capturedRows: InsertValues[] = [];
    const capturedSets: OnConflictSet[] = [];
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((v: InsertValues) => {
        capturedRows.push(v);
        return {
          onConflictDoUpdate: vi.fn().mockImplementation(({ set }: { set: OnConflictSet }) => {
            capturedSets.push(set);
            return Promise.resolve({});
          }),
        };
      }),
    });

    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "valid-rt" });
    req.session.save = vi.fn((cb: (err?: Error | null) => void) => cb(new Error("session store error")));
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(capturedRows.length).toBe(2);
    expect(capturedRows[1].key).toMatch(/^session_save_fail\.month\.\d{4}-\d{2}$/);
    expect(capturedRows[1].count).toBe(1);
    expect(capturedRows[1].lastAt).toBeInstanceOf(Date);
    expect(capturedSets[1]).toHaveProperty("count");
    expect(capturedSets[1]).toHaveProperty("lastAt");
  });

  it("persistSessionSaveFail emits console.warn and does not throw when db.insert rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("DB write failure")),
      }),
    });

    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "valid-rt" });
    req.session.save = vi.fn((cb: (err?: Error | null) => void) => cb(new Error("session store error")));
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to persist session_save_fail metric to DB:"),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
