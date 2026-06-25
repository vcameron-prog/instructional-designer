import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
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
      const strategy = new Strategy(
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
    if (typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      (req.session as any).returnTo = returnTo;
    }
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
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

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
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
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > user.expires_at) {
    const refreshToken = user.refresh_token;
    if (!refreshToken) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const config = await getOidcConfig();
      const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
      updateUserSession(user, tokenResponse);
      await persistSession(req, user);
    } catch {
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
