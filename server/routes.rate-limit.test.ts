import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.mock factories are hoisted to the top of the file, so
// any variables they capture must be created with vi.hoisted().
// ---------------------------------------------------------------------------
const {
  mockDbTransaction,
  mockDbDelete,
  mockCreateContent,
  mockAnthropicCreate,
  userIdHolder,
} = vi.hoisted(() => ({
  mockDbTransaction: vi.fn(),
  mockDbDelete: vi.fn(),
  mockCreateContent: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  // Mutable holder so individual tests can inject a fresh userId without
  // rebuilding the entire vi.mock factory (which is hoisted and cannot
  // reference a variable from the outer let/const scope).
  userIdHolder: { value: "test-user-rl-default" },
}));

// ---------------------------------------------------------------------------
// Mock: db singleton – gives us full control over transaction behaviour so
// we can simulate different rate-limit counts without a real database.
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  db: {
    transaction: mockDbTransaction,
    delete: mockDbDelete,
  },
}));

// ---------------------------------------------------------------------------
// Mock: storage singleton – only the methods exercised by the routes under
// test need to be provided.
// ---------------------------------------------------------------------------
vi.mock("./storage", () => ({
  storage: {
    createContent: mockCreateContent,
    getAllCourses: vi.fn(),
    getCourse: vi.fn(),
    getContent: vi.fn(),
    getContentByCourse: vi.fn(),
    getApprovedContentByCourse: vi.fn(),
    getStandaloneContent: vi.fn(),
    getStandaloneContentById: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
    duplicateCourse: vi.fn(),
    toggleContentApproval: vi.fn(),
    updateContent: vi.fn(),
    createVersion: vi.fn(),
    getVersionsByContent: vi.fn(),
    getVersionById: vi.fn(),
    pruneOldVersions: vi.fn(),
    getAllSavedContent: vi.fn(),
    getSavedContent: vi.fn(),
    createSavedContent: vi.fn(),
    deleteSavedContent: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Replit auth middleware.
//
// Both isBsuAuthenticated and optionalAuth inject the same synthetic user so
// routes that use either middleware (e.g. /api/generate-standalone uses
// isBsuAuthenticated, /api/conversions/upload uses optionalAuth) all see a
// non-null userId.  Individual tests change userIdHolder.value to isolate
// per-user in-memory rate-limit state.
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  isBsuAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: userIdHolder.value } };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: userIdHolder.value } };
    next();
  },
  getSession: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK – prevents real API calls.
// ---------------------------------------------------------------------------
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
  },
}));

// ---------------------------------------------------------------------------
// Mock: auxiliary helpers not under test
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

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { registerRoutes } from "./routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a stateful mock for db.transaction that simulates the rate_limit_log
 * table.  The mock serialises all calls through a single shared counter so
 * sequential requests correctly accumulate toward the limit.
 *
 * @param initialCount  How many rows already exist for (key, action).
 *
 * The returned `capturedLockSqlJson` array is filled with
 * `JSON.stringify(sqlObj)` for every call to `tx.execute()`, so tests can
 * assert that `pg_advisory_xact_lock` is present even when the SQL object is
 * a Drizzle template (not a plain string).
 */
function makeStatefulTransactionMock(initialCount: number) {
  let count = initialCount;
  const capturedLockSqlJson: string[] = [];

  const transactionMock = vi.fn().mockImplementation(
    async (callback: (tx: any) => Promise<any>) => {
      const tx = {
        execute: vi.fn().mockImplementation(async (sqlObj: any) => {
          capturedLockSqlJson.push(JSON.stringify(sqlObj));
          return undefined;
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(async () => [{ n: count }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation(async () => {
            count++;
            return undefined;
          }),
        }),
      };
      return callback(tx);
    },
  );

  return { transactionMock, capturedLockSqlJson, getCount: () => count };
}

/** Build a minimal Express app with all routes registered. */
async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

/** Minimal valid body for POST /api/generate-standalone. */
const VALID_STANDALONE_BODY = {
  toolId: "assignment",
  toolName: "Assignment",
  formData: { topic: "test" },
};

/** Default Anthropic response used when we want the route to succeed. */
const ANTHROPIC_SUCCESS = {
  content: [{ type: "text", text: "Generated content" }],
};

/** Default storage.createContent response. */
const STORAGE_CONTENT = {
  id: 1,
  content: "Generated content",
  toolName: "Assignment",
  courseId: null,
  userId: "test-user-rl",
};

// Counter used to generate unique per-test userIds (prevents in-memory Map
// state from leaking between describe blocks — the module-level Maps in
// routes.ts are keyed by userId so using a fresh id resets the bucket).
let testCounter = 0;

function freshUserId(prefix = "rl") {
  return `${prefix}-${++testCounter}`;
}

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – limit enforcement
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – limit enforcement", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    userIdHolder.value = freshUserId("enforce");
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockAnthropicCreate.mockResolvedValue(ANTHROPIC_SUCCESS);
    mockCreateContent.mockResolvedValue(STORAGE_CONTENT);
    app = await buildApp();
  });

  it("allows requests when the count is below the limit", async () => {
    const { transactionMock } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    const res = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);

    expect(res.status).toBe(201);
  });

  it("allows the exact limit-th request when count equals limit minus one", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    const { transactionMock } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT - 1);
    mockDbTransaction.mockImplementation(transactionMock);

    const res = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);

    expect(res.status).toBe(201);
  });

  it("returns 429 when the count has already reached the limit", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    const { transactionMock } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT);
    mockDbTransaction.mockImplementation(transactionMock);

    const res = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  it("returns 429 when the count exceeds the limit", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    const { transactionMock } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT + 5);
    mockDbTransaction.mockImplementation(transactionMock);

    const res = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);

    expect(res.status).toBe(429);
  });

  it("increments the stored count on each allowed request", async () => {
    const { transactionMock, getCount } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);
    expect(getCount()).toBe(1);

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);
    expect(getCount()).toBe(2);
  });

  it("enforces the limit sequentially: N successful requests then 429", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;

    // Single shared counter so each successive call sees the accumulated count.
    let count = 0;
    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const snapshot = count;
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: snapshot }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => {
              count++;
            }),
          }),
        };
        return callback(tx);
      },
    );

    // First AI_GEN_RATE_LIMIT requests should all succeed
    for (let i = 0; i < AI_GEN_RATE_LIMIT; i++) {
      const res = await request(app)
        .post("/api/generate-standalone")
        .send(VALID_STANDALONE_BODY);
      expect(res.status).toBe(201);
    }

    // The (AI_GEN_RATE_LIMIT + 1)-th request sees count == limit → denied
    const overLimitRes = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);
    expect(overLimitRes.status).toBe(429);
  });

  it("does NOT insert a new row when the limit is already reached", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    let insertCallCount = 0;

    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: AI_GEN_RATE_LIMIT }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => {
              insertCallCount++;
            }),
          }),
        };
        return callback(tx);
      },
    );

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);
    expect(insertCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – advisory lock is always acquired
//
// These tests act as regression guards: if someone removes the
// pg_advisory_xact_lock call the tests will fail even if the count-check
// logic is otherwise correct.
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – advisory lock is acquired on every transaction", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    userIdHolder.value = freshUserId("lock");
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockAnthropicCreate.mockResolvedValue(ANTHROPIC_SUCCESS);
    mockCreateContent.mockResolvedValue(STORAGE_CONTENT);
    app = await buildApp();
  });

  it("calls pg_advisory_xact_lock for every allowed request", async () => {
    const { transactionMock, capturedLockSqlJson } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);
    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);

    // Each transaction must call tx.execute() once (for the advisory lock).
    expect(capturedLockSqlJson.length).toBeGreaterThanOrEqual(2);
    for (const json of capturedLockSqlJson) {
      expect(json).toContain("pg_advisory_xact_lock");
    }
  });

  it("calls pg_advisory_xact_lock even when the limit has been reached", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    const { transactionMock, capturedLockSqlJson } = makeStatefulTransactionMock(AI_GEN_RATE_LIMIT);
    mockDbTransaction.mockImplementation(transactionMock);

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);

    // Lock must be acquired before the count is read, even for denied requests.
    expect(capturedLockSqlJson.length).toBeGreaterThanOrEqual(1);
    expect(capturedLockSqlJson[0]).toContain("pg_advisory_xact_lock");
  });

  it("includes the composite key (userId:action) in the advisory lock SQL", async () => {
    const { transactionMock, capturedLockSqlJson } = makeStatefulTransactionMock(0);
    mockDbTransaction.mockImplementation(transactionMock);

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);

    expect(capturedLockSqlJson.length).toBeGreaterThanOrEqual(1);
    // The composite lock key embeds both the userId and the action name so
    // different users and different actions use different pg advisory locks.
    const json = capturedLockSqlJson[0];
    expect(json).toContain(userIdHolder.value);
    expect(json).toContain("ai-gen");
  });

  it("uses a different advisory lock key for upload actions vs ai-gen actions", async () => {
    // Both upload and ai-gen calls use pg_advisory_xact_lock but they must
    // produce different hashtext() inputs so they do not block each other.
    const lockKeys: string[] = [];
    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockImplementation(async (sqlObj: any) => {
            lockKeys.push(JSON.stringify(sqlObj));
            return undefined;
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: 0 }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(tx);
      },
    );

    // Trigger an ai-gen rate limit check
    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);

    // Trigger an upload rate limit check via /api/conversions/upload
    // (no file attached → will fail at multer, but rate limit fires first)
    await request(app).post("/api/conversions/upload").field("sourceType", "pdf");

    // We should have at least two lock calls with distinct composite keys
    const aiGenLocks = lockKeys.filter((k) => k.includes("ai-gen"));
    const uploadLocks = lockKeys.filter((k) => k.includes("upload"));
    expect(aiGenLocks.length).toBeGreaterThanOrEqual(1);
    expect(uploadLocks.length).toBeGreaterThanOrEqual(1);
    // The key strings themselves must differ so they hash to different values.
    expect(aiGenLocks[0]).not.toBe(uploadLocks[0]);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – advisory lock precedes the count SELECT
//
// True advisory-lock serialisation requires a live PostgreSQL instance.
// These tests verify the structural invariants that make the strategy correct:
//   1. execute() (advisory lock) is called BEFORE select() (count read).
//   2. insert() happens in the same transaction as the count read.
// Together these guarantee that with a real DB the count + insert is atomic.
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – advisory lock precedes the count SELECT", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    userIdHolder.value = freshUserId("order");
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockAnthropicCreate.mockResolvedValue(ANTHROPIC_SUCCESS);
    mockCreateContent.mockResolvedValue(STORAGE_CONTENT);
    app = await buildApp();
  });

  it("executes execute() before select() inside the transaction callback", async () => {
    const callOrder: string[] = [];

    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockImplementation(async () => {
            callOrder.push("execute");
            return undefined;
          }),
          select: vi.fn().mockImplementation(() => {
            callOrder.push("select");
            return {
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ n: 0 }]),
              }),
            };
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(tx);
      },
    );

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);

    expect(callOrder[0]).toBe("execute");
    expect(callOrder[1]).toBe("select");
  });

  it("only inserts when count < limit (count-check and insert share the same transaction)", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    const insertCalls: number[] = [];

    // First call: count = 0 → insert expected
    mockDbTransaction.mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: 0 }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => {
              insertCalls.push(1);
            }),
          }),
        };
        return callback(tx);
      },
    );

    // Second call: count = limit → no insert
    mockDbTransaction.mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ n: AI_GEN_RATE_LIMIT }]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(async () => {
              insertCalls.push(2);
            }),
          }),
        };
        return callback(tx);
      },
    );

    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);
    await request(app).post("/api/generate-standalone").send(VALID_STANDALONE_BODY);

    expect(insertCalls).toEqual([1]); // only the first (allowed) call inserted
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – DB error fallback to checkAiGenRateLimit
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – DB error falls back to checkAiGenRateLimit", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Use a fresh userId per test so prior in-memory bucket state cannot
    // interfere (the module-level aiGenRateLimits Map is keyed by userId).
    userIdHolder.value = freshUserId("aigenFallback");
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbTransaction.mockRejectedValue(new Error("DB connection refused"));
    mockAnthropicCreate.mockResolvedValue(ANTHROPIC_SUCCESS);
    mockCreateContent.mockResolvedValue(STORAGE_CONTENT);
    app = await buildApp();
  });

  it("allows the request when the DB throws and the in-memory fallback has capacity", async () => {
    const res = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);

    // Falls through to the in-memory fallback; first request should pass.
    expect(res.status).toBe(201);
  });

  it("returns 429 from the in-memory fallback once it is exhausted", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;

    for (let i = 0; i < AI_GEN_RATE_LIMIT; i++) {
      await request(app)
        .post("/api/generate-standalone")
        .send(VALID_STANDALONE_BODY);
    }

    const res = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);

    expect(res.status).toBe(429);
  });

  it("counts exactly AI_GEN_RATE_LIMIT DB-error attempts before denying", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    const statuses: number[] = [];

    for (let i = 0; i < AI_GEN_RATE_LIMIT + 1; i++) {
      const res = await request(app)
        .post("/api/generate-standalone")
        .send(VALID_STANDALONE_BODY);
      statuses.push(res.status);
    }

    const allowed = statuses.filter((s) => s === 201);
    const denied = statuses.filter((s) => s === 429);
    expect(allowed).toHaveLength(AI_GEN_RATE_LIMIT);
    expect(denied).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it("maintains separate in-memory buckets per userId (fresh user gets full quota)", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;

    // Exhaust the in-memory limit for the current userId
    for (let i = 0; i < AI_GEN_RATE_LIMIT; i++) {
      await request(app)
        .post("/api/generate-standalone")
        .send(VALID_STANDALONE_BODY);
    }
    const exhaustedRes = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);
    expect(exhaustedRes.status).toBe(429);

    // Switching to a brand-new userId starts with a fresh bucket
    userIdHolder.value = freshUserId("aigenFallbackFresh");

    const freshRes = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);
    expect(freshRes.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkAiGenRateLimit – standalone in-memory limiter
//
// checkAiGenRateLimit is the process-local fallback for anonymous users and
// for when the DB is unavailable.  We exercise it by making the DB always
// throw, forcing every request onto the in-memory path.
// ---------------------------------------------------------------------------
describe("checkAiGenRateLimit – in-memory per-user AI-gen rate limiter", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Fresh userId per test to start with an empty in-memory bucket.
    userIdHolder.value = freshUserId("aiGenInMem");
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbTransaction.mockRejectedValue(new Error("DB unavailable"));
    mockAnthropicCreate.mockResolvedValue(ANTHROPIC_SUCCESS);
    mockCreateContent.mockResolvedValue(STORAGE_CONTENT);
    app = await buildApp();
  });

  it("allows the first request when the bucket is empty", async () => {
    const res = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);
    expect(res.status).toBe(201);
  });

  it("allows exactly AI_GEN_RATE_LIMIT requests before returning 429", async () => {
    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;

    const statuses: number[] = [];
    for (let i = 0; i < AI_GEN_RATE_LIMIT + 1; i++) {
      const res = await request(app)
        .post("/api/generate-standalone")
        .send(VALID_STANDALONE_BODY);
      statuses.push(res.status);
    }

    const successes = statuses.filter((s) => s === 201);
    const rateLimited = statuses.filter((s) => s === 429);

    expect(successes).toHaveLength(AI_GEN_RATE_LIMIT);
    expect(rateLimited).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkUploadRateLimit – standalone in-memory limiter
//
// The upload rate limit fires on /api/conversions/upload via the
// uploadRateLimitGuard middleware (before multer buffers the body).
// We make the DB fail to force every request onto the in-memory path.
// ---------------------------------------------------------------------------
describe("checkUploadRateLimit – in-memory per-user upload rate limiter", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Fresh userId per test to start with an empty in-memory bucket.
    userIdHolder.value = freshUserId("uploadInMem");
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbTransaction.mockRejectedValue(new Error("DB unavailable"));
    app = await buildApp();
  });

  it("allows the first upload when the bucket is empty", async () => {
    // The rate limit guard fires BEFORE multer buffers the body, so even a
    // request with no attached file will pass the rate limit gate first.
    // A non-429 response confirms the gate allowed the request through.
    const res = await request(app)
      .post("/api/conversions/upload")
      .field("sourceType", "pdf");

    expect(res.status).not.toBe(429);
  });

  it("returns 429 after UPLOAD_RATE_LIMIT uploads are exhausted (via in-memory fallback)", async () => {
    const UPLOAD_RATE_LIMIT = parseInt(process.env.UPLOAD_RATE_LIMIT ?? "30", 10) || 30;

    for (let i = 0; i < UPLOAD_RATE_LIMIT; i++) {
      await request(app)
        .post("/api/conversions/upload")
        .field("sourceType", "pdf");
    }

    const res = await request(app)
      .post("/api/conversions/upload")
      .field("sourceType", "pdf");

    expect(res.status).toBe(429);
  });

  it("maintains separate in-memory buckets per userId (fresh user gets full quota)", async () => {
    const UPLOAD_RATE_LIMIT = parseInt(process.env.UPLOAD_RATE_LIMIT ?? "30", 10) || 30;

    // Exhaust the upload limit for the current user
    for (let i = 0; i < UPLOAD_RATE_LIMIT; i++) {
      await request(app)
        .post("/api/conversions/upload")
        .field("sourceType", "pdf");
    }
    const exhaustedRes = await request(app)
      .post("/api/conversions/upload")
      .field("sourceType", "pdf");
    expect(exhaustedRes.status).toBe(429);

    // A brand-new user starts with a fresh bucket
    userIdHolder.value = freshUserId("uploadInMemFresh");

    const freshRes = await request(app)
      .post("/api/conversions/upload")
      .field("sourceType", "pdf");
    expect(freshRes.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkSharedRateLimit – key isolation across users
//
// Two different userId values must not share a rate-limit budget in the DB
// (or the in-memory fallback).  We verify this by making the DB return
// different counts depending on which userId is in the lock-key SQL.
// ---------------------------------------------------------------------------
describe("checkSharedRateLimit – different users are isolated", () => {
  it("denies user-A but allows user-B when user-A is at the limit", async () => {
    vi.clearAllMocks();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockAnthropicCreate.mockResolvedValue(ANTHROPIC_SUCCESS);
    mockCreateContent.mockResolvedValue(STORAGE_CONTENT);

    const AI_GEN_RATE_LIMIT = parseInt(process.env.AI_GEN_RATE_LIMIT ?? "20", 10) || 20;
    const userA = freshUserId("isolationA");
    const userB = freshUserId("isolationB");

    // Mock the transaction to return different counts based on which userId
    // appears in the advisory lock SQL (which embeds the composite key).
    const capturedLockKeys: string[] = [];
    mockDbTransaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        let lockKey = "";
        const tx = {
          execute: vi.fn().mockImplementation(async (sqlObj: any) => {
            lockKey = JSON.stringify(sqlObj);
            capturedLockKeys.push(lockKey);
            return undefined;
          }),
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(async () => {
                // user-A is at the limit; user-B has capacity
                const isUserA = lockKey.includes(userA);
                return [{ n: isUserA ? AI_GEN_RATE_LIMIT : 0 }];
              }),
            }),
          })),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(tx);
      },
    );

    const app = express();
    app.use(express.json());
    await registerRoutes(createServer(app), app);

    // user-A at the limit → 429
    userIdHolder.value = userA;
    const resA = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);
    expect(resA.status).toBe(429);

    // user-B is fresh → 201
    userIdHolder.value = userB;
    const resB = await request(app)
      .post("/api/generate-standalone")
      .send(VALID_STANDALONE_BODY);
    expect(resB.status).toBe(201);

    // Both users produced distinct advisory lock key strings
    const aLocks = capturedLockKeys.filter((k) => k.includes(userA));
    const bLocks = capturedLockKeys.filter((k) => k.includes(userB));
    expect(aLocks.length).toBeGreaterThan(0);
    expect(bLocks.length).toBeGreaterThan(0);
  });
});
