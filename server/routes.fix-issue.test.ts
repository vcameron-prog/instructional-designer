import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file, so
// any variables they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const { mockFixComplianceIssue, mockDbSelectWhere, mockDbUpdateReturning } = vi.hoisted(() => ({
  mockFixComplianceIssue: vi.fn(),
  mockDbSelectWhere: vi.fn(),
  mockDbUpdateReturning: vi.fn(),
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
