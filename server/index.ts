import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { trimAllOversizedVersions } from "./lib/trimVersions";
import { scheduleDailySummary } from "./lib/daily-summary";
import { clearRateLimiterIntervals, initRateLimitCleanupMetrics } from "./lib/rateLimiters.js";
import { db, pool } from "./db";
import { eq } from "drizzle-orm";
import { conversions } from "../shared/schema";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { checkMigrationDrift } from "./lib/migrationCheck";
import path from "path";

const app = express();
const httpServer = createServer(app);

function handleShutdown(signal: string): void {
  log(`Received ${signal}, shutting down gracefully`, "shutdown");
  clearRateLimiterIntervals();
  process.exit(0);
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      log(logLine);
    }
  });

  next();
});

async function runMigrations() {
  const migrationsFolder = path.resolve(process.cwd(), "migrations");
  const isProduction = process.env.NODE_ENV === "production";

  // ── Migration drift check ────────────────────────────────────────────────
  // Before applying, compare the journal against the DB so we can surface
  // unapplied migrations with a clear, actionable message rather than letting
  // the first bad query blow up with a cryptic column-not-found error.
  let driftResult;
  try {
    driftResult = await checkMigrationDrift(pool);
  } catch (err) {
    log(
      "[migration] WARNING: could not check migration drift — " +
        "proceeding to apply (check DB connectivity if this repeats)",
      "startup",
    );
    console.error(err);
  }

  if (driftResult && driftResult.pending.length > 0) {
    const list = driftResult.pending.map((t) => `  • ${t}`).join("\n");
    const summary =
      `[migration] ${driftResult.pending.length} unapplied migration(s) detected ` +
      `(${driftResult.applied} of ${driftResult.expected.length} applied):\n${list}`;

    if (isProduction) {
      console.error(
        "\n" +
          "╔══════════════════════════════════════════════════════════════╗\n" +
          "║  FATAL: unapplied database migrations in production          ║\n" +
          "╚══════════════════════════════════════════════════════════════╝\n" +
          summary +
          "\n\nRun `npm run db:push` (or apply the migration files manually)\n" +
          "before starting the server in production.\n",
      );
      process.exit(1);
    } else {
      log(
        "[migration] WARNING: " +
          summary +
          " — auto-applying now (dev mode)",
        "startup",
      );
    }
  } else if (driftResult) {
    log(
      `[migration] All ${driftResult.expected.length} migration(s) are up to date`,
      "startup",
    );
  }
  // ── End drift check ──────────────────────────────────────────────────────

  try {
    await migrate(db, { migrationsFolder });
    log("Database migrations applied successfully", "startup");
  } catch (err) {
    console.error("Database migration failed:", err);
    throw err;
  }
}

function validateThresholdEnvVar(key: string, parser: (v: string) => number, defaultVal: number, label: string): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultVal;
  const parsed = parser(raw);
  if (isNaN(parsed)) {
    log(
      `[config] WARNING: ${key}="${raw}" is not a valid number — using default ${defaultVal} for ${label}`,
      "startup",
    );
    return defaultVal;
  }
  return parsed;
}

function validateThresholdEnvVars() {
  const warnCount    = validateThresholdEnvVar("RETRY_WARN_COUNT",    (v) => parseInt(v, 10),  10,   "warn count");
  const warnRate     = validateThresholdEnvVar("RETRY_WARN_RATE",     parseFloat,              0.05, "warn rate");
  const criticalCount = validateThresholdEnvVar("RETRY_CRITICAL_COUNT", (v) => parseInt(v, 10), 25,  "critical count");
  const criticalRate  = validateThresholdEnvVar("RETRY_CRITICAL_RATE",  parseFloat,             0.10, "critical rate");

  if (warnCount >= criticalCount) {
    log(
      `[config] WARNING: RETRY_WARN_COUNT (${warnCount}) should be less than RETRY_CRITICAL_COUNT (${criticalCount})`,
      "startup",
    );
  }
  if (warnRate >= criticalRate) {
    log(
      `[config] WARNING: RETRY_WARN_RATE (${warnRate}) should be less than RETRY_CRITICAL_RATE (${criticalRate})`,
      "startup",
    );
  }
}

async function resetStaleProcessingJobs() {
  try {
    const result = await db
      .update(conversions)
      .set({
        status: "failed",
        statusMessage: null,
        errorMessage: "Conversion interrupted by server restart. Please try again.",
        updatedAt: new Date(),
      })
      .where(eq(conversions.status, "processing"));
    const count = (result as any).rowCount ?? (result as any).count ?? 0;
    if (count > 0) {
      log(`Reset ${count} stale processing job(s) to failed`, "startup");
    }
  } catch (err) {
    console.error("Failed to reset stale processing jobs:", err);
  }
}

(async () => {
  // Validate threshold env vars early so misconfigurations are surfaced immediately
  validateThresholdEnvVars();

  // Apply any pending schema migrations before starting
  await runMigrations();

  // Mark any conversions left in "processing" state (e.g. from a previous crash/deploy) as failed
  await resetStaleProcessingJobs();

  // Seed in-memory rate-limit cleanup metrics from the DB so counters survive restarts
  await initRateLimitCleanupMetrics();

  // Seed database with sample data
  await seedDatabase();

  // Enforce version history limit on any pre-existing oversized rows
  await trimAllOversizedVersions();

  // Schedule the daily health summary email (7am ET by default)
  scheduleDailySummary();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    // Handle multer upload limit errors with descriptive HTTP status codes
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Please check the maximum allowed upload size for this operation." });
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: "Invalid file upload request." });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
