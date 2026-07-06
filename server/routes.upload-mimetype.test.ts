import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Regression coverage for the server-side upload rejection path on the
// /api/tools/alt-text and /api/tools/math-ocr routes.
//
// The client already blocks obviously-wrong file types before ever hitting
// the network (see the "wrong file type" e2e coverage in
// e2e/accessibility-quick-tools.spec.ts), but a file whose *reported*
// mimetype starts with "image/" — e.g. "image/bmp" or "image/svg+xml" —
// passes that client-side `f.type.startsWith("image/")` check and reaches
// the server. The multer `fileFilter` on these two routes is the only thing
// standing between that request and a 500/AI call with garbage bytes, so
// this test locks in that the filter still rejects unsupported image
// mimetypes with a 400 and a specific, non-generic error message.
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

vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  getSession: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
  fixDuplicateTableCaptions: (html: string) => html,
}));

vi.mock("./lib/rateLimiters.js", () => ({
  checkSharedRateLimit: vi.fn().mockResolvedValue(true),
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
}));

vi.mock("./db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// A tiny, structurally-valid BMP header. Its actual pixel bytes don't matter
// — multer's fileFilter rejects it purely based on the reported mimetype,
// before the route handler ever reads the buffer.
// ---------------------------------------------------------------------------
const TINY_BMP = Buffer.from([
  0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00,
  0x00, 0x00,
]);

async function buildApp() {
  const { registerRoutes } = await import("./routes.js");
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

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
