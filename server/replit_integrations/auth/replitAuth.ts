import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { createHmac, timingSafeEqual } from "crypto";
import { authStorage } from "./storage";
import { db } from "../../db";
import { appMetrics } from "@shared/schema";
import { sql } from "drizzle-orm";

let sessionSaveFailCount = 0;
let sessionSaveFailLastAt: string | null = null;

// DB row keys used in the app_metrics table.
// Exported so tests can reference the canonical value instead of repeating
// the string literal — a rename in source will cause a compile-time mismatch.
export const SESSION_SAVE_FAIL_METRIC_KEY = "session_save_fail";

/** Returns the app_metrics monthly key for a given Date (YYYY-MM, UTC). */
function monthKeyFor(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${SESSION_SAVE_FAIL_METRIC_KEY}.month.${yyyy}-${mm}`;
}

export async function getSessionSaveFailMetrics(): Promise<{
  count: number;
  lastAt: string | null;
  lifetimeCount: number;
  thisMonthCount: number;
}> {
  const currentMonthKey = monthKeyFor(new Date());
  try {
    const rows = await db
      .select()
      .from(appMetrics)
      .where(
        sql`${appMetrics.key} IN (${SESSION_SAVE_FAIL_METRIC_KEY}, ${currentMonthKey})`
      );
    const lifetimeRow = rows.find((r) => r.key === SESSION_SAVE_FAIL_METRIC_KEY);
    const monthRow = rows.find((r) => r.key === currentMonthKey);
    return {
      count: sessionSaveFailCount,
      lastAt: sessionSaveFailLastAt,
      lifetimeCount: lifetimeRow?.count ?? 0,
      thisMonthCount: monthRow?.count ?? 0,
    };
  } catch {
    return {
      count: sessionSaveFailCount,
      lastAt: sessionSaveFailLastAt,
      lifetimeCount: sessionSaveFailCount,
      thisMonthCount: 0,
    };
  }
}

async function persistSessionSaveFail(timestamp: string): Promise<void> {
  const ts = new Date(timestamp);
  const mk = monthKeyFor(ts);
  try {
    await db
      .insert(appMetrics)
      .values({ key: SESSION_SAVE_FAIL_METRIC_KEY, count: 1, lastAt: ts })
      .onConflictDoUpdate({
        target: appMetrics.key,
        set: {
          count: sql`${appMetrics.count} + 1`,
          lastAt: ts,
        },
      });
    await db
      .insert(appMetrics)
      .values({ key: mk, count: 1, lastAt: ts })
      .onConflictDoUpdate({
        target: appMetrics.key,
        set: {
          count: sql`${appMetrics.count} + 1`,
          lastAt: ts,
        },
      });
  } catch (err) {
    console.warn("[auth] Failed to persist session_save_fail metric to DB:", err);
  }
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl / 1000, // connect-pg-simple expects seconds, not milliseconds
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Secure in production; allow HTTP cookies in Playwright test mode.
      secure: process.env.NODE_ENV === "production" && process.env.PLAYWRIGHT_TEST !== "1",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function persistSession(req: Parameters<RequestHandler>[0], user: any): Promise<void> {
  (req.session as any).passport = { user };
  try {
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );
  } catch (err) {
    sessionSaveFailCount += 1;
    sessionSaveFailLastAt = new Date().toISOString();
    void persistSessionSaveFail(sessionSaveFailLastAt);
    console.warn(
      `[auth] session.save() failed after token refresh — continuing with in-memory session (sessionSaveFailCount=${sessionSaveFailCount}):`,
      err
    );
  }
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

// ---------------------------------------------------------------------------
// Signed returnTo state — encodes the post-login redirect destination into
// the OIDC `state` parameter so it survives even when the session cookie is
// absent on the callback request (third-party cookie blocking, SameSite=Lax
// across a redirect chain, etc.).
//
// Format:  base64url(JSON payload) + "." + HMAC-SHA-256 signature
// The payload includes a version tag, the returnTo path, and a Unix timestamp
// so the token can be expired after STATE_TTL_SECONDS.
// ---------------------------------------------------------------------------

const STATE_VERSION = "v1";
const STATE_TTL_SECONDS = 10 * 60; // 10 minutes — enough for a slow SSO flow

/**
 * Encode a validated returnTo path into a short-lived HMAC-signed state token.
 * Only call this with paths that have already passed the open-redirect guard
 * (starts with "/" and does NOT start with "//").
 */
export function signReturnToState(returnTo: string): string {
  const payload = {
    v: STATE_VERSION,
    r: returnTo,
    t: Math.floor(Date.now() / 1000),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

/**
 * The result of verifying a signed returnTo state token.
 *
 * - `{ path, expired: false }` — valid, in-TTL token; use path directly.
 * - `{ path, expired: true }`  — HMAC is valid but the 10-minute TTL elapsed.
 *   The path is still safe to use (the signature proves it came from our
 *   server), so callers should still redirect to it rather than dropping the
 *   user to "/" with no explanation.
 * - `null` — token is tampered, malformed, or encodes an unsafe destination;
 *   do not use it.
 */
export type VerifyReturnToStateResult =
  | { path: string; expired: false }
  | { path: string; expired: true }
  | null;

/**
 * Verify a state token produced by signReturnToState.
 * Returns a `VerifyReturnToStateResult`:
 *   - `{ path, expired: false }` on success within TTL
 *   - `{ path, expired: true }` when the HMAC is valid but the token is stale
 *   - `null` when the token is tampered, malformed, or encodes an unsafe path
 *
 * Callers should treat `expired: true` as a still-usable redirect target —
 * the HMAC guarantees the path originated from our server, so redirecting to
 * it is safe even after the TTL.  The TTL exists to bound replay windows, not
 * to invalidate the destination itself.
 */
export function verifyReturnToState(state: string): VerifyReturnToStateResult {
  try {
    const dotIdx = state.lastIndexOf(".");
    if (dotIdx === -1) return null;
    const data = state.slice(0, dotIdx);
    const sig = state.slice(dotIdx + 1);

    const expectedSig = createHmac("sha256", process.env.SESSION_SECRET!)
      .update(data)
      .digest("base64url");

    // Constant-time comparison to prevent timing attacks.
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");
    if (
      sigBuf.length !== expectedBuf.length ||
      !timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.v !== STATE_VERSION) return null;

    const returnTo: unknown = payload.r;
    if (
      typeof returnTo !== "string" ||
      !returnTo.startsWith("/") ||
      returnTo.startsWith("//")
    ) {
      return null;
    }

    const age = Math.floor(Date.now() / 1000) - (payload.t ?? 0);
    const expired = age < 0 || age > STATE_TTL_SECONDS;

    return { path: returnTo, expired };
  } catch {
    return null;
  }
}

/**
 * Extended Strategy that injects a signed returnTo token into the OIDC
 * `state` parameter.
 *
 * Why this survives cookie loss:
 * openid-client/passport only sets its own random `state` when the OIDC
 * server does NOT support PKCE (see passport.js source, `authorizationRequest`
 * method). Replit OIDC supports PKCE, so no random state is generated —
 * our custom `state` value is included verbatim in the authorization URL,
 * stored in session stateData.state, echoed back by the provider in the
 * callback query string, and validated by openid-client against stateData.state.
 * After that validation passes, `req.query.state` holds our signed returnTo
 * token and can be read without touching the session at all.
 */
class ReturnToAwareStrategy extends Strategy {
  authorizationRequestParams(
    req: any,
    options: any
  ): URLSearchParams | Record<string, string> | undefined {
    const base = super.authorizationRequestParams(req, options);
    if (typeof options?.signedReturnToState !== "string") {
      return base;
    }
    // Normalise the base result to a URLSearchParams so we can set `state`.
    let params: URLSearchParams;
    if (base instanceof URLSearchParams) {
      params = base;
    } else if (base && typeof base === "object") {
      params = new URLSearchParams(base as Record<string, string>);
    } else {
      params = new URLSearchParams();
    }
    params.set("state", options.signedReturnToState);
    return params;
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new ReturnToAwareStrategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    const returnTo = req.query["returnTo"];
    let signedState: string | undefined;
    if (typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      (req.session as any).returnTo = returnTo;
      signedState = signReturnToState(returnTo);
    }
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
      ...(signedState !== undefined ? { signedReturnToState: signedState } : {}),
    })(req, res, next);
  });

  app.get("/api/callback", async (req, res, next) => {
    ensureStrategy(req.hostname);

    // ---------------------------------------------------------------------------
    // DEV / TEST BYPASS — only active when PLAYWRIGHT_TEST=1 and NODE_ENV is
    // not "production".  Allows Playwright smoke tests to drive the full
    // state-reading + redirect logic of this handler without executing a real
    // OIDC token exchange (which would require an interactive browser login).
    //
    // A test hits:
    //   GET /api/callback?state=<signed-state>&_test_state_only=1
    //
    // The handler then:
    //   1. Creates a synthetic session (same shape as /api/test/login).
    //   2. Runs the SAME verifyReturnToState() + redirect path as production.
    //   3. Redirects to the decoded returnTo path (or "/" on failure/fallback).
    //
    // Security: doubly-gated by PLAYWRIGHT_TEST=1 AND NODE_ENV !== "production"
    // so it is unreachable in any production deployment.
    // ---------------------------------------------------------------------------
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.PLAYWRIGHT_TEST === "1" &&
      req.query._test_state_only === "1"
    ) {
      const sessionUser = {
        claims: {
          sub: "e2e-oidc-state-user",
          email: "e2e-state@example.com",
          first_name: "E2E",
          last_name: "StateTest",
        },
        access_token: "playwright-state-test-token",
        refresh_token: "playwright-state-test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 7200,
      };
      // Upsert the synthetic user into the DB so that /api/auth/user can find
      // it and return a non-null value.  Without this, useRequireAuth() sees
      // isAuthenticated=false and fires a redirect to /api/login before
      // SlowSignInNotice has a chance to show its toast (relevant when the
      // returnTo destination is a protected page).
      try {
        await upsertUser(sessionUser.claims);
      } catch {
        // Non-fatal: the DB may be unavailable in some test environments.
      }
      (req.session as any).passport = { user: sessionUser };

      const sessionReturnTo = (req.session as any).returnTo as string | undefined;
      if (sessionReturnTo) {
        delete (req.session as any).returnTo;
      }

      let redirectTo = "/";
      let slowSignIn = false;
      const rawState =
        typeof req.query.state === "string" ? req.query.state : null;
      if (rawState) {
        const stateResult = verifyReturnToState(rawState);
        if (stateResult) {
          if (stateResult.expired) {
            slowSignIn = true;
            console.warn(
              "[auth][test] Signed state token expired — still honouring returnTo path:",
              stateResult.path
            );
          }
          redirectTo = stateResult.path;
        }
      }

      if (redirectTo === "/" && sessionReturnTo) {
        redirectTo = sessionReturnTo;
      }

      if (slowSignIn) {
        const sep = redirectTo.includes("?") ? "&" : "?";
        redirectTo = `${redirectTo}${sep}signin=slow`;
      }

      req.session.save((err) => {
        if (err) return next(err);
        res.redirect(redirectTo);
      });
      return;
    }

    passport.authenticate(
      `replitauth:${req.hostname}`,
      { failureRedirect: "/api/login" },
      (err: any, user: Express.User | false, _info: any) => {
        if (err || !user) {
          return res.redirect("/api/login");
        }
        req.logIn(user, (loginErr: any) => {
          if (loginErr) {
            // req.logIn internally calls session.save(). When the PostgreSQL
            // session store is offline, session.save() fails and passport
            // propagates the error here as loginErr. The OIDC token exchange
            // already succeeded, so we know the user is authenticated. Log the
            // degraded-store event and still redirect — the signed state gives
            // us the correct destination without touching the session at all.
            // The user may need to re-authenticate on their next protected
            // request if the store is still down, but they'll land on the right
            // page rather than seeing an unhandled 500.
            console.warn(
              "[auth] req.logIn failed (session store may be degraded) — redirecting to returnTo via signed state:",
              loginErr
            );
          }

          // Capture and clear session.returnTo now so stale values never
          // affect a future login flow, regardless of which path we use.
          const sessionReturnTo = (req.session as any).returnTo as string | undefined;
          if (sessionReturnTo) {
            delete (req.session as any).returnTo;
          }

          // Primary: extract returnTo from the signed state parameter.
          // This survives cookie loss because the OIDC provider echoes the
          // state value back through the redirect URL query string.
          //
          // If the token is expired (user took > 10 min to complete SSO) we
          // still use its path — the valid HMAC proves the path came from our
          // server and was set for this user, so dropping them to "/" would
          // only cause confusion.  We log a warning for observability.
          let redirectTo = "/";
          let slowSignIn = false;
          const rawState =
            typeof req.query.state === "string" ? req.query.state : null;
          if (rawState) {
            const stateResult = verifyReturnToState(rawState);
            if (stateResult) {
              if (stateResult.expired) {
                slowSignIn = true;
                console.warn(
                  "[auth] Signed state token expired — still honouring returnTo path for user-friendly redirect:",
                  stateResult.path
                );
              }
              redirectTo = stateResult.path;
            }
          }

          // Fallback: session-based returnTo (works when state was not set,
          // e.g. the user navigated to /api/login without a returnTo param).
          if (redirectTo === "/" && sessionReturnTo) {
            redirectTo = sessionReturnTo;
          }

          if (slowSignIn) {
            const sep = redirectTo.includes("?") ? "&" : "?";
            redirectTo = `${redirectTo}${sep}signin=slow`;
          }

          res.redirect(redirectTo);
        });
      }
    )(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    const expectedOrigin = `${req.protocol}://${req.hostname}`;
    const requestOrigin = req.headers["origin"] ?? req.headers["referer"];
    if (!requestOrigin || !requestOrigin.startsWith(expectedOrigin)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    req.logout(() => {
      const endSessionUrl = client.buildEndSessionUrl(config, {
        client_id: process.env.REPL_ID!,
        post_logout_redirect_uri: expectedOrigin,
      }).href;
      res.json({ redirectUrl: endSessionUrl });
    });
  });
}

async function saveReturnTo(req: Parameters<RequestHandler>[0]): Promise<void> {
  const url = req.originalUrl || req.url;
  if (url && url.startsWith("/") && !url.startsWith("//")) {
    (req.session as any).returnTo = url;
    try {
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
    } catch (err) {
      console.warn(
        "[auth] session.save() failed while persisting returnTo — redirect may fall back to '/':",
        err
      );
    }
  }
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    await saveReturnTo(req);
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    await saveReturnTo(req);
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    await persistSession(req, user);
    return next();
  } catch (error) {
    await saveReturnTo(req);
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};

// Requires authentication AND a @bridgew.edu email.
// Applied to all instructional design and quick-tools routes.
// Accessibility converter routes use optionalAuth and are open to everyone.
export const isBsuAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.expires_at) {
    await saveReturnTo(req);
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > user.expires_at) {
    const refreshToken = user.refresh_token;
    if (!refreshToken) {
      await saveReturnTo(req);
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const config = await getOidcConfig();
      const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
      updateUserSession(user, tokenResponse);
      await persistSession(req, user);
    } catch {
      await saveReturnTo(req);
      return res.status(401).json({ message: "Unauthorized" });
    }
  }

  const email: string = (user?.claims?.email ?? "").toLowerCase();
  if (!email.endsWith("@bridgew.edu")) {
    return res.status(403).json({
      message:
        "Access restricted to BSU faculty. Please sign in with your @bridgew.edu account.",
      code: "BSU_EMAIL_REQUIRED",
    });
  }

  return next();
};

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }

  const user = req.user as any;
  if (!user?.expires_at) {
    return next();
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (refreshToken) {
    try {
      const config = await getOidcConfig();
      const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
      updateUserSession(user, tokenResponse);
      await persistSession(req, user);
    } catch {
      req.logout(() => {});
    }
  }
  return next();
};
