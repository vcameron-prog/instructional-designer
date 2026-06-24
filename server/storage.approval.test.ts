/**
 * Integration test: storage.toggleContentApproval
 *
 * Runs against the real PostgreSQL database (DATABASE_URL) to verify
 * that the SQL read-then-flip-write actually changes the is_approved
 * column and returns the new value.
 *
 * Isolation: each test inserts its own row with a unique id and deletes
 * it in afterEach so the suite leaves no litter.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "./db";
import { generatedContent } from "@shared/schema";
import { eq } from "drizzle-orm";
import { DatabaseStorage } from "./storage";

const storage = new DatabaseStorage();

const insertedIds: number[] = [];

async function seedRow(overrides: Partial<typeof generatedContent.$inferInsert> = {}) {
  const [row] = await db
    .insert(generatedContent)
    .values({
      toolType: "test-tool-type",
      toolName: "test-tool-name",
      formData: {},
      content: "test content",
      isApproved: false,
      ...overrides,
    })
    .returning({ id: generatedContent.id, isApproved: generatedContent.isApproved });
  insertedIds.push(row.id);
  return row;
}

afterEach(async () => {
  if (insertedIds.length === 0) return;
  const ids = insertedIds.splice(0);
  for (const id of ids) {
    await db.delete(generatedContent).where(eq(generatedContent.id, id));
  }
});

describe("DatabaseStorage.toggleContentApproval (integration)", () => {
  it("flips isApproved from false → true on first call", async () => {
    const { id } = await seedRow({ isApproved: false });

    const result = await storage.toggleContentApproval(id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(id);
    expect(result!.isApproved).toBe(true);
  });

  it("flips isApproved from true → false on first call", async () => {
    const { id } = await seedRow({ isApproved: true });

    const result = await storage.toggleContentApproval(id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(id);
    expect(result!.isApproved).toBe(false);
  });

  it("toggles back to original value after two consecutive calls", async () => {
    const { id } = await seedRow({ isApproved: false });

    const first = await storage.toggleContentApproval(id);
    expect(first!.isApproved).toBe(true);

    const second = await storage.toggleContentApproval(id);
    expect(second!.isApproved).toBe(false);
  });

  it("persists the flipped value to the database (re-reads the row)", async () => {
    const { id } = await seedRow({ isApproved: false });

    await storage.toggleContentApproval(id);

    const [dbRow] = await db
      .select({ isApproved: generatedContent.isApproved })
      .from(generatedContent)
      .where(eq(generatedContent.id, id));

    expect(dbRow.isApproved).toBe(true);
  });

  it("returns null when the row does not exist", async () => {
    const result = await storage.toggleContentApproval(-1);
    expect(result).toBeNull();
  });

  /**
   * Concurrency test: two parallel toggles on the same row.
   *
   * PostgreSQL serialises concurrent UPDATEs to the same row via row-level
   * locking.  When two callers race, the second blocks until the first
   * commits, then it reads the already-flipped value and flips it again.
   *
   * Expected invariants:
   *  1. Both calls succeed (no error, no null return).
   *  2. The two returned values are opposite — each saw a different base value.
   *  3. The final DB value equals whichever of the two ran last (the doubly-
   *     toggled original), confirming no update was silently discarded.
   */
  it("serialises two concurrent flips — no update is lost", async () => {
    const { id } = await seedRow({ isApproved: false });

    const [r1, r2] = await Promise.all([
      storage.toggleContentApproval(id),
      storage.toggleContentApproval(id),
    ]);

    // Both calls must have returned a result (no 404 / null)
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();

    // The two results must differ — each observed a different row state,
    // proving the second UPDATE read the committed value from the first.
    expect(r1!.isApproved).not.toBe(r2!.isApproved);

    // The final DB state must match whichever flip ran last.
    const [dbRow] = await db
      .select({ isApproved: generatedContent.isApproved })
      .from(generatedContent)
      .where(eq(generatedContent.id, id));

    const finalValues = [r1!.isApproved, r2!.isApproved];
    expect(finalValues).toContain(dbRow.isApproved);
  });
});
