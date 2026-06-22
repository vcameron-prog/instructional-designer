import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "fs";
import path from "path";
import { db, pool } from "../db";
import { checkMigrationDrift } from "./migrationCheck";

function log(message: string) {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [startup] ${message}`);
}

export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(process.cwd(), "migrations");
  const isProduction = process.env.NODE_ENV === "production";

  let driftResult;
  try {
    driftResult = await checkMigrationDrift(pool);
  } catch (err) {
    log(
      "[migration] WARNING: could not check migration drift — " +
        "proceeding to apply (check DB connectivity if this repeats)",
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
        `\n[migration] FATAL: ${summary}\n\n` +
          `Production startup aborted. Run migrations before deploying:\n` +
          `  npm run db:migrate\n`,
      );
      process.exit(1);
    }

    log(
      "[migration] WARNING: " +
        summary +
        " — auto-applying now (dev only)",
    );
  } else if (driftResult) {
    log(
      `[migration] All ${driftResult.expected.length} migration(s) are up to date`,
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
        `[migration] FATAL: the following journal entries have no matching SQL file on disk:\n${list}\n\n` +
        `This means the journal is out of sync with the migrations/ directory.\n` +
        `To fix: either create the missing SQL file(s) or remove the phantom entry/entries\n` +
        `from migrations/meta/_journal.json and re-run the migration generator.`;
      console.error("\n" + message + "\n");
      process.exit(1);
    }
  }

  try {
    await migrate(db, { migrationsFolder });
    log("Database migrations applied successfully");
  } catch (err) {
    console.error("Database migration failed:", err);
    throw err;
  }
}
