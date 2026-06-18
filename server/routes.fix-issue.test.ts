import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { MAX_CONCURRENT_FIXES } from "./routes";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file, so
// any variables they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const { mockFixComplianceIssue, mockDbSelectWhere, mockDbUpdateReturning, mockCheckSharedRateLimit } = vi.hoisted(() => ({
  mockFixComplianceIssue: vi.fn(),
  mockDbSelectWhere: vi.fn(),
  mockDbUpdateReturning: vi.fn(),
  mockCheckSharedRateLimit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: db – provides a chainable query-builder facade.
// The route uses two chains:
//   db.select().from(...).where(...)           → read conversion by id+owner
//   db.update(...).set(...).where(...).returning(...) → write updated HTML/report
// Only the terminal calls (where / returning) need to be configurable per
// test; the intermediate chain links are thin wrappers that forward the call.
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbSelectWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mockDbUpdateReturning }) }) }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine – exposes fixComplianceIssue as a spy so
// individual tests can control whether wasRetried is set in the return value.
// getDeterministicFixerKeys is needed at module load time (route registration).
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  fixComplianceIssue: mockFixComplianceIssue,
  fixAllAriaRoleMisuse: vi.fn(),
  getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware – setupAuth is a no-op; all middleware
// variants are pass-through so the route handler always runs.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK – prevents a real API client from being instantiated.
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton – routes.ts imports storage at module level.
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    getAllCourses: vi.fn(),
    getCourse: vi.fn(),
    getContent: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    getVersionsByContent: vi.fn(),
    getVersionById: vi.fn(),
    getAllSavedContent: vi.fn(),
    getSavedContent: vi.fn(),
    createSavedContent: vi.fn(),
    deleteSavedContent: vi.fn(),
    createContent: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    toggleContentApproval: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    createVersion: vi.fn(),
    updateContent: vi.fn(),
    pruneOldVersions: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: markdownTableConverter – not exercised by fix-issue; passthrough.
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: table-fixers – not exercised by fix-issue; passthrough.
// ---------------------------------------------------------------------------
vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: rateLimiters – routes.ts imports ALL rate-limit helpers from this
// module (not from shared-rate-limit.js).  We stub checkSharedRateLimit with
// a hoisted spy so individual tests can override its return value, while all
// other exports are stubbed with safe pass-through defaults so that the route
// handler can proceed past every rate-limit check.
//
// Constants mirror the defaults in rateLimiters.ts; they are used by routes.ts
// to configure call-site limits and are not under test here.
//
// vi.clearAllMocks() resets call history but NOT the default return values
// set inside this factory, so the allow-by-default behaviour persists across
// beforeEach calls.
// ---------------------------------------------------------------------------
vi.mock("./lib/rateLimiters.js", () => {
  mockCheckSharedRateLimit.mockResolvedValue(true);
  return {
    checkSharedRateLimit: mockCheckSharedRateLimit,
    checkAnonRateLimit: vi.fn().mockReturnValue(true),
    checkHeavyOpRateLimit: vi.fn().mockReturnValue(true),
    checkAiGenRateLimit: vi.fn().mockReturnValue(true),
    checkUploadRateLimit: vi.fn().mockReturnValue(true),
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
  };
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ACCESSIBLE_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>Test</h1></main></body></html>';

const SAMPLE_ISSUE = {
  id: "issue-1",
  type: "missing-alt",
  severity: "critical",
  element: "<img>",
  description: "Image missing alt text",
  wcagCriteria: "1.1.1",
  autoFixable: true,
};

const COMPLIANCE_REPORT = {
  issues: [SAMPLE_ISSUE],
  overallStatus: "fail",
  wcagLevel: "AA",
  totalIssues: 1,
  criticalIssues: 1,
  warnings: 0,
  passedChecks: 0,
};

// Minimal conversion row that passes the route's pre-condition checks:
//   status === "completed" && accessibleHtml !== null
const BASE_CONVERSION = {
  id: 1,
  userId: null,
  visitorToken: null,
  originalFilename: "test.pdf",
  fileSize: 1000,
  status: "completed",
  pageCount: 1,
  extractedText: "test text",
  accessibleHtml: ACCESSIBLE_HTML,
  complianceReport: COMPLIANCE_REPORT,
  originalComplianceReport: null,
  errorMessage: null,
  ocrApplied: false,
  sourceType: "pdf",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FIXED_REPORT = {
  ...COMPLIANCE_REPORT,
  issues: [],
  overallStatus: "pass",
  totalIssues: 0,
  criticalIssues: 0,
};

// Row shape returned by the .returning({...}) call (subset of conversion columns)
const UPDATED_ROW = {
  id: 1,
  originalFilename: "test.pdf",
  fileSize: 1000,
  status: "completed",
  pageCount: 1,
  extractedText: "test text",
  accessibleHtml: ACCESSIBLE_HTML,
  complianceReport: FIXED_REPORT,
  originalComplianceReport: null,
  errorMessage: null,
  ocrApplied: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Helper: build a fresh Express app for each test so in-memory deduplication
// state (activeFixKeys) cannot leak between tests.
//
// A minimal req.session shim is required because the fix-issue handler
// calls getVisitorToken(req) → (req.session as any).visitorToken BEFORE the
// try/catch block. Without session middleware, req.session is undefined,
// which throws an unhandled error in the async handler (Express 4 does not
// automatically catch async throws before the first await).  The shim
// supplies an empty session object so visitorToken resolves to null/undefined
// and conversionOwnerFilter falls back to the SQL FALSE path, after which the
// mocked db.select returns BASE_CONVERSION as intended.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/conversions/:id/fix-issue — wasRetried forwarding", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    // Default db behaviour: return the base conversion on select, and the
    // updated row on the update + returning chain.
    mockDbSelectWhere.mockResolvedValue([BASE_CONVERSION]);
    mockDbUpdateReturning.mockResolvedValue([UPDATED_ROW]);
  });

  it("includes wasRetried: true in the JSON response when the fixer returns wasRetried: true", async () => {
    // Simulate the retry path: fixComplianceIssue explicitly signals that
    // its first AI attempt failed and a second attempt was needed.
    mockFixComplianceIssue.mockResolvedValue({
      accessibleHtml: ACCESSIBLE_HTML,
      complianceReport: FIXED_REPORT,
      elementsFixed: 1,
      wasRetried: true,
    });

    const response = await request(app)
      .post("/api/conversions/1/fix-issue")
      .send({ issueIndex: 0 })
      .expect(200);

    expect(response.body.wasRetried).toBe(true);
  });

  it("includes wasRetried: false in the JSON response when the fixer does not set the flag", async () => {
    // Simulate the happy path: fixComplianceIssue returns without wasRetried,
    // so the route's `?? false` fallback must supply false.
    mockFixComplianceIssue.mockResolvedValue({
      accessibleHtml: ACCESSIBLE_HTML,
      complianceReport: FIXED_REPORT,
      elementsFixed: 1,
      // wasRetried intentionally absent
    });

    const response = await request(app)
      .post("/api/conversions/1/fix-issue")
      .send({ issueIndex: 0 })
      .expect(200);

    expect(response.body.wasRetried).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Guard-path tests: 429 rate-limit, 503 concurrency cap, 409 deduplication
//
// The 429 test exercises the shared rate-limit gate via the
// mockCheckSharedRateLimit spy.
//
// The 503 and 409 tests manipulate in-flight state (activeFixJobs /
// activeFixKeys) that lives at module level inside routes.ts.  Each test
// uses a "blocker" promise that never resolves until the test explicitly
// releases it, so the in-flight counters are incremented before the guard
// assertion is made.  Every test resolves its blockers in a finally-style
// cleanup step so that activeFixJobs is decremented back to zero before the
// next test runs (via the try/finally in the route handler).
// ---------------------------------------------------------------------------
describe("POST /api/conversions/:id/fix-issue — guard paths", () => {
  let app: express.Express;

  const FIX_RESULT = {
    accessibleHtml: ACCESSIBLE_HTML,
    complianceReport: FIXED_REPORT,
    elementsFixed: 0,
    wasRetried: false,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();

    mockDbSelectWhere.mockResolvedValue([BASE_CONVERSION]);
    mockDbUpdateReturning.mockResolvedValue([UPDATED_ROW]);
    // Rate-limit passes by default; individual tests can override with Once.
    mockCheckSharedRateLimit.mockResolvedValue(true);
    // Fix engine resolves immediately by default.
    mockFixComplianceIssue.mockResolvedValue(FIX_RESULT);
  });

  // -----------------------------------------------------------------------
  // 429 — rate-limit gate
  // -----------------------------------------------------------------------
  it("returns 429 when the shared rate-limit check returns false", async () => {
    // Override just for this request so the gate rejects the caller.
    mockCheckSharedRateLimit.mockResolvedValueOnce(false);

    const response = await request(app)
      .post("/api/conversions/1/fix-issue")
      .send({ issueIndex: 0 })
      .expect(429);

    expect(response.body.error).toMatch(/too many/i);
  });

  // -----------------------------------------------------------------------
  // 409 — per-conversion/issue in-flight deduplication
  //
  // A blocker promise keeps the first request alive long enough for a second
  // identical request to see the key in activeFixKeys and be rejected.
  //
  // IMPORTANT: supertest's Test object only sends the HTTP request when it is
  // awaited or .end() is called.  Plain assignment ("const req1 = request…")
  // does NOT dispatch the request.  We use .end() to fire req1 immediately
  // so the route handler runs and populates activeFixJobs / activeFixKeys
  // before req2 is sent.  The blocker is released after the assertion so
  // activeFixJobs decrements back to 0 in the route's finally block.
  // -----------------------------------------------------------------------
  it("returns 409 when the same conversion+issueIndex pair is already in progress", async () => {
    let resolveFix!: (v: typeof FIX_RESULT) => void;
    const blocker = new Promise<typeof FIX_RESULT>(resolve => {
      resolveFix = resolve;
    });
    mockFixComplianceIssue.mockImplementationOnce(() => blocker);

    // Fire req1 immediately via .end() without waiting for the response.
    const req1Done = new Promise<any>(resolve => {
      request(app)
        .post("/api/conversions/1/fix-issue")
        .send({ issueIndex: 0 })
        .end((_err, res) => resolve(res));
    });

    // Yield to the event loop so the route handler runs far enough to execute
    // activeFixJobs++ and activeFixKeys.add() before the second request fires.
    await new Promise(r => setTimeout(r, 50));

    // Second request for the same (id=1, issueIndex=0) pair must be rejected.
    const res2 = await request(app)
      .post("/api/conversions/1/fix-issue")
      .send({ issueIndex: 0 });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already in progress/i);

    // Release the blocker so req1 completes and activeFixJobs decrements to 0.
    resolveFix(FIX_RESULT);
    await req1Done;
  }, 15_000);

  // -----------------------------------------------------------------------
  // 503 — global concurrency cap (MAX_CONCURRENT_FIXES = 3 by default)
  //
  // Three blocker promises fill all available fix slots; a fourth request
  // then hits the activeFixJobs >= MAX_CONCURRENT_FIXES guard.  Each blocker
  // is released at the end so the slot counter is correctly decremented.
  // Different conversion IDs (10, 11, 12) are used for the three in-flight
  // requests so they each get a unique dedup key and bypass the 409 path.
  //
  // Same .end() fire-and-forget pattern as the 409 test above.
  // -----------------------------------------------------------------------
  it("returns 503 when the concurrent fix job cap is reached", async () => {
    const MAX_SLOTS = MAX_CONCURRENT_FIXES;
    const resolvers: Array<(v: typeof FIX_RESULT) => void> = [];
    const inflightDone: Promise<any>[] = [];

    for (let i = 0; i < MAX_SLOTS; i++) {
      const blocker = new Promise<typeof FIX_RESULT>(resolve => {
        resolvers.push(resolve);
      });
      mockFixComplianceIssue.mockImplementationOnce(() => blocker);
    }

    // Fire one request per slot using distinct conversion IDs (10, 11, 12)
    // so each gets a unique dedup key and none trigger the 409 guard.
    for (let i = 0; i < MAX_SLOTS; i++) {
      inflightDone.push(
        new Promise<any>(resolve => {
          request(app)
            .post(`/api/conversions/${10 + i}/fix-issue`)
            .send({ issueIndex: 0 })
            .end((_err, res) => resolve(res));
        }),
      );
      // Pause between launches so each handler executes activeFixJobs++
      // before the next request is evaluated.
      await new Promise(r => setTimeout(r, 30));
    }

    // One more request — all slots occupied, must get 503.
    const res = await request(app)
      .post("/api/conversions/20/fix-issue")
      .send({ issueIndex: 0 });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/busy/i);

    // Release all blockers so the in-flight jobs complete and activeFixJobs
    // returns to 0, leaving no leaked state for subsequent test runs.
    resolvers.forEach(r => r(FIX_RESULT));
    await Promise.all(inflightDone);
  }, 15_000);
});
