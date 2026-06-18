import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { trimAllOversizedVersions } from "./lib/trimVersions";
import { scheduleDailySummary } from "./lib/daily-summary";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { conversions } from "../shared/schema";

const app = express();
const httpServer = createServer(app);

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

async function runStartupMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE conversions ADD COLUMN IF NOT EXISTS visitor_token varchar;
    `);
    await db.execute(sql`
      ALTER TABLE saved_content ADD COLUMN IF NOT EXISTS user_id varchar NOT NULL DEFAULT '';
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_metrics (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        last_at TIMESTAMPTZ
      );
    `);
    log("Startup migrations applied successfully", "startup");
  } catch (err) {
    console.error("Startup migration failed:", err);
    throw err;
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
  // Apply any pending schema migrations before starting
  await runStartupMigrations();

  // Mark any conversions left in "processing" state (e.g. from a previous crash/deploy) as failed
  await resetStaleProcessingJobs();

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
