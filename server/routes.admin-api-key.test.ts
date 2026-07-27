/**
 * Unit tests for the isAdminOrApiKey middleware.
 *
 * Covers:
 *  1. Valid `Authorization: Bearer <key>` header → passes (calls next())
 *  2. Valid `x-api-key: <key>` header → passes
 *  3. Wrong key value → 403
 *  4. Missing key header → 403
 *  5. STATS_API_KEY env var unset → key-based path disabled, 403 even with matching header
 *  6. STATS_API_KEY env var empty string → key-based path disabled, 403
 *  7. Valid admin session (no API key) → passes (existing session path unchanged)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// isAdminOrApiKey reads process.env.ADMIN_USER_IDS (via checkIsAdmin) and
// process.env.STATS_API_KEY.  We control both in each test.
// ---------------------------------------------------------------------------

// We need the real module — NOT mocked — so we import after setting env.
// Use a dynamic import inside each describe block where needed, or just
// import once and rely on the live process.env reads (which happen at
// call-time, not import-time).
import { isAdminOrApiKey } from "./routes";

const REAL_KEY = "test-stats-key-abc123";
const ADMIN_ID = "admin-test-001";

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    user: undefined,
    session: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; statusCode: number | undefined; body: any } {
  const ctx = { statusCode: undefined as number | undefined, body: undefined as any };
  const res = {
    status(code: number) {
      ctx.statusCode = code;
      return res;
    },
    json(data: any) {
      ctx.body = data;
      return res;
    },
  } as unknown as Response;
  return { res, ...ctx, get statusCode() { return ctx.statusCode; }, get body() { return ctx.body; } };
}

describe("isAdminOrApiKey middleware", () => {
  const originalAdminIds = process.env.ADMIN_USER_IDS;
  const originalStatsKey = process.env.STATS_API_KEY;

  beforeEach(() => {
    process.env.STATS_API_KEY = REAL_KEY;
    process.env.ADMIN_USER_IDS = ADMIN_ID;
  });

  afterEach(() => {
    if (originalAdminIds === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = originalAdminIds;
    }
    if (originalStatsKey === undefined) {
      delete process.env.STATS_API_KEY;
    } else {
      process.env.STATS_API_KEY = originalStatsKey;
    }
  });

  it("passes with Authorization: Bearer <correct key>", () => {
    const req = makeReq({ headers: { authorization: `Bearer ${REAL_KEY}` } });
    const { res } = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("passes with x-api-key: <correct key>", () => {
    const req = makeReq({ headers: { "x-api-key": REAL_KEY } });
    const { res } = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 with a wrong key value", () => {
    const req = makeReq({ headers: { authorization: "Bearer wrong-key" } });
    const ctx = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, ctx.res, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.statusCode).toBe(403);
  });

  it("returns 403 when no key header is present and no admin session", () => {
    const req = makeReq();
    const ctx = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, ctx.res, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.statusCode).toBe(403);
  });

  it("returns 403 when STATS_API_KEY is unset (key-based path disabled)", () => {
    delete process.env.STATS_API_KEY;

    const req = makeReq({ headers: { authorization: `Bearer ${REAL_KEY}` } });
    const ctx = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, ctx.res, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.statusCode).toBe(403);
  });

  it("returns 403 when STATS_API_KEY is empty string (key-based path disabled)", () => {
    process.env.STATS_API_KEY = "";

    const req = makeReq({ headers: { authorization: `Bearer ` } });
    const ctx = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, ctx.res, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.statusCode).toBe(403);
  });

  it("passes for a valid admin session even with no API key header", () => {
    const req = makeReq({
      // Simulate what isAuthenticated injects: req.user.claims
      user: { claims: { sub: ADMIN_ID, email: "admin@example.com" } } as any,
    });
    const { res } = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("passes for an admin user identified by email", () => {
    process.env.ADMIN_USER_IDS = "admin@example.com";

    const req = makeReq({
      user: { claims: { sub: "some-other-id", email: "admin@example.com" } } as any,
    });
    const { res } = makeRes();
    const next = vi.fn();

    isAdminOrApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
