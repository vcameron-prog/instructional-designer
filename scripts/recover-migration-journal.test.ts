/**
 * Integration-style tests for the migration-journal recovery logic.
 *
 * These tests exercise recoverMigrationJournal() with:
 *  - a lightweight in-memory fake pg client (no real database needed), and
 *  - a mocked `fs` module so we control which SQL files and journal exist.
 *
 * Scenarios covered:
 *  1. Duplicate row (same hash, older created_at) is removed; the survivor's
 *     created_at is aligned to the journal `when`.
 *  2. A second recovery run on an already-clean table is a no-op (idempotent).
 *  3. Two journal entries with identical SQL hashes → both rows are left
 *     untouched and a WARNING is emitted.
 *  4. An orphan row (hash not in any journal entry) is removed.
 *  5. A missing migration (hash absent from DB) is run and recorded.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import path from "path";

// ── fs mock ──────────────────────────────────────────────────────────────────
vi.mock("fs");
import fs from "fs";

// ── SUT ──────────────────────────────────────────────────────────────────────
import { recoverMigrationJournal } from "../server/lib/recoverMigrationJournal.js";
import type { MigrationDbClient } from "../server/lib/recoverMigrationJournal.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = "/fake/migrations";
const JOURNAL_PATH = `${MIGRATIONS_DIR}/meta/_journal.json`;

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makeJournal(
  entries: Array<{ idx: number; tag: string; when: number; sql?: string }>,
): string {
  return JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: entries.map(({ idx, tag, when }) => ({
      idx,
      version: "7",
      when,
      tag,
      breakpoints: true,
    })),
  });
}

type DbRow = { id: number; hash: string; created_at: string | null };

/**
 * Builds an in-memory fake pg client backed by a mutable rows array.
 * Only the SQL patterns emitted by recoverMigrationJournal are handled;
 * anything else is accepted as a no-op (DDL guards, migration SQL).
 */
function makeFakeClient(initialRows: DbRow[]): {
  client: MigrationDbClient;
  getRows: () => DbRow[];
  executedStatements: string[];
} {
  let rows: DbRow[] = [...initialRows];
  let nextId = Math.max(0, ...initialRows.map((r) => r.id)) + 1;
  const executedStatements: string[] = [];

  const client: MigrationDbClient = {
    async query<R extends Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: R[] }> {
      const normalized = sql.replace(/\s+/g, " ").trim();

      // SELECT tracking rows
      if (normalized.includes("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations")) {
        return { rows: rows as unknown as R[] };
      }

      // DELETE by ids array
      if (normalized.startsWith("DELETE FROM drizzle.__drizzle_migrations WHERE id = ANY")) {
        const ids = params![0] as number[];
        rows = rows.filter((r) => !ids.includes(r.id));
        return { rows: [] as R[] };
      }

      // UPDATE created_at
      if (normalized.startsWith("UPDATE drizzle.__drizzle_migrations SET created_at")) {
        const [when, id] = params as [number, number];
        rows = rows.map((r) =>
          r.id === id ? { ...r, created_at: String(when) } : r,
        );
        return { rows: [] as R[] };
      }

      // INSERT new tracking row
      if (normalized.startsWith("INSERT INTO drizzle.__drizzle_migrations (hash, created_at)")) {
        const [hash, created_at] = params as [string, number];
        rows.push({ id: nextId++, hash, created_at: String(created_at) });
        return { rows: [] as R[] };
      }

      // DDL / migration SQL — record for assertion but otherwise no-op
      executedStatements.push(normalized);
      return { rows: [] as R[] };
    },
  };

  return { client, getRows: () => rows, executedStatements };
}

/**
 * Configures vi.mocked(fs) so that:
 *  - `journalPath` returns the given journal JSON
 *  - each entry's `.sql` file returns the provided SQL content
 *    (default: a unique deterministic string so hashes differ)
 */
function setupFsMock(
  entries: Array<{ tag: string; when: number; sql?: string }>,
): Array<{ tag: string; when: number; hash: string; sql: string }> {
  const resolved = entries.map((e, i) => {
    const sql = e.sql ?? `-- migration ${i}\nSELECT ${i};`;
    return { tag: e.tag, when: e.when, sql, hash: sha256(sql) };
  });

  vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
    const s = String(p);
    if (s === JOURNAL_PATH) return true;
    return resolved.some((e) => s.endsWith(`${e.tag}.sql`));
  });

  vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number) => {
    const s = String(p);
    if (s === JOURNAL_PATH) {
      return makeJournal(resolved.map((e, i) => ({ idx: i, tag: e.tag, when: e.when })));
    }
    const entry = resolved.find((e) => s.endsWith(`${e.tag}.sql`));
    if (entry) return entry.sql;
    throw new Error(`ENOENT: ${s}`);
  });

  return resolved;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("recoverMigrationJournal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // ── 1. Duplicate row deduplication ────────────────────────────────────────
  describe("when the tracking table has a duplicate row for the same hash", () => {
    it("removes the older duplicate, keeps the newest row, and aligns created_at to the journal when", async () => {
      const entries = setupFsMock([
        { tag: "0000_initial", when: 1_800_000_000_000 },
        { tag: "0001_add_users", when: 1_800_000_001_000 },
      ]);

      // Simulate: 0001_add_users tracked twice — first with an older timestamp
      // (the original applied timestamp), then again after a journal `when`
      // correction caused drizzle-kit to re-apply it.
      const initialRows: DbRow[] = [
        { id: 1, hash: entries[0].hash, created_at: String(entries[0].when) },
        { id: 2, hash: entries[1].hash, created_at: "1_700_000_000_000" }, // older row
        { id: 3, hash: entries[1].hash, created_at: String(entries[1].when) }, // newer row
      ];

      const { client, getRows } = makeFakeClient(initialRows);

      const result = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);

      const finalRows = getRows();

      // Exactly one row per hash
      const hashCounts = new Map<string, number>();
      for (const r of finalRows) {
        hashCounts.set(r.hash, (hashCounts.get(r.hash) ?? 0) + 1);
      }
      for (const [, count] of hashCounts) {
        expect(count).toBe(1);
      }

      // The duplicate (id=2, older) was removed
      expect(finalRows.map((r) => r.id)).not.toContain(2);
      // The newer row (id=3) was kept
      expect(finalRows.map((r) => r.id)).toContain(3);

      // The survivor's created_at matches the journal `when`
      const survivorRow = finalRows.find((r) => r.hash === entries[1].hash)!;
      expect(Number(survivorRow.created_at)).toBe(entries[1].when);

      // Result counters are accurate
      expect(result.duplicatesRemoved).toBe(1);
      expect(result.orphansRemoved).toBe(0);
      expect(result.recovered).toBe(0);
    });

    it("removes ALL older duplicates when more than two rows share the same hash", async () => {
      const entries = setupFsMock([{ tag: "0000_initial", when: 1_800_000_000_000 }]);

      // Three rows for the same hash (the script was run twice after two
      // different journal timestamp corrections)
      const initialRows: DbRow[] = [
        { id: 1, hash: entries[0].hash, created_at: "1_000_000_000_000" },
        { id: 2, hash: entries[0].hash, created_at: "1_500_000_000_000" },
        { id: 3, hash: entries[0].hash, created_at: String(entries[0].when) },
      ];

      const { client, getRows } = makeFakeClient(initialRows);
      const result = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);

      const finalRows = getRows();
      expect(finalRows).toHaveLength(1);
      expect(finalRows[0].id).toBe(3); // newest kept
      expect(result.duplicatesRemoved).toBe(2);
    });
  });

  // ── 2. Idempotency ────────────────────────────────────────────────────────
  describe("when recovery is run a second time on an already-clean table", () => {
    it("is a no-op (all counters are zero)", async () => {
      const entries = setupFsMock([
        { tag: "0000_initial", when: 1_800_000_000_000 },
        { tag: "0001_add_users", when: 1_800_000_001_000 },
      ]);

      // Already-clean state: one row per hash, created_at matching journal
      const cleanRows: DbRow[] = entries.map((e, i) => ({
        id: i + 1,
        hash: e.hash,
        created_at: String(e.when),
      }));

      const { client, getRows } = makeFakeClient(cleanRows);

      // First call (should be a no-op since state is already clean)
      const result1 = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);
      expect(result1).toEqual({ orphansRemoved: 0, duplicatesRemoved: 0, realigned: 0, recovered: 0 });

      // Table is unchanged
      expect(getRows()).toHaveLength(cleanRows.length);
      expect(getRows().map((r) => r.id)).toEqual(cleanRows.map((r) => r.id));

      // Second call — should also be a no-op
      const result2 = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);
      expect(result2).toEqual({ orphansRemoved: 0, duplicatesRemoved: 0, realigned: 0, recovered: 0 });
      expect(getRows()).toHaveLength(cleanRows.length);
    });

    it("is a no-op even after previously deduplicating a table", async () => {
      const entries = setupFsMock([
        { tag: "0000_initial", when: 1_800_000_000_000 },
        { tag: "0001_add_users", when: 1_800_000_001_000 },
      ]);

      const initialRows: DbRow[] = [
        { id: 1, hash: entries[0].hash, created_at: String(entries[0].when) },
        { id: 2, hash: entries[1].hash, created_at: "1_600_000_000_000" }, // old dup
        { id: 3, hash: entries[1].hash, created_at: String(entries[1].when) }, // newer
      ];

      const { client, getRows } = makeFakeClient(initialRows);

      // First run — should deduplicate
      const result1 = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);
      expect(result1.duplicatesRemoved).toBe(1);

      // Second run on the now-clean state — should be a no-op
      const result2 = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);
      expect(result2).toEqual({ orphansRemoved: 0, duplicatesRemoved: 0, realigned: 0, recovered: 0 });
      expect(getRows()).toHaveLength(2); // one per migration
    });
  });

  // ── 3. Ambiguous hash (two journal entries with identical SQL) ────────────
  describe("when two journal entries produce the same SQL hash", () => {
    it("leaves both rows untouched and emits a warning", async () => {
      const sharedSql = "SELECT 1; -- identical";
      const sharedHash = sha256(sharedSql);

      // Two journal entries, different tags, same SQL content → same hash
      const entries = setupFsMock([
        { tag: "0000_dup_a", when: 1_800_000_000_000, sql: sharedSql },
        { tag: "0001_dup_b", when: 1_800_000_001_000, sql: sharedSql },
      ]);

      // Both are tracked (two rows with same hash)
      const initialRows: DbRow[] = [
        { id: 1, hash: sharedHash, created_at: String(entries[0].when) },
        { id: 2, hash: sharedHash, created_at: String(entries[1].when) },
      ];

      const warnSpy = vi.mocked(console.warn);
      const { client, getRows } = makeFakeClient(initialRows);

      const result = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);

      // Both rows still present
      const finalRows = getRows();
      expect(finalRows).toHaveLength(2);
      expect(finalRows.map((r) => r.id)).toEqual(expect.arrayContaining([1, 2]));

      // No duplicates removed
      expect(result.duplicatesRemoved).toBe(0);

      // A warning was logged
      expect(warnSpy).toHaveBeenCalledOnce();
      const warnText = warnSpy.mock.calls[0].join(" ");
      expect(warnText).toMatch(/WARNING/);
      expect(warnText).toMatch(/multiple/i);
    });
  });

  // ── 4. Orphan row removal ─────────────────────────────────────────────────
  describe("when the tracking table has an orphan row", () => {
    it("removes the orphan (hash absent from all current migration files)", async () => {
      const entries = setupFsMock([{ tag: "0000_initial", when: 1_800_000_000_000 }]);

      const orphanHash = "deadbeef".repeat(8); // 64 hex chars, no matching SQL file
      const initialRows: DbRow[] = [
        { id: 1, hash: entries[0].hash, created_at: String(entries[0].when) },
        { id: 2, hash: orphanHash, created_at: "1_700_000_000_000" },
      ];

      const { client, getRows } = makeFakeClient(initialRows);
      const result = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);

      const finalRows = getRows();
      expect(finalRows.map((r) => r.id)).not.toContain(2);
      expect(result.orphansRemoved).toBe(1);
    });
  });

  // ── 5. Forward recovery (missing migration) ───────────────────────────────
  describe("when a journal entry has no corresponding tracking row", () => {
    it("runs the migration SQL and inserts a tracking row", async () => {
      const entries = setupFsMock([
        { tag: "0000_initial", when: 1_800_000_000_000 },
        { tag: "0001_add_users", when: 1_800_000_001_000 },
      ]);

      // Only the first migration is tracked; the second is missing
      const initialRows: DbRow[] = [
        { id: 1, hash: entries[0].hash, created_at: String(entries[0].when) },
      ];

      const { client, getRows, executedStatements } = makeFakeClient(initialRows);
      const result = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);

      const finalRows = getRows();
      // Second migration is now tracked
      expect(finalRows).toHaveLength(2);
      expect(finalRows.some((r) => r.hash === entries[1].hash)).toBe(true);
      expect(result.recovered).toBe(1);

      // The SQL content was "executed" (reached the client)
      const ran = executedStatements.some((s) =>
        s.includes(entries[1].sql.replace(/\s+/g, " ").trim()),
      );
      expect(ran).toBe(true);
    });
  });

  // ── 6. created_at alignment without duplicates ────────────────────────────
  describe("when a row's created_at does not match the journal when", () => {
    it("realigns created_at to match the journal when", async () => {
      const entries = setupFsMock([{ tag: "0000_initial", when: 1_800_000_000_000 }]);

      // Row exists but has a stale timestamp (e.g. old drizzle default)
      const initialRows: DbRow[] = [
        { id: 1, hash: entries[0].hash, created_at: "1_600_000_000_000" },
      ];

      const { client, getRows } = makeFakeClient(initialRows);
      const result = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);

      const finalRows = getRows();
      expect(Number(finalRows[0].created_at)).toBe(entries[0].when);
      expect(result.realigned).toBe(1);
      expect(result.duplicatesRemoved).toBe(0);
    });
  });

  // ── 7. No journal file ────────────────────────────────────────────────────
  describe("when no journal file exists", () => {
    it("returns all-zero counters without touching the database", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // The client query should never be called for the migrations table
      const querySpy = vi.fn().mockResolvedValue({ rows: [] });
      const client: MigrationDbClient = { query: querySpy };

      const result = await recoverMigrationJournal(client, MIGRATIONS_DIR, fs);

      expect(result).toEqual({ orphansRemoved: 0, duplicatesRemoved: 0, realigned: 0, recovered: 0 });
      // No DB interaction at all (not even the CREATE TABLE guard)
      expect(querySpy).not.toHaveBeenCalled();
    });
  });
});
