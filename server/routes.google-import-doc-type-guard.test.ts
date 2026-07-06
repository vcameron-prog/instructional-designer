/**
 * Tests for the mismatched-export-format guard on the Google Doc/Sheet/Slide
 * import routes.
 *
 * Task #1132: extends the renamed/mismatched-extension guard added to
 * POST /api/conversions/upload (Task #1122) to the Google import routes
 * (/api/conversions/import-google-doc, /import-google-sheet,
 * /import-google-slide). These paths download bytes from Google's export
 * API and set sourceType directly; this guard catches the (unlikely) case
 * where Google's export doesn't match the expected container format before
 * the row is inserted, instead of failing later deep in extraction with
 * only a generic error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

const { mockDbInsertReturning, mockCheckSharedRateLimit } = vi.hoisted(() => ({
  mockDbInsertReturning: vi.fn().mockResolvedValue([{ id: 1 }]),
  mockCheckSharedRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("./db", () => ({
  db: {
    insert: (_table: any) => ({
      values: (_data: any) => ({
        returning: mockDbInsertReturning,
      }),
    }),
    select: (_fields?: any) => ({
      from: (_table: any) => ({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-1" } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-1" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user-1" } };
    next();
  },
  getSession: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

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
    getSavedOutcomes: vi.fn(),
    createSavedOutcome: vi.fn(),
    updateSavedOutcome: vi.fn(),
    deleteSavedOutcome: vi.fn(),
    createContent: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    toggleContentApproval: vi.fn(),
    updateContent: vi.fn(),
    createVersion: vi.fn(),
    pruneOldVersions: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    getUserPreferences: vi.fn(),
    setUserPreferences: vi.fn(),
    getConversionsByUser: vi.fn(),
    getConversionById: vi.fn(),
    createConversion: vi.fn(),
    updateConversion: vi.fn(),
    deleteConversion: vi.fn(),
  },
}));

vi.mock("./lib/accessibility-engine", async () => {
  const { createAccessibilityEngineMock } = await import("./test-utils/accessibility-engine-mock");
  return createAccessibilityEngineMock();
});

vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

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

import { registerRoutes } from "./routes.js";

async function buildApp() {
  vi.resetModules();
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

/** Padding to keep fake buffers above the route's 100-byte "empty file" floor. */
const PADDING = "x".repeat(100);

/** Minimal valid docx bytes: zip magic + an embedded word/document.xml part name. */
function fakeDocxBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(`word/document.xml some xml content here ${PADDING}`),
  ]);
}

/** Minimal valid xlsx bytes: zip magic + an embedded xl/workbook.xml part name. */
function fakeXlsxBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(`xl/workbook.xml some xml content here ${PADDING}`),
  ]);
}

/** Minimal valid pptx bytes: zip magic + an embedded ppt/presentation.xml part name. */
function fakePptxBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(`ppt/presentation.xml some xml content here ${PADDING}`),
  ]);
}

function fakeFetchResponse(buffer: Buffer) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        if (name === "content-length") return String(buffer.length);
        return null;
      },
    },
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: buffer };
          },
          releaseLock: () => {},
        };
      },
    },
  };
}

describe("Google import routes — mismatched export-format guard", () => {
  let app: express.Express;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInsertReturning.mockResolvedValue([{ id: 1 }]);
    mockCheckSharedRateLimit.mockResolvedValue(true);
    app = await buildApp();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a Google Doc export that comes back as xlsx instead of docx", async () => {
    fetchSpy.mockResolvedValue(fakeFetchResponse(fakeXlsxBuffer()));

    const res = await request(app)
      .post("/api/conversions/import-google-doc")
      .send({ url: "https://docs.google.com/document/d/abc123/edit" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exported as a Excel spreadsheet|exported as an Excel spreadsheet/i);
    expect(res.body.detectedType).toBe("Excel spreadsheet (.xlsx)");
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("accepts a Google Doc export that is a real docx", async () => {
    fetchSpy.mockResolvedValue(fakeFetchResponse(fakeDocxBuffer()));

    const res = await request(app)
      .post("/api/conversions/import-google-doc")
      .send({ url: "https://docs.google.com/document/d/abc123/edit" });

    expect(res.status).toBe(200);
    expect(mockDbInsertReturning).toHaveBeenCalled();
  });

  it("rejects a Google Sheet export that comes back as docx instead of xlsx", async () => {
    fetchSpy.mockResolvedValue(fakeFetchResponse(fakeDocxBuffer()));

    const res = await request(app)
      .post("/api/conversions/import-google-sheet")
      .send({ url: "https://docs.google.com/spreadsheets/d/abc123/edit" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exported as a Word document/i);
    expect(res.body.detectedType).toBe("Word document (.docx)");
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("accepts a Google Sheet export that is a real xlsx", async () => {
    fetchSpy.mockResolvedValue(fakeFetchResponse(fakeXlsxBuffer()));

    const res = await request(app)
      .post("/api/conversions/import-google-sheet")
      .send({ url: "https://docs.google.com/spreadsheets/d/abc123/edit" });

    expect(res.status).toBe(200);
    expect(mockDbInsertReturning).toHaveBeenCalled();
  });

  it("rejects a Google Slides export that comes back as docx instead of pptx", async () => {
    fetchSpy.mockResolvedValue(fakeFetchResponse(fakeDocxBuffer()));

    const res = await request(app)
      .post("/api/conversions/import-google-slide")
      .send({ url: "https://docs.google.com/presentation/d/abc123/edit" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exported as a Word document/i);
    expect(res.body.detectedType).toBe("Word document (.docx)");
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("accepts a Google Slides export that is a real pptx", async () => {
    fetchSpy.mockResolvedValue(fakeFetchResponse(fakePptxBuffer()));

    const res = await request(app)
      .post("/api/conversions/import-google-slide")
      .send({ url: "https://docs.google.com/presentation/d/abc123/edit" });

    expect(res.status).toBe(200);
    expect(mockDbInsertReturning).toHaveBeenCalled();
  });
});
