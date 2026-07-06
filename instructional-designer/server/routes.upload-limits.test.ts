import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks must be declared before any imports that pull in the modules under
// test. vi.mock factories are hoisted automatically by Vitest.
// ---------------------------------------------------------------------------

vi.mock("./storage", () => ({
  storage: {
    getAllCourses: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    getVersionsByContent: vi.fn(),
    getVersionById: vi.fn(),
    getContent: vi.fn(),
    getCourse: vi.fn(),
    getAllSavedContent: vi.fn(),
    getSavedContent: vi.fn(),
    createSavedContent: vi.fn(),
    deleteSavedContent: vi.fn(),
    getSavedOutcomes: vi.fn(),
    createSavedOutcome: vi.fn(),
    deleteSavedOutcome: vi.fn(),
    createContent: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    toggleContentApproval: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    updateContent: vi.fn(),
    createVersion: vi.fn(),
    pruneOldVersions: vi.fn(),
    deleteContent: vi.fn(),
  },
}));

vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "test-user" } };
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  getSession: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

vi.mock("./db", () => ({ db: {} }));

vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
}));

vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  applyAriaComboboxRoleFix: (html: string) => html,
  applyAriaGridRoleFix: (html: string) => html,
  applyAriaTabRoleFix: (html: string) => html,
}));

// ---------------------------------------------------------------------------
// Helper: build a minimal Express app with routes registered and the same
// global multer error handler that index.ts applies in production.
// ---------------------------------------------------------------------------
async function buildApp() {
  const { registerRoutes } = await import("./routes.js");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = { visitorToken: null };
    next();
  });
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  // Replicate the global multer error handler from server/index.ts so the
  // tests exercise the same 413 / 400 mapping that production uses.
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Please check the maximum allowed upload size." });
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: "Invalid file upload request." });
    }
    if (err.isFileFilterError) {
      return res.status(400).json({ error: err.message });
    }
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  return app;
}

// ---------------------------------------------------------------------------
// A minimal 1×1 white JPEG so the file passes the image/jpeg MIME check.
// The actual bytes don't matter for limit tests; multer rejects oversized
// payloads before calling the fileFilter or route handler.
// ---------------------------------------------------------------------------
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
  "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
  "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIhAAA" +
  "gIBBQEBAAAAAAAAAAAAAQIDBAUREiExQf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEA" +
  "AAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABtSlClKUpQpSlKf/9k=",
  "base64",
);

// Build a buffer that is guaranteed to exceed the 5 MB limit.
const OVER_LIMIT_BUFFER = Buffer.alloc(6 * 1024 * 1024, 0xff);

// Build a buffer that is guaranteed to exceed the 10 MB syllabus upload limit.
const OVER_SYLLABUS_LIMIT_BUFFER = Buffer.alloc(11 * 1024 * 1024, 0xff);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Upload size-limit error handling", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    app = await buildApp();
  });

  // -------------------------------------------------------------------------
  // POST /api/tools/alt-text
  // -------------------------------------------------------------------------

  describe("POST /api/tools/alt-text", () => {
    it("returns 413 with a user-friendly error when the uploaded image exceeds 5 MB", async () => {
      const res = await request(app)
        .post("/api/tools/alt-text")
        .attach("image", OVER_LIMIT_BUFFER, {
          filename: "big.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(413);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    });

    it("returns 400 when the file is uploaded with an unexpected field name", async () => {
      const res = await request(app)
        .post("/api/tools/alt-text")
        .attach("file", TINY_JPEG, {
          filename: "test.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/tools/math-ocr
  // -------------------------------------------------------------------------

  describe("POST /api/tools/math-ocr", () => {
    it("returns 413 with a user-friendly error when the uploaded image exceeds 5 MB", async () => {
      const res = await request(app)
        .post("/api/tools/math-ocr")
        .attach("image", OVER_LIMIT_BUFFER, {
          filename: "big.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(413);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    });

    it("returns 400 when the file is uploaded with an unexpected field name", async () => {
      const res = await request(app)
        .post("/api/tools/math-ocr")
        .attach("photo", TINY_JPEG, {
          filename: "test.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/upload-syllabus
  // -------------------------------------------------------------------------

  describe("POST /api/upload-syllabus", () => {
    it("returns 400 (not 500) when an unsupported file type is uploaded", async () => {
      const res = await request(app)
        .post("/api/upload-syllabus")
        .attach("file", Buffer.from("PK\x03\x04fakezip"), {
          filename: "malware.exe",
          contentType: "application/x-msdownload",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    });

    it("returns 413 with a user-friendly error when the uploaded file exceeds the size limit", async () => {
      const res = await request(app)
        .post("/api/upload-syllabus")
        .attach("file", OVER_SYLLABUS_LIMIT_BUFFER, {
          filename: "big.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(413);
      expect(res.body).toHaveProperty("error");
    });

    it("accepts a supported .txt file", async () => {
      const res = await request(app)
        .post("/api/upload-syllabus")
        .attach("file", Buffer.from("Hello syllabus"), {
          filename: "syllabus.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("content");
    });

    it("rejects a PDF renamed to .txt (magic-byte sniff)", async () => {
      const fakePdf = Buffer.concat([
        Buffer.from("%PDF-1.4\n"),
        Buffer.alloc(50, 0x01),
      ]);
      const res = await request(app)
        .post("/api/upload-syllabus")
        .attach("file", fakePdf, {
          filename: "syllabus.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/renamed/i);
    });

    it("rejects a DOCX (zip) renamed to .txt (magic-byte sniff)", async () => {
      const fakeDocx = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.alloc(50, 0x02),
      ]);
      const res = await request(app)
        .post("/api/upload-syllabus")
        .attach("file", fakeDocx, {
          filename: "syllabus.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/renamed/i);
    });

    it("rejects a legacy .doc (OLE) renamed to .txt (magic-byte sniff)", async () => {
      const fakeDoc = Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        Buffer.alloc(50, 0x03),
      ]);
      const res = await request(app)
        .post("/api/upload-syllabus")
        .attach("file", fakeDoc, {
          filename: "syllabus.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/renamed/i);
    });

    it("rejects arbitrary binary content mislabeled as .txt", async () => {
      const randomBinary = Buffer.from(
        Array.from({ length: 200 }, (_, i) => (i * 37) % 256),
      );
      const res = await request(app)
        .post("/api/upload-syllabus")
        .attach("file", randomBinary, {
          filename: "syllabus.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });
});
