/**
 * Proves that the reprocess deduplication guard (POST /api/conversions/:id/reprocess)
 * returns HTTP 409 when a second request arrives while a job is already running
 * for the same conversion ID.
 *
 * Strategy
 * --------
 * 1. All heavy dependencies of routes.ts are mocked so the module loads cleanly
 *    in the test environment without a real DB, Anthropic key, or Chromium.
 * 2. `generateAccessibleDocument` is backed by a controllable deferred promise.
 *    This keeps the first request's background IIFE blocked, leaving the
 *    per-conversion key inside `activeProcessingKeys` while the second request
 *    runs — exactly the condition the 409 guard is meant to catch.
 * 3. After asserting the 409 the deferred is resolved and we wait a tick for
 *    the background cleanup (`finally` block) to run, preventing leaked state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import session from "express-session";
import request from "supertest";
import { createServer, type Server } from "http";

// ---------------------------------------------------------------------------
// Hoisted mock factories — created before any vi.mock() calls
// ---------------------------------------------------------------------------
const {
  mockDbSelect,
  mockDbUpdate,
  mockDbExecute,
  mockGenerateAccessibleDocument,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbExecute: vi.fn(),
  mockGenerateAccessibleDocument: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock("./db", () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    execute: mockDbExecute,
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@shared/schema", () => ({
  insertCourseSchema: {
    extend: vi.fn(() => ({ parse: vi.fn(), safeParse: vi.fn() })),
    safeParse: vi.fn(() => ({ success: false, error: {} })),
  },
  courses: {},
  conversions: {
    id: "id",
    status: "status",
    userId: "userId",
    visitorToken: "visitorToken",
    extractedText: "extractedText",
    originalFilename: "originalFilename",
    pageCount: "pageCount",
    processingStartedAt: "processingStartedAt",
    updatedAt: "updatedAt",
    errorMessage: "errorMessage",
    accessibleHtml: "accessibleHtml",
    complianceReport: "complianceReport",
    statusMessage: "statusMessage",
  },
  generatedContent: {},
  contentVersions: { id: "id", generatedContentId: "generatedContentId", createdAt: "createdAt" },
  rateLimitLog: {},
  appMetrics: {},
}));

vi.mock("@shared/models/auth", () => ({
  users: {},
}));

vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  function MockAnthropic() {
    return { messages: { create: vi.fn() } };
  }
  return { default: MockAnthropic };
});

vi.mock("./lib/rateLimiters.js", () => ({
  SHARED_ANON_UPLOAD_RATE_LIMIT: 10,
  SHARED_HEAVY_OP_RATE_LIMIT: 5,
  AI_GEN_RATE_LIMIT: 10,
  AI_GEN_RATE_WINDOW_MS: 60_000,
  UPLOAD_RATE_LIMIT: 10,
  UPLOAD_RATE_WINDOW_MS: 60_000,
  ANON_RATE_LIMIT: 20,
  ANON_RATE_WINDOW_MS: 60_000,
  HEAVY_OP_RATE_WINDOW_MS: 60_000,
  checkSharedRateLimit: vi.fn().mockResolvedValue(true),
  checkAnonRateLimit: vi.fn().mockReturnValue(true),
  checkHeavyOpRateLimit: vi.fn().mockReturnValue(true),
  checkAiGenRateLimit: vi.fn().mockReturnValue(true),
  checkUploadRateLimit: vi.fn().mockReturnValue(true),
  getRateLimitCleanupMetrics: vi.fn().mockReturnValue({ count: 0, lastAt: null }),
}));

vi.mock("./lib/accessibility-engine", async () => {
  const { createAccessibilityEngineMock } = await import("./test-utils/accessibility-engine-mock");
  return createAccessibilityEngineMock({
    generateAccessibleDocument: mockGenerateAccessibleDocument,
  });
});

vi.mock("./lib/accessibility-engine.js", async () => {
  const { createAccessibilityEngineMock } = await import("./test-utils/accessibility-engine-mock");
  return createAccessibilityEngineMock({
    generateAccessibleDocument: mockGenerateAccessibleDocument,
  });
});

vi.mock("./storage", () => ({
  storage: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return vi.fn().mockResolvedValue(null);
      },
    },
  ),
}));

vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: vi.fn((html: string) => html),
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: vi.fn((html: string) => html),
  fixHtmlTableThead: vi.fn((html: string) => html),
  editHtmlTableCaption: vi.fn((html: string) => html),
}));

vi.mock("./lib/content-docx.js", () => ({
  buildContentDocx: vi.fn().mockResolvedValue(Buffer.from("")),
}));

vi.mock("./lib/parseVersionHistoryLimit.js", () => ({
  parseVersionHistoryLimit: vi.fn().mockReturnValue(5),
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER all vi.mock() registrations
// ---------------------------------------------------------------------------
import {
  registerRoutes,
  _testDeleteReprocessKey,
} from "./routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a thenable, fully-chainable Drizzle-style query builder.
 * Awaiting it resolves to `resolvedValue`.
 */
function makeChain(resolvedValue: unknown) {
  const self: Record<string, unknown> = {};
  for (const method of [
    "from", "where", "set", "returning", "leftJoin",
    "orderBy", "limit", "offset",
  ]) {
    self[method] = () => self;
  }
  self.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolvedValue).then(resolve, reject);
  return self;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/conversions/:id/reprocess — 409 deduplication guard", () => {
  const CONV_ID = 42;

  const fakeConversion = {
    id: CONV_ID,
    status: "completed",
    extractedText: "Extracted document text",
    originalFilename: "lecture-slides.pdf",
    pageCount: 5,
    userId: null,
    visitorToken: null,
    processingStartedAt: null,
  };

  let app: Express;
  let httpServer: Server;

  beforeEach(async () => {
    vi.clearAllMocks();

    // DB select routing:
    //   - ownership check (no fields arg) → full fake conversion row
    //   - checkCancelledByDb polls ({ status: ... }) → "processing" so the job proceeds
    mockDbSelect.mockImplementation((fields?: any) => {
      const isStatusPoll = fields && typeof fields === "object" && "status" in fields;
      return makeChain(isStatusPoll ? [{ status: "processing" }] : [fakeConversion]);
    });

    // DB update (claiming the conversion) returns success.
    mockDbUpdate.mockReturnValue(makeChain([{ id: CONV_ID }]));

    app = express();
    app.use(express.json());
    app.use(
      session({ secret: "test-secret", resave: false, saveUninitialized: true }),
    );

    httpServer = createServer(app);
    await registerRoutes(httpServer, app);
  });

  afterEach(() => {
    // Belt-and-suspenders: remove the key if the test failed mid-way so it
    // cannot leak into the next test via the module-level Set.
    _testDeleteReprocessKey(CONV_ID);
    httpServer.close();
  });

  it("returns 409 with an 'already in progress' message when a second reprocess request arrives while the first is still running", async () => {
    // Build a deferred promise so we can hold the background IIFE inside
    // generateAccessibleDocument until after the second request completes.
    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    mockGenerateAccessibleDocument.mockImplementation(() =>
      blocker.then(() => ({
        accessibleHtml: "<html><body><h1>Done</h1></body></html>",
        complianceReport: null,
      })),
    );

    // ── Request 1 ──────────────────────────────────────────────────────────
    // The route adds the per-conversion key to activeProcessingKeys *before*
    // calling res.json(), so by the time this await resolves the key is
    // already in the set and the background IIFE is blocked on the deferred.
    const res1 = await request(app)
      .post(`/api/conversions/${CONV_ID}/reprocess`)
      .send({});

    expect(res1.status).toBe(200);

    // ── Request 2 ──────────────────────────────────────────────────────────
    // Fired while the background job from request 1 is still blocked.
    // The dedup guard must catch this and return 409.
    const res2 = await request(app)
      .post(`/api/conversions/${CONV_ID}/reprocess`)
      .send({});

    expect(res2.status).toBe(409);
    expect(res2.body).toMatchObject({
      error: expect.stringMatching(/already in progress/i),
    });

    // ── Cleanup ────────────────────────────────────────────────────────────
    // Release the blocker so the background IIFE can reach its finally block
    // and remove the key from activeProcessingKeys.
    releaseBlocker();

    // Allow the background microtasks to settle.
    await new Promise<void>((r) => setTimeout(r, 50));
  });

  it("allows a new reprocess request once the previous job has finished", async () => {
    // First run: completes immediately.
    mockGenerateAccessibleDocument.mockResolvedValue({
      accessibleHtml: "<html><body><h1>Done</h1></body></html>",
      complianceReport: null,
    });

    const res1 = await request(app)
      .post(`/api/conversions/${CONV_ID}/reprocess`)
      .send({});
    expect(res1.status).toBe(200);

    // Wait for the background IIFE's finally block to remove the key.
    await new Promise<void>((r) => setTimeout(r, 50));

    // Second run: key is gone — should succeed again.
    const res2 = await request(app)
      .post(`/api/conversions/${CONV_ID}/reprocess`)
      .send({});
    expect(res2.status).toBe(200);
  });
});
