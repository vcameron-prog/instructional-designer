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
const { mockRefreshTokenGrant, mockDiscovery, mockUpsertUser } = vi.hoisted(() => ({
  mockRefreshTokenGrant: vi.fn(),
  mockDiscovery: vi.fn(),
  mockUpsertUser: vi.fn(),
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
import { isAuthenticated, isBsuAuthenticated, optionalAuth, signReturnToState, verifyReturnToState } from "./replitAuth.js";

// Set SESSION_SECRET before any sign/verify calls.
process.env.SESSION_SECRET = "test-secret-for-unit-tests";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FAKE_OIDC_CONFIG = { issuer: "https://replit.com/oidc" };
const NOW = Math.floor(Date.now() / 1000);
const EXPIRED_AT = NOW - 300;   // 5 minutes ago — definitely expired
const VALID_AT = NOW + 3600;    // 1 hour from now — definitely valid

/** Builds a fake Express request object with an in-memory session. */
function makeReq(userOverride: Record<string, unknown> = {}, authenticated = true, url?: string) {
  const session: any = {
    save: vi.fn((cb: (err?: Error | null) => void) => cb(null)),
  };
  return {
    isAuthenticated: vi.fn(() => authenticated),
    session,
    user: userOverride,
    logout: vi.fn((cb: () => void) => cb()),
    ...(url !== undefined ? { originalUrl: url } : {}),
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
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("saves returnTo in session when not authenticated and a URL is present", async () => {
    const req = makeReq({}, false, "/faculty/courses/42");
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/faculty/courses/42");
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("saves returnTo in session when token is expired, no refresh_token, and URL is present", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT }, true, "/faculty/assignments/7");
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/faculty/assignments/7");
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("saves returnTo in session when refresh grant throws and URL is present", async () => {
    mockRefreshTokenGrant.mockRejectedValueOnce(new Error("token revoked"));
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "stale-rt" }, true, "/faculty/rubrics/3");
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/faculty/rubrics/3");
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("does NOT save returnTo for paths starting with '//' (open-redirect guard)", async () => {
    const req = makeReq({}, false, "//evil.com/phish");
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBeUndefined();
    expect(req.session.save).not.toHaveBeenCalled();
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

  it("saves returnTo in session when not authenticated and a URL is present", async () => {
    const req = makeReq({}, false, "/faculty/syllabus/edit");
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/faculty/syllabus/edit");
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("saves returnTo in session when expired with no refresh_token and URL is present", async () => {
    const req = makeReq({ expires_at: EXPIRED_AT }, true, "/faculty/quick-tools");
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/faculty/quick-tools");
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("saves returnTo in session when refresh grant throws and URL is present", async () => {
    mockRefreshTokenGrant.mockRejectedValueOnce(new Error("network error"));
    const req = makeReq({ expires_at: EXPIRED_AT, refresh_token: "bad-rt" }, true, "/faculty/modules/5");
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/faculty/modules/5");
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
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
});

// ---------------------------------------------------------------------------
// signReturnToState / verifyReturnToState — callback redirect logic
// ---------------------------------------------------------------------------
describe("signReturnToState / verifyReturnToState", () => {
  it("round-trips a valid path and returns it unexpired", () => {
    const token = signReturnToState("/faculty/courses/42");
    const result = verifyReturnToState(token);

    expect(result).not.toBeNull();
    expect(result!.path).toBe("/faculty/courses/42");
    expect(result!.expired).toBe(false);
  });

  it("returns null for a tampered token", () => {
    const token = signReturnToState("/faculty/courses/1");
    const tampered = token.slice(0, -4) + "XXXX";
    expect(verifyReturnToState(tampered)).toBeNull();
  });

  it("returns null for a token with no dot separator", () => {
    expect(verifyReturnToState("nodothere")).toBeNull();
  });

  it("returns null for a token encoding a path that starts with //", () => {
    // Craft a raw payload that passes HMAC but encodes an unsafe path
    // — verifyReturnToState must reject it at the path-safety check.
    const { createHmac } = require("crypto");
    const payload = Buffer.from(JSON.stringify({ v: "v1", r: "//evil.com", t: Math.floor(Date.now() / 1000) })).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
    expect(verifyReturnToState(`${payload}.${sig}`)).toBeNull();
  });

  it("returns expired:true for a token signed in the past beyond the TTL", () => {
    const { createHmac } = require("crypto");
    const oldTimestamp = Math.floor(Date.now() / 1000) - 15 * 60; // 15 minutes ago
    const payload = Buffer.from(JSON.stringify({ v: "v1", r: "/faculty/old-page", t: oldTimestamp })).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
    const result = verifyReturnToState(`${payload}.${sig}`);

    expect(result).not.toBeNull();
    expect(result!.path).toBe("/faculty/old-page");
    expect(result!.expired).toBe(true);
  });
});
