/**
 * Smoke tests for the TOOLKIT_REDIRECTS registered in server/routes.ts.
 *
 * Each of the four retired tool paths (/url-scanner, /color-contrast,
 * /alt-text, /math-ocr) must respond with HTTP 301 and a Location header
 * that points to the Instructional Designer app.
 *
 * Two scenarios are covered per path:
 *   1. ID_APP_URL env var is set → absolute destination URL.
 *   2. ID_APP_URL env var is absent → relative destination path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------
const { mockDbSelectWhere } = vi.hoisted(() => ({
  mockDbSelectWhere: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Mock: auth index
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  getSession: vi.fn(),
  getSessionSaveFailMetrics: vi.fn().mockResolvedValue({ count: 0, lastAt: null, lifetimeCount: 0, thisMonthCount: 0 }),
}));

// ---------------------------------------------------------------------------
// Mock: db
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
    insert: (_table: any) => ({ values: () => ({ onConflictDoUpdate: vi.fn().mockResolvedValue({}) }) }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
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
// Mock: accessibility-engine
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  getAiFixRetryMetrics: vi.fn().mockResolvedValue({ retryCount: 0, lastRetryAt: null }),
  getPersistAiFixRetryLastFailed: vi.fn().mockReturnValue(false),
  fixComplianceIssue: vi.fn(),
  fixAllAriaRoleMisuse: vi.fn(),
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
  getRateLimitCleanupMetrics: vi.fn().mockReturnValue({ lastRunAt: null, lastErrorAt: null, rowsDeletedTotal: 0 }),
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
// Mock: misc modules required by routes.ts at module load time
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
// Module under test — imported AFTER all vi.mock() calls
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

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

const ID_APP_BASE = "https://bsu-instructional-designer.replit.app";

const TOOLKIT_ROUTES: Array<{ oldPath: string; idSlug: string }> = [
  { oldPath: "/url-scanner",    idSlug: "url-scanner" },
  { oldPath: "/color-contrast", idSlug: "color-contrast" },
  { oldPath: "/alt-text",       idSlug: "alt-text" },
  { oldPath: "/math-ocr",       idSlug: "math-ocr" },
];

// ===========================================================================
// Scenario 1: ID_APP_URL is set — absolute redirect destination
// ===========================================================================

describe("TOOLKIT_REDIRECTS – absolute redirect when ID_APP_URL is set", () => {
  let app: express.Express;
  const savedEnv = process.env.ID_APP_URL;

  beforeEach(async () => {
    process.env.ID_APP_URL = ID_APP_BASE;
    app = await buildApp();
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.ID_APP_URL;
    } else {
      process.env.ID_APP_URL = savedEnv;
    }
  });

  for (const { oldPath, idSlug } of TOOLKIT_ROUTES) {
    it(`GET ${oldPath} → 301 to ${ID_APP_BASE}/accessibility-tools/${idSlug}`, async () => {
      const res = await request(app)
        .get(oldPath)
        .redirects(0);

      expect(res.status).toBe(301);
      expect(res.headers["location"]).toBe(
        `${ID_APP_BASE}/accessibility-tools/${idSlug}`,
      );
    });
  }
});

// ===========================================================================
// Scenario 2: ID_APP_URL is absent — relative redirect destination
// ===========================================================================

describe("TOOLKIT_REDIRECTS – relative redirect when ID_APP_URL is absent", () => {
  let app: express.Express;
  const savedEnv = process.env.ID_APP_URL;

  beforeEach(async () => {
    delete process.env.ID_APP_URL;
    app = await buildApp();
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.ID_APP_URL;
    } else {
      process.env.ID_APP_URL = savedEnv;
    }
  });

  for (const { oldPath, idSlug } of TOOLKIT_ROUTES) {
    it(`GET ${oldPath} → 301 to /accessibility-tools/${idSlug} (relative)`, async () => {
      const res = await request(app)
        .get(oldPath)
        .redirects(0);

      expect(res.status).toBe(301);
      expect(res.headers["location"]).toBe(`/accessibility-tools/${idSlug}`);
    });
  }
});

// ===========================================================================
// Scenario 3: ID_APP_URL with trailing slash is normalised
// ===========================================================================

describe("TOOLKIT_REDIRECTS – trailing slash in ID_APP_URL is stripped", () => {
  let app: express.Express;
  const savedEnv = process.env.ID_APP_URL;

  beforeEach(async () => {
    process.env.ID_APP_URL = `${ID_APP_BASE}/`;
    app = await buildApp();
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.ID_APP_URL;
    } else {
      process.env.ID_APP_URL = savedEnv;
    }
  });

  it("GET /url-scanner → Location has no double slash", async () => {
    const res = await request(app)
      .get("/url-scanner")
      .redirects(0);

    expect(res.status).toBe(301);
    expect(res.headers["location"]).toBe(
      `${ID_APP_BASE}/accessibility-tools/url-scanner`,
    );
    expect(res.headers["location"]).not.toContain("//accessibility-tools");
  });
});
