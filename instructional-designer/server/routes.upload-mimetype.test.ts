import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Regression coverage for the server-side upload rejection path on the
// /api/tools/alt-text and /api/tools/math-ocr routes.
//
// The client already blocks obviously-wrong file types before ever hitting
// the network (see the "wrong file type" e2e coverage in e2e/id-smoke.spec.ts),
// but a file whose *reported* mimetype starts with "image/" — e.g.
// "image/bmp" or "image/svg+xml" — passes that client-side
// `f.type.startsWith("image/")` check and reaches the server. The multer
// `fileFilter` on these two routes is the only thing standing between that
// request and a 500/AI call with garbage bytes, so this test locks in that
// the filter still rejects unsupported image mimetypes with a 400 and a
// specific, non-generic error message via the same global multer error
// handler that production registers in server/index.ts.
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
// global multer error handler that index.ts applies in production. Mirrors
// the pattern in routes.upload-limits.test.ts.
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
// A tiny, structurally-valid BMP header. Its actual pixel bytes don't matter
// — multer's fileFilter rejects it purely based on the reported mimetype,
// before the route handler ever reads the buffer.
// ---------------------------------------------------------------------------
const TINY_BMP = Buffer.from([
  0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00,
  0x00, 0x00,
]);

describe("Upload mimetype rejection — image/* files that aren't jpeg/png/gif/webp", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    app = await buildApp();
  });

  describe("POST /api/tools/alt-text", () => {
    it("rejects an image/bmp upload with a 400 and a specific error message", async () => {
      const res = await request(app)
        .post("/api/tools/alt-text")
        .attach("image", TINY_BMP, {
          filename: "test.bmp",
          contentType: "image/bmp",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe(
        "Only JPEG, PNG, GIF, and WebP images are supported",
      );
    });
  });

  describe("POST /api/tools/math-ocr", () => {
    it("rejects an image/bmp upload with a 400 and a specific error message", async () => {
      const res = await request(app)
        .post("/api/tools/math-ocr")
        .attach("image", TINY_BMP, {
          filename: "test.bmp",
          contentType: "image/bmp",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe(
        "Only JPEG, PNG, GIF, and WebP images are supported",
      );
    });
  });
});
