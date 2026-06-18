import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file, so
// any variables they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const { mockDbSelectWhere, mockDbUpdateReturning, mockCheckSharedRateLimit, mockCheckHeavyOpRateLimit } = vi.hoisted(() => ({
  mockDbSelectWhere: vi.fn(),
  mockDbUpdateReturning: vi.fn(),
  mockCheckSharedRateLimit: vi.fn(),
  mockCheckHeavyOpRateLimit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: db – provides a chainable query-builder facade.
// The routes use two chains:
//   db.select().from(...).where(...)           → read conversion by id+owner
//   db.update(...).set(...).where(...).returning(...) → write status updates
// Only the terminal calls (where / returning) need to be configurable per
// test; the intermediate chain links are thin wrappers that forward the call.
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbSelectWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mockDbUpdateReturning }) }) }),
    transaction: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: accessibility-engine – exposes the functions needed at module load
// time (route registration) and for runtime calls.
// ---------------------------------------------------------------------------
vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  fixComplianceIssue: vi.fn(),
  fixAllAriaRoleMisuse: vi.fn(),
  getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
  generateAccessibleDocument: vi.fn().mockResolvedValue({
    accessibleHtml: "<html></html>",
    complianceReport: { issues: [] },
    pageCount: 1,
    ocrApplied: false,
  }),
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
// Mock: markdownTableConverter – not exercised here; passthrough.
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: table-fixers – not exercised here; passthrough.
// ---------------------------------------------------------------------------
vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Mock: docx-builder – prevents real DOCX generation in the "allows" tests.
// ---------------------------------------------------------------------------
vi.mock("./lib/docx-builder.js", () => ({
  buildDocx: vi.fn().mockResolvedValue(Buffer.from("fake-docx")),
}));

// ---------------------------------------------------------------------------
// Mock: pdf-builder – prevents real puppeteer/Chromium launch in tests.
// ---------------------------------------------------------------------------
vi.mock("./lib/pdf-builder.js", () => ({
  buildPdf: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}));

// ---------------------------------------------------------------------------
// Mock: rateLimiters – routes.ts imports ALL rate-limit helpers from this
// module.  We stub checkSharedRateLimit with a hoisted spy so individual
// tests can override its return value, while all other exports use safe
// pass-through defaults so the route handler proceeds past every other check.
//
// Constants mirror the defaults in rateLimiters.ts; they are used by routes.ts
// to configure call-site limits and are not under test here.
// ---------------------------------------------------------------------------
vi.mock("./lib/rateLimiters.js", () => {
  mockCheckSharedRateLimit.mockResolvedValue(true);
  mockCheckHeavyOpRateLimit.mockReturnValue(true);
  return {
    checkSharedRateLimit: mockCheckSharedRateLimit,
    checkAnonRateLimit: vi.fn().mockReturnValue(true),
    checkHeavyOpRateLimit: mockCheckHeavyOpRateLimit,
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

// Conversion suitable for the /process endpoint
// (status must not be "processing" to pass the pre-condition check)
const UPLOADED_CONVERSION = {
  id: 1,
  userId: null,
  visitorToken: null,
  originalFilename: "test.pdf",
  fileSize: 1000,
  status: "uploaded",
  pageCount: 1,
  extractedText: "test text",
  accessibleHtml: null,
  complianceReport: null,
  originalComplianceReport: null,
  errorMessage: null,
  ocrApplied: false,
  sourceType: "pdf",
  pdfData: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Conversion suitable for the /reprocess, /download-docx, and /download-pdf
// endpoints (status must be "completed" and accessibleHtml must be non-null)
const COMPLETED_CONVERSION = {
  ...UPLOADED_CONVERSION,
  status: "completed",
  accessibleHtml: ACCESSIBLE_HTML,
  extractedText: "test text",
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Helper: build an app where every request is treated as authenticated.
// Inserts a middleware BEFORE registerRoutes that populates req.user with the
// supplied userId so getUserId(req) returns a non-null value in the handler.
// ---------------------------------------------------------------------------
async function buildAppWithAuth(userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = req.session ?? {};
    req.user = { claims: { sub: userId } };
    next();
  });
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

// ---------------------------------------------------------------------------
// DB-unavailable fallback tests — POST /api/conversions/:id/process
//
// When checkSharedRateLimit throws (e.g. because the database is down), the
// /process handler must invoke the process-local checkHeavyOpRateLimit fallback
// for authenticated users.  Without a fallback every authenticated request is
// denied with 429 on a transient DB outage while anonymous callers continue
// unimpeded via their own fallback — an undocumented asymmetry.
//
// The test simulates the catch→fallback path by making mockCheckSharedRateLimit
// invoke its fallbackFn argument directly (matching the real function's
// contract).  checkHeavyOpRateLimit then controls the outcome.
// ---------------------------------------------------------------------------
describe("POST /api/conversions/:id/process — authenticated caller DB-unavailable fallback", () => {
  const TEST_USER_ID = "test-user-process";

  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    // Ownership check returns a valid "uploaded" conversion.
    mockDbSelectWhere.mockResolvedValue([UPLOADED_CONVERSION]);
    // Claim update returns success so the handler can proceed past the DB write.
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);
    app = await buildAppWithAuth(TEST_USER_ID);
  });

  // -----------------------------------------------------------------------
  // Fallback allows — DB down, process-local limiter says OK
  //
  // The real checkSharedRateLimit catches a DB error and invokes fallbackFn.
  // We replicate that here: the mock calls its fallbackFn argument directly.
  // checkHeavyOpRateLimit returns true → request proceeds → not 429.
  // -----------------------------------------------------------------------
  it("allows an authenticated request when the DB-unavailable fallback permits it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );

    const response = await request(app)
      .post("/api/conversions/1/process")
      .send({});

    // The fallback must have been invoked with the authenticated user key.
    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
    // The request was not rate-limited.
    expect(response.status).not.toBe(429);
  });

  // -----------------------------------------------------------------------
  // Fallback denies — DB down, process-local limiter says NO
  //
  // checkSharedRateLimit invokes the fallback → checkHeavyOpRateLimit returns
  // false → the route returns 429.  Without the fallback wired up for
  // authenticated callers this test would never reach the fallback path.
  // -----------------------------------------------------------------------
  it("denies an authenticated request when the DB-unavailable fallback rejects it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );
    mockCheckHeavyOpRateLimit.mockReturnValueOnce(false);

    const response = await request(app)
      .post("/api/conversions/1/process")
      .send({});

    expect(response.status).toBe(429);
    expect(response.body.error).toMatch(/too many/i);
    // The fallback must have been consulted.
    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
  });
});

// ---------------------------------------------------------------------------
// DB-unavailable fallback tests — POST /api/conversions/:id/reprocess
// ---------------------------------------------------------------------------
describe("POST /api/conversions/:id/reprocess — authenticated caller DB-unavailable fallback", () => {
  const TEST_USER_ID = "test-user-reprocess";

  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    // Ownership check returns a completed conversion with extractedText set.
    mockDbSelectWhere.mockResolvedValue([COMPLETED_CONVERSION]);
    // Claim update returns success.
    mockDbUpdateReturning.mockResolvedValue([{ id: 1 }]);
    app = await buildAppWithAuth(TEST_USER_ID);
  });

  it("allows an authenticated request when the DB-unavailable fallback permits it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );

    const response = await request(app)
      .post("/api/conversions/1/reprocess")
      .send({});

    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
    expect(response.status).not.toBe(429);
  });

  it("denies an authenticated request when the DB-unavailable fallback rejects it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );
    mockCheckHeavyOpRateLimit.mockReturnValueOnce(false);

    const response = await request(app)
      .post("/api/conversions/1/reprocess")
      .send({});

    expect(response.status).toBe(429);
    expect(response.body.error).toMatch(/too many/i);
    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
  });
});

// ---------------------------------------------------------------------------
// DB-unavailable fallback tests — GET /api/conversions/:id/download-docx
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-docx — authenticated caller DB-unavailable fallback", () => {
  const TEST_USER_ID = "test-user-docx";

  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    // Ownership check returns a completed conversion with accessibleHtml set.
    mockDbSelectWhere.mockResolvedValue([COMPLETED_CONVERSION]);
    app = await buildAppWithAuth(TEST_USER_ID);
  });

  it("allows an authenticated request when the DB-unavailable fallback permits it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );

    const response = await request(app)
      .get("/api/conversions/1/download-docx");

    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
    expect(response.status).not.toBe(429);
  });

  it("denies an authenticated request when the DB-unavailable fallback rejects it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );
    mockCheckHeavyOpRateLimit.mockReturnValueOnce(false);

    const response = await request(app)
      .get("/api/conversions/1/download-docx");

    expect(response.status).toBe(429);
    expect(response.body.error).toMatch(/too many/i);
    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
  });
});

// ---------------------------------------------------------------------------
// DB-unavailable fallback tests — GET /api/conversions/:id/download-pdf
// ---------------------------------------------------------------------------
describe("GET /api/conversions/:id/download-pdf — authenticated caller DB-unavailable fallback", () => {
  const TEST_USER_ID = "test-user-pdf";

  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckSharedRateLimit.mockResolvedValue(true);
    mockCheckHeavyOpRateLimit.mockReturnValue(true);
    // Ownership check returns a completed conversion with accessibleHtml set.
    mockDbSelectWhere.mockResolvedValue([COMPLETED_CONVERSION]);
    app = await buildAppWithAuth(TEST_USER_ID);
  });

  it("allows an authenticated request when the DB-unavailable fallback permits it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );

    const response = await request(app)
      .get("/api/conversions/1/download-pdf");

    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
    expect(response.status).not.toBe(429);
  });

  it("denies an authenticated request when the DB-unavailable fallback rejects it", async () => {
    mockCheckSharedRateLimit.mockImplementationOnce(
      async (_key: string, _action: string, _limit: number, _windowMs: number, fallbackFn?: () => boolean) => {
        if (fallbackFn) return fallbackFn();
        return false;
      },
    );
    mockCheckHeavyOpRateLimit.mockReturnValueOnce(false);

    const response = await request(app)
      .get("/api/conversions/1/download-pdf");

    expect(response.status).toBe(429);
    expect(response.body.error).toMatch(/too many/i);
    expect(mockCheckHeavyOpRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER_ID),
    );
  });
});
