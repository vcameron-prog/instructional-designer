/**
 * Tests for the renamed-document guard on POST /api/conversions/upload.
 *
 * Task #1122: the accessibility converter's upload flow should warn faculty
 * the same way /api/upload-syllabus (instructional-designer) does when a
 * document is uploaded with a mismatched extension — e.g. a real PDF renamed
 * to .docx, or a real DOCX renamed to .pdf — instead of accepting it and
 * failing later, deep in extraction, with only a generic error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

/** Minimal valid docx bytes: zip magic + an embedded word/document.xml part name. */
function fakeDocxBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("word/document.xml some xml content here"),
  ]);
}

/** Minimal valid xlsx bytes: zip magic + an embedded xl/workbook.xml part name. */
function fakeXlsxBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("xl/workbook.xml some xml content here"),
  ]);
}

/** Minimal valid PDF bytes: %PDF magic header. */
function fakePdfBuffer(): Buffer {
  return Buffer.from("%PDF-1.4\n%some pdf content here");
}

/** Minimal legacy .doc bytes: OLE compound-file magic header. */
function fakeLegacyDocBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from("legacy doc content"),
  ]);
}

describe("POST /api/conversions/upload — renamed-document guard", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInsertReturning.mockResolvedValue([{ id: 1 }]);
    mockCheckSharedRateLimit.mockResolvedValue(true);
    app = await buildApp();
  });

  it("rejects a real PDF uploaded with a .docx extension with a format-specific message", async () => {
    const res = await request(app)
      .post("/api/conversions/upload")
      .attach("file", fakePdfBuffer(), {
        filename: "syllabus.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/looks like a PDF/i);
    expect(res.body.error).toMatch(/\.pdf/);
    expect(res.body.detectedType).toBe("PDF");
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("rejects a real DOCX uploaded with a .pdf extension with a format-specific message", async () => {
    const res = await request(app)
      .post("/api/conversions/upload")
      .attach("file", fakeDocxBuffer(), {
        filename: "syllabus.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/looks like a Word document \(\.docx\)/i);
    expect(res.body.error).toMatch(/\.docx/);
    expect(res.body.detectedType).toBe("Word document (.docx)");
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("rejects a real XLSX uploaded with a .pdf extension with a format-specific message", async () => {
    const res = await request(app)
      .post("/api/conversions/upload")
      .attach("file", fakeXlsxBuffer(), {
        filename: "grades.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/looks like a Excel spreadsheet \(\.xlsx\)|looks like an Excel spreadsheet \(\.xlsx\)/i);
    expect(res.body.detectedType).toBe("Excel spreadsheet (.xlsx)");
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("rejects a legacy .doc file uploaded with a .pdf extension with a format-specific message", async () => {
    const res = await request(app)
      .post("/api/conversions/upload")
      .attach("file", fakeLegacyDocBuffer(), {
        filename: "handout.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/legacy Word document \(\.doc\)/i);
    expect(res.body.detectedType).toBe("legacy Word document (.doc)");
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("accepts a real PDF uploaded with a .pdf extension", async () => {
    const res = await request(app)
      .post("/api/conversions/upload")
      .attach("file", fakePdfBuffer(), {
        filename: "syllabus.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(200);
    expect(mockDbInsertReturning).toHaveBeenCalled();
  });

  it("accepts a real DOCX uploaded with a .docx extension", async () => {
    const res = await request(app)
      .post("/api/conversions/upload")
      .attach("file", fakeDocxBuffer(), {
        filename: "syllabus.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

    expect(res.status).toBe(200);
    expect(mockDbInsertReturning).toHaveBeenCalled();
  });

  it("does not guard formats it cannot unambiguously detect (e.g. CSV)", async () => {
    const res = await request(app)
      .post("/api/conversions/upload")
      .attach("file", Buffer.from("col1,col2\nval1,val2"), {
        filename: "data.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
    expect(mockDbInsertReturning).toHaveBeenCalled();
  });
});
