import { getTableColumns, getTableName } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import { pool } from "../db";
import * as schema from "../../shared/schema";

interface ColumnSpec {
  table: string;
  column: string;
}

/**
 * Returns true when `val` is a Drizzle PgTable object.
 * Drizzle marks every table with the well-known symbol
 * `drizzle:IsDrizzleTable` so we can safely filter them
 * out of a wildcard schema import without importing the
 * concrete class.
 */
function isPgTable(val: unknown): val is PgTable {
  return (
    val !== null &&
    typeof val === "object" &&
    (val as Record<symbol, unknown>)[Symbol.for("drizzle:IsDrizzleTable")] === true
  );
}

/**
 * Derives the full list of expected `{table, column}` pairs directly from the
 * Drizzle schema objects.  Any column added to `shared/schema.ts` (or the
 * auth models it re-exports) is automatically included — no manual list to
 * maintain.
 */
function schemaColumns(): ColumnSpec[] {
  const specs: ColumnSpec[] = [];
  for (const val of Object.values(schema)) {
    if (!isPgTable(val)) continue;
    const tableName = getTableName(val as PgTable);
    const cols = getTableColumns(val as PgTable);
    for (const col of Object.values(cols)) {
      specs.push({ table: tableName, column: col.name });
    }
  }
  return specs;
}

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
  let client: PoolClient | undefined;
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

    // ── 2. Check all schema-defined columns ───────────────────────────────
    // The column list is derived at runtime from the Drizzle table objects in
    // shared/schema.ts, so it stays in sync automatically whenever the schema
    // changes.
    const columnResult = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'`
    );

    const existingColumns = new Set(
      columnResult.rows.map((r) => `${r.table_name}.${r.column_name}`)
    );

    const expectedColumns = schemaColumns();
    const missingColumns = expectedColumns.filter(
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
