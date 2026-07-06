import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockCreate, mockRecordAltTextParseFail } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRecordAltTextParseFail: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton
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
    updateContent: vi.fn(),
    createVersion: vi.fn(),
    pruneOldVersions: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    getUserPreferences: vi.fn(),
    setUserPreferences: vi.fn(),
    getSavedOutcomes: vi.fn(),
    createSavedOutcome: vi.fn(),
    updateSavedOutcome: vi.fn(),
    deleteSavedOutcome: vi.fn(),
    getConversionsByUser: vi.fn(),
    getConversionById: vi.fn(),
    createConversion: vi.fn(),
    updateConversion: vi.fn(),
    deleteConversion: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "owner-user-123" } };
    next();
  },
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "owner-user-123" } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "owner-user-123" } };
    next();
  },
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// ---------------------------------------------------------------------------
// Mock: db singleton
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Mock: auxiliary helpers
// ---------------------------------------------------------------------------
vi.mock("./markdownTableConverter.js", () => ({
  convertMarkdownTablesToHtml: (html: string) => html,
}));

vi.mock("./lib/table-fixers.js", () => ({
  fixHtmlTableCaption: (html: string) => ({ html, tablesFixed: 0 }),
  fixHtmlTableThead: (html: string) => ({ html, tablesFixed: 0 }),
  editHtmlTableCaption: (html: string) => html,
}));

vi.mock("./lib/accessibility-engine", () => ({
  getDeterministicFixerKeys: () => [],
  getAiFixRetryMetrics: () => ({ count: 0, lastAt: null }),
}));

vi.mock("./lib/altTextMetrics.js", () => ({
  recordAltTextParseFail: mockRecordAltTextParseFail,
}));

// ---------------------------------------------------------------------------
// Helper: build a fresh Express app for each test
// ---------------------------------------------------------------------------
async function buildApp() {
  const { registerRoutes } = await import("./routes.js");
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("POST /api/tools/alt-text", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRecordAltTextParseFail.mockResolvedValue(undefined);
    app = await buildApp();
  });

  it("returns altText and confidence when the first response parses cleanly", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse('{"altText": "A bar chart showing rising sales", "confidence": "High"}'),
    );

    const res = await request(app)
      .post("/api/tools/alt-text")
      .attach("image", Buffer.from("fake-image-bytes"), {
        filename: "chart.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(res.body.altText).toBe("A bar chart showing rising sales");
    expect(res.body.confidence).toBe("High");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRecordAltTextParseFail).not.toHaveBeenCalled();
  });

  it("retries once with a stricter prompt when the first response is unparseable, and succeeds without recording a failure", async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse("Sure! Here's the alt text: a red bicycle."))
      .mockResolvedValueOnce(
        textResponse('{"altText": "A red bicycle leaning against a brick wall", "confidence": "Medium"}'),
      );

    const res = await request(app)
      .post("/api/tools/alt-text")
      .attach("image", Buffer.from("fake-image-bytes"), {
        filename: "bike.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(res.body.altText).toBe("A red bicycle leaning against a brick wall");
    expect(res.body.confidence).toBe("Medium");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockRecordAltTextParseFail).not.toHaveBeenCalled();
  });

  it("falls back to the first raw response and records a parse failure when the retry call itself throws", async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse("Sure! Here's the alt text: a red bicycle."))
      .mockRejectedValueOnce(new Error("network timeout"));

    const res = await request(app)
      .post("/api/tools/alt-text")
      .attach("image", Buffer.from("fake-image-bytes"), {
        filename: "bike.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(res.body.altText).toBe("Sure! Here's the alt text: a red bicycle.");
    expect(res.body.confidence).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockRecordAltTextParseFail).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw response and records a parse failure when both attempts are unparseable", async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse("Sure! Here's the alt text: a red bicycle."))
      .mockResolvedValueOnce(textResponse("Still just prose, no JSON here."));

    const res = await request(app)
      .post("/api/tools/alt-text")
      .attach("image", Buffer.from("fake-image-bytes"), {
        filename: "bike.png",
        contentType: "image/png",
      })
      .expect(200);

    expect(res.body.altText).toBe("Still just prose, no JSON here.");
    expect(res.body.confidence).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockRecordAltTextParseFail).toHaveBeenCalledTimes(1);
  });
});
