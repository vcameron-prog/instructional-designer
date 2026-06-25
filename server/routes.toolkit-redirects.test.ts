/**
 * Smoke tests for the TOOLKIT_REDIRECTS registered in server/routes.ts.
 *
 * Each of the four retired tool paths (/url-scanner, /color-contrast,
 * /alt-text, /math-ocr) must respond with HTTP 301 and a Location header
 * that points to the equivalent relative path within this app.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { registerRoutes, TOOLKIT_REDIRECTS } from "./routes.js";

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

// Derived from the real TOOLKIT_REDIRECTS export so new entries are
// automatically covered without any manual test update.
const TOOLKIT_ROUTES: Array<{ oldPath: string; idSlug: string }> =
  Object.entries(TOOLKIT_REDIRECTS).map(([oldPath, idPath]) => ({
    oldPath,
    idSlug: idPath.replace(/^\/accessibility-tools\//, ""),
  }));

// ===========================================================================
// Toolkit redirects — relative destination paths
// ===========================================================================

describe("TOOLKIT_REDIRECTS – relative redirect to in-app paths", () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await buildApp();
  });

  for (const { oldPath, idSlug } of TOOLKIT_ROUTES) {
    it(`GET ${oldPath} → 301 to /accessibility-tools/${idSlug}`, async () => {
      const res = await request(app)
        .get(oldPath)
        .redirects(0);

      expect(res.status).toBe(301);
      expect(res.headers["location"]).toBe(`/accessibility-tools/${idSlug}`);
    });
  }
});
