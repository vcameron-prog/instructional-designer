import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { trimAllOversizedVersions } from "./lib/trimVersions";
import { scheduleDailySummary } from "./lib/daily-summary";
import { clearRateLimiterIntervals, initRateLimitCleanupMetrics } from "./lib/rateLimiters.js";
import { initAltTextParseFailMetrics } from "./lib/altTextMetrics.js";
import { db, pool } from "./db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { checkMigrationDrift } from "./lib/migrationCheck";
import path from "path";
import fs from "fs";

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

  let driftResult;
  try {
    driftResult = await checkMigrationDrift(pool);
  } catch (err) {
    log(
      "[migration] WARNING: could not check migration drift — proceeding to apply",
      "startup",
    );
    console.error(err);
  }

  if (driftResult && driftResult.pending.length > 0) {
    const list = driftResult.pending.map((t) => `  • ${t}`).join("\n");
    log(
      `[migration] WARNING: ${driftResult.pending.length} unapplied migration(s) detected — auto-applying now:\n${list}`,
      "startup",
    );
  } else if (driftResult) {
    log(
      `[migration] All ${driftResult.expected.length} migration(s) are up to date`,
      "startup",
    );
  }

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (fs.existsSync(journalPath)) {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const phantomEntries = journal.entries.filter(
      (entry) => !fs.existsSync(path.join(migrationsFolder, `${entry.tag}.sql`)),
    );
    if (phantomEntries.length > 0) {
      const list = phantomEntries.map((e) => `  • ${e.tag}.sql (idx ${e.idx})`).join("\n");
      const message =
        `[migration] FATAL: the following journal entries have no matching SQL file:\n${list}\n\n` +
        `Fix: create the missing SQL file(s) or remove phantom entries from _journal.json.`;
      console.error("\n" + message + "\n");
      process.exit(1);
    }
  }

  try {
    await migrate(db, { migrationsFolder });
    log("Database migrations applied successfully", "startup");
  } catch (err) {
    console.error("Database migration failed:", err);
    throw err;
  }
}

(async () => {
  await runMigrations();

  await initRateLimitCleanupMetrics();

  await initAltTextParseFailMetrics();

  await seedDatabase();

  await trimAllOversizedVersions();

  scheduleDailySummary();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

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
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5001", 10);
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
