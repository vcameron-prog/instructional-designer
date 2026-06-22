import { pool } from "../db";

interface ColumnSpec {
  table: string;
  column: string;
}

/**
 * Columns that are known to have been added after the initial schema and are
 * required for core functionality.  Extend this list whenever a new column is
 * added that could cause 500 errors if it is absent in production.
 */
const CRITICAL_COLUMNS: ColumnSpec[] = [
  // conversions – added progressively as features were built
  { table: "conversions", column: "source_type" },
  { table: "conversions", column: "pdf_data" },
  { table: "conversions", column: "manual_fix_items" },
  { table: "conversions", column: "ocr_applied" },
  { table: "conversions", column: "extraction_warnings" },
  { table: "conversions", column: "selected_sheet" },
  { table: "conversions", column: "processing_started_at" },
  { table: "conversions", column: "original_compliance_report" },
  { table: "conversions", column: "visitor_token" },
  // users – preferences added after initial auth schema
  { table: "users", column: "preferences" },
];

/**
 * Tables that must exist for the application to function.  A missing table
 * almost certainly means migrations were never applied.
 */
const REQUIRED_TABLES = [
  "sessions",
  "users",
  "conversions",
  "ai_fix_retry_events",
  "rate_limit_log",
  "app_metrics",
];

type LogFn = (message: string, source?: string) => void;

export async function checkDbSchema(log: LogFn = (msg) => console.log(msg)): Promise<void> {
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  try {
    client = await pool.connect();
    // ── 1. Check required tables ──────────────────────────────────────────
    const tableResult = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type   = 'BASE TABLE'`
    );
    const existingTables = new Set(tableResult.rows.map((r) => r.table_name));

    const missingTables = REQUIRED_TABLES.filter((t) => !existingTables.has(t));
    if (missingTables.length > 0) {
      log(
        `[schema-check] ⚠️  MISSING TABLES detected — migrations may not have been applied.\n` +
          `  Missing: ${missingTables.join(", ")}\n` +
          `  Run "npm run db:migrate" before starting the server.`,
        "startup"
      );
    }

    // ── 2. Check critical columns ─────────────────────────────────────────
    const columnResult = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'`
    );

    const existingColumns = new Set(
      columnResult.rows.map((r) => `${r.table_name}.${r.column_name}`)
    );

    const missingColumns = CRITICAL_COLUMNS.filter(
      ({ table, column }) =>
        existingTables.has(table) && // only check columns on tables that exist
        !existingColumns.has(`${table}.${column}`)
    );

    if (missingColumns.length > 0) {
      const formatted = missingColumns
        .map(({ table, column }) => `  • ${table}.${column}`)
        .join("\n");
      log(
        `[schema-check] ⚠️  MISSING COLUMNS detected — these columns are required but absent in the database.\n` +
          `  Affected column(s):\n${formatted}\n` +
          `  Run "npm run db:migrate" to apply pending migrations.`,
        "startup"
      );
    }

    if (missingTables.length === 0 && missingColumns.length === 0) {
      log("[schema-check] All required tables and columns verified ✓", "startup");
    }
  } catch (err) {
    // A failure here should never crash the server — just warn.
    log(
      `[schema-check] Could not verify database schema: ${(err as Error).message}`,
      "startup"
    );
  } finally {
    client?.release();
  }
}
