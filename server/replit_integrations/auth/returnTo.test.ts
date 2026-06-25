/**
 * Integration & unit tests for the returnTo redirect flow.
 *
 * The flow has three stages:
 *
 *   Stage 1 – Protected route blocks an unauthenticated request.
 *             isAuthenticated / isBsuAuthenticated call saveReturnTo() which
 *             stores the requested URL in req.session.returnTo.
 *
 *   Stage 2 – Client redirects to /api/login?returnTo=<url>.
 *             The login route validates the param, stores it in
 *             req.session.returnTo, and also encodes it in a short-lived
 *             signed OIDC state token (signedReturnToState).
 *
 *   Stage 3 – After a successful OIDC callback /api/callback reads the
 *             returnTo from the signed state parameter first (primary path),
 *             falling back to req.session.returnTo, then to "/".
 *
 * Tests below cover all three stages, the signed-state crypto helpers, and
 * the open-redirect guard.
 *
 * For the unit tests (Stage 1) req objects are constructed manually,
 * matching the pattern in replitAuth.test.ts.
 *
 * For the integration test (Stages 2 + 3) a real express-session with an
 * in-memory store is used together with supertest.agent so the session cookie
 * persists across the three-request chain:
 *   GET /api/courses/42       → 401, session.returnTo set
 *   GET /api/login?returnTo=… → 302, session.returnTo overwritten, signedState generated
 *   GET /api/callback?state=… → 302, Location === the signed state's returnTo
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before any vi.mock() factory runs.
// ---------------------------------------------------------------------------
const {
  mockRefreshTokenGrant,
  mockDiscovery,
  mockUpsertUser,
  mockDbInsert,
  mockDbSelect,
  mockPassportAuthenticate,
} = vi.hoisted(() => ({
  mockRefreshTokenGrant: vi.fn(),
  mockDiscovery: vi.fn(),
  mockUpsertUser: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
  mockPassportAuthenticate: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("openid-client", () => ({
  discovery: mockDiscovery,
  refreshTokenGrant: mockRefreshTokenGrant,
  buildEndSessionUrl: vi.fn(() => new URL("https://replit.com/logout")),
}));

// Strategy class used inside ensureStrategy() — mocked so route handlers
// can be set up without a real OIDC server.
vi.mock("openid-client/passport", () => ({
  Strategy: class MockStrategy {
    constructor(_opts: any, _verify: any) {}
    authorizationRequestParams(_req: any, _opts: any) {
      return new URLSearchParams();
    }
  },
}));

vi.mock("./storage", () => ({
  authStorage: { upsertUser: mockUpsertUser },
}));

vi.mock("memoizee", () => ({ default: (fn: any) => fn }));

// connect-pg-simple is replaced with express-session's built-in MemoryStore
// so that getSession() can run without a real PostgreSQL connection.
// MemoryStore already extends EventEmitter, satisfying express-session's
// requirement that the store emits "connect" / "error" events.
vi.mock("connect-pg-simple", async () => {
  const expressSession = (await vi.importActual<any>("express-session")).default;
  return {
    // The real call is connectPg(session) → returns a class.
    // We return MemoryStore so that new pgStore({…}) creates a MemoryStore.
    default: (_sessionFn: any) => expressSession.MemoryStore,
  };
});

// express-session is NOT globally mocked here — the real implementation is
// used so that session cookies persist across requests in supertest.agent.
// The unit tests (Stage 1) provide their own req.session objects manually
// and never trigger the session middleware.

// passport middleware stubs:
//   initialize  — provides req.isAuthenticated() returning false (no real OIDC)
//   session     — no-op (no real session deserialization needed for the tests)
//   authenticate — captured via mockPassportAuthenticate; each test group
//                  configures it to return the right handler.
vi.mock("passport", async () => {
  const passportMock = {
    initialize: vi.fn(
      () => (req: any, _res: any, next: any) => {
        // Provide isAuthenticated() so isAuthenticated middleware can call it.
        if (!req.isAuthenticated) {
          req.isAuthenticated = () => false;
        }
        next();
      }
    ),
    session: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    use: vi.fn(),
    serializeUser: vi.fn(),
    deserializeUser: vi.fn(),
    authenticate: mockPassportAuthenticate,
  };
  return { default: passportMock };
});

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

// ---------------------------------------------------------------------------
// Module under test — imported AFTER all vi.mock() calls.
// ---------------------------------------------------------------------------
import {
  isAuthenticated,
  isBsuAuthenticated,
  setupAuth,
  signReturnToState,
  verifyReturnToState,
} from "./replitAuth.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
const FAKE_OIDC_CONFIG = { issuer: "https://replit.com/oidc" };
const NOW = Math.floor(Date.now() / 1000);
const VALID_AT = NOW + 3600;

// Provide SESSION_SECRET so getSession() and the signing helpers do not throw.
process.env.SESSION_SECRET = "test-session-secret-for-vitest";

// ---------------------------------------------------------------------------
// Helpers (same pattern as replitAuth.test.ts)
// ---------------------------------------------------------------------------

function makeReq(
  overrides: Record<string, unknown> = {},
  authenticated = false
) {
  const session: any = {
    save: vi.fn((cb: (err?: Error | null) => void) => cb(null)),
  };
  return {
    isAuthenticated: vi.fn(() => authenticated),
    session,
    user: overrides,
    originalUrl: "/protected/resource?q=1",
    url: "/protected/resource?q=1",
    logout: vi.fn((cb: () => void) => cb()),
  };
}

function makeRes() {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

// ---------------------------------------------------------------------------
// Signed state helpers — unit tests
// ---------------------------------------------------------------------------

describe("signReturnToState / verifyReturnToState", () => {
  it("round-trips a valid returnTo path", () => {
    const path = "/courses/42/edit";
    const state = signReturnToState(path);
    expect(verifyReturnToState(state)).toBe(path);
  });

  it("round-trips a path with a query string", () => {
    const path = "/syllabi/new?template=lecture&week=3";
    const state = signReturnToState(path);
    expect(verifyReturnToState(state)).toBe(path);
  });

  it("returns null for a tampered payload", () => {
    const state = signReturnToState("/courses/42");
    // Flip a character in the data section (before the last dot).
    const dotIdx = state.lastIndexOf(".");
    const tampered = state.slice(0, dotIdx - 1) + "X" + state.slice(dotIdx);
    expect(verifyReturnToState(tampered)).toBeNull();
  });

  it("returns null for a tampered signature", () => {
    const state = signReturnToState("/courses/42");
    expect(verifyReturnToState(state + "X")).toBeNull();
  });

  it("returns null for a completely invalid string", () => {
    expect(verifyReturnToState("not-a-valid-state")).toBeNull();
    expect(verifyReturnToState("")).toBeNull();
  });

  it("rejects an absolute URL embedded in a forged state", () => {
    // Build a fake payload that encodes an absolute URL — must be rejected even
    // if someone somehow gets a valid HMAC (impossible without the secret, but
    // defence-in-depth: the path guard runs after HMAC verification).
    // Here we just verify the path guard is in place for invalid paths.
    const state = signReturnToState("/safe-path");
    // The only way to get a valid state with an absolute URL is to know the
    // secret, so instead we verify that an absolute URL is caught at
    // verifyReturnToState's internal path check.
    // We cannot forge a valid HMAC, so we build a helper that would produce one:
    const { createHmac } = require("crypto");
    const payload = JSON.stringify({
      v: "v1",
      r: "https://evil.com/steal",
      t: Math.floor(Date.now() / 1000),
    });
    const data = Buffer.from(payload).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET!)
      .update(data)
      .digest("base64url");
    const forgedState = `${data}.${sig}`;
    expect(verifyReturnToState(forgedState)).toBeNull();
  });

  it("rejects a protocol-relative URL embedded in a forged state", () => {
    const { createHmac } = require("crypto");
    const payload = JSON.stringify({
      v: "v1",
      r: "//evil.com/steal",
      t: Math.floor(Date.now() / 1000),
    });
    const data = Buffer.from(payload).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET!)
      .update(data)
      .digest("base64url");
    expect(verifyReturnToState(`${data}.${sig}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stage 1 – middleware saves returnTo when blocking an unauthenticated request
// ---------------------------------------------------------------------------

describe("Stage 1 – isAuthenticated saves returnTo in session when blocking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
  });

  it("stores req.originalUrl in session.returnTo when the user is not authenticated", async () => {
    const req = makeReq({}, false);
    req.originalUrl = "/courses/42/edit";
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/courses/42/edit");
    expect(next).not.toHaveBeenCalled();
  });

  it("stores req.originalUrl in session.returnTo when the token is expired and has no refresh_token", async () => {
    const req = makeReq({ expires_at: NOW - 300 }, true);
    req.originalUrl = "/syllabi/new?template=lecture";
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/syllabi/new?template=lecture");
    expect(next).not.toHaveBeenCalled();
  });

  it("stores req.originalUrl in session.returnTo when the token refresh fails", async () => {
    mockRefreshTokenGrant.mockRejectedValueOnce(new Error("revoked"));
    const req = makeReq(
      { expires_at: NOW - 300, refresh_token: "stale-rt" },
      true
    );
    req.originalUrl = "/assignments/create";
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/assignments/create");
    expect(next).not.toHaveBeenCalled();
  });

  it("falls back to req.url when req.originalUrl is absent", async () => {
    const req = makeReq({}, false) as any;
    req.url = "/rubrics/5";
    delete req.originalUrl;
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(req.session.returnTo).toBe("/rubrics/5");
  });

  it("does NOT set session.returnTo when the user is already authenticated with a valid token", async () => {
    const req = makeReq({ expires_at: VALID_AT }, true);
    req.originalUrl = "/dashboard";
    const res = makeRes();
    const next = vi.fn();

    await isAuthenticated(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.session.returnTo).toBeUndefined();
  });
});

describe("Stage 1 – isBsuAuthenticated saves returnTo in session when blocking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);
  });

  it("stores req.originalUrl in session.returnTo when the user is not authenticated", async () => {
    const req = makeReq({}, false);
    req.originalUrl = "/quick-tools/assignment";
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/quick-tools/assignment");
    expect(next).not.toHaveBeenCalled();
  });

  it("stores req.originalUrl in session.returnTo when the token refresh fails", async () => {
    mockRefreshTokenGrant.mockRejectedValueOnce(new Error("revoked"));
    const req = makeReq(
      { expires_at: NOW - 300, refresh_token: "stale-rt" },
      true
    );
    req.originalUrl = "/courses/99";
    const res = makeRes();
    const next = vi.fn();

    await isBsuAuthenticated(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.session.returnTo).toBe("/courses/99");
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stage 2 – open-redirect guard on /api/login
// ---------------------------------------------------------------------------

describe("Stage 2 – /api/login open-redirect guard", () => {
  let app: express.Express;
  let capturedSessions: any[];

  beforeAll(async () => {
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);

    // Login route: return a plain 302 so supertest can read the session.
    mockPassportAuthenticate.mockImplementation(
      () => (_req: any, res: any, _next: any) => {
        res.status(302).setHeader("Location", "/oauth/authorize").end();
      }
    );

    capturedSessions = [];
    app = express();
    // Capture each request's session after it has been populated.
    app.use((req: any, _res: any, next: any) => {
      next();
      // Capture at the end of the middleware chain (after session is written).
      setImmediate(() => capturedSessions.push(req.session));
    });
    await setupAuth(app);
  });

  beforeEach(() => {
    capturedSessions.length = 0;
  });

  it("does NOT store a protocol-relative URL (//evil.com)", async () => {
    const server = createServer(app);
    await request(server)
      .get("/api/login?returnTo=%2F%2Fevil.com%2Fsteal")
      .set("Host", "localhost");
    await new Promise((r) => setImmediate(r));
    expect(capturedSessions[0]?.returnTo).toBeUndefined();
  });

  it("does NOT store an absolute URL (https://evil.com)", async () => {
    const server = createServer(app);
    await request(server)
      .get("/api/login?returnTo=https%3A%2F%2Fevil.com")
      .set("Host", "localhost");
    await new Promise((r) => setImmediate(r));
    expect(capturedSessions[0]?.returnTo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Stage 2 + Stage 3 – end-to-end integration: the full returnTo round-trip
//
// The passport.authenticate mock simulates two behaviours:
//
//   Login route  — no custom done-callback (third arg).  The mock just
//                  redirects toward the OAuth provider.
//
//   Callback route — a done-callback IS provided as the third argument.
//                    The mock calls it with (null, fakeUser) to simulate a
//                    successful OIDC exchange, then the real route handler
//                    reads req.query.state (primary) or req.session.returnTo
//                    (fallback) and issues the final redirect.
//
// Uses the real express-session (with an in-memory store) and supertest.agent
// so the session cookie persists across all legs of the flow.
// ---------------------------------------------------------------------------

describe("Integrated returnTo round-trip (Stages 2 + 3)", () => {
  let integrationApp: express.Express;
  const FAKE_USER = { claims: { sub: "u1" }, expires_at: VALID_AT };

  beforeAll(async () => {
    vi.clearAllMocks();
    mockDiscovery.mockResolvedValue(FAKE_OIDC_CONFIG);

    // Configure passport.authenticate differently depending on which route
    // invokes it:
    //
    //   /api/login    → no done-callback → redirect to OAuth provider
    //   /api/callback → done-callback provided → call it with (null, user)
    //
    // The callback route also provides req.logIn on the request so the
    // handler can call req.logIn(user, cb).
    mockPassportAuthenticate.mockImplementation(
      (_strategyName: string, _opts: any, doneCb?: Function) =>
        (req: any, res: any, next: any) => {
          if (typeof doneCb === "function") {
            // Simulate successful OIDC authentication.
            // Attach logIn so the handler can call req.logIn(user, cb).
            req.logIn = (user: any, cb: (err?: any) => void) => {
              req.user = user;
              cb();
            };
            doneCb(null, FAKE_USER, {});
          } else {
            // Login initiation — redirect toward the OAuth provider.
            res.status(302).setHeader("Location", "/oauth/authorize").end();
          }
        }
    );

    integrationApp = express();
    await setupAuth(integrationApp);

    // Register a protected API route so the first leg of the test can hit a
    // real route guarded by isAuthenticated.
    integrationApp.get("/api/courses/:id", isAuthenticated, (req, res) => {
      res.json({ id: req.params.id });
    });

    // Debug route — returns the current session.returnTo value so integration
    // tests can assert on intermediate session state between legs.
    integrationApp.get("/api/test/session-state", (req, res) => {
      res.json({ returnTo: (req.session as any).returnTo ?? null });
    });
  });

  it("callback redirects to the returnTo encoded in the signed state parameter", async () => {
    const server = createServer(integrationApp);
    const agent = request.agent(server);

    // Leg 1: Unauthenticated request to a protected route → 401.
    const leg1 = await agent
      .get("/api/courses/42")
      .set("Host", "localhost");
    expect(leg1.status).toBe(401);

    // Leg 2: Client redirects to /api/login?returnTo=<the page it was on>.
    const leg2 = await agent
      .get("/api/login?returnTo=%2Fcourses%2F42")
      .set("Host", "localhost");
    expect(leg2.status).toBe(302);

    // Leg 3: Generate the same signed state that the login handler would have
    // created and include it in the callback URL.  The handler should use it
    // (primary path) to redirect to /courses/42.
    const signedState = signReturnToState("/courses/42");
    const leg3 = await agent
      .get(`/api/callback?state=${encodeURIComponent(signedState)}`)
      .set("Host", "localhost");

    expect(leg3.status).toBe(302);
    expect(leg3.headers["location"]).toBe("/courses/42");
  });

  it("callback falls back to session.returnTo when state is absent", async () => {
    const server = createServer(integrationApp);
    const agent = request.agent(server);

    // Store returnTo in session via the login route.
    await agent
      .get("/api/login?returnTo=%2Fcourses%2F99")
      .set("Host", "localhost");

    // Callback without a state param — must fall back to session.returnTo.
    const res = await agent
      .get("/api/callback")
      .set("Host", "localhost");

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/courses/99");
  });

  it("callback falls back to '/' when neither state nor session.returnTo is present", async () => {
    const server = createServer(integrationApp);
    // Fresh agent — no session, no state.
    const agent = request.agent(server);

    const res = await agent
      .get("/api/callback")
      .set("Host", "localhost");

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
  });

  it("state parameter is preferred over session.returnTo when both are present", async () => {
    const server = createServer(integrationApp);
    const agent = request.agent(server);

    // Store a different returnTo in session.
    await agent
      .get("/api/login?returnTo=%2Fsession-path")
      .set("Host", "localhost");

    // Pass a signed state pointing to a different path.
    const signedState = signReturnToState("/state-path");
    const res = await agent
      .get(`/api/callback?state=${encodeURIComponent(signedState)}`)
      .set("Host", "localhost");

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/state-path");
  });

  it("rejects a protocol-relative returnTo in the login route and falls back to '/' on callback", async () => {
    const server = createServer(integrationApp);
    const agent = request.agent(server);

    // Attempt to inject an open-redirect via the login route.
    await agent
      .get("/api/login?returnTo=%2F%2Fevil.com")
      .set("Host", "localhost");

    // session.returnTo must not have been set, no signed state → falls back to "/".
    const res = await agent
      .get("/api/callback")
      .set("Host", "localhost");

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
  });

  it("rejects a tampered signed state and falls back to session.returnTo", async () => {
    const server = createServer(integrationApp);
    const agent = request.agent(server);

    // Store a valid session returnTo.
    await agent
      .get("/api/login?returnTo=%2Flegit-path")
      .set("Host", "localhost");

    // Pass a tampered state token.
    const badState = "tampered.invalidsig";
    const res = await agent
      .get(`/api/callback?state=${encodeURIComponent(badState)}`)
      .set("Host", "localhost");

    // Falls back to session.returnTo.
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/legit-path");
  });
});
