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
});
