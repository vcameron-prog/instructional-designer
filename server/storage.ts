import { db } from "./db";
import { eq, count, gte, sql } from "drizzle-orm";
import {
  conversions,
  aiFixRetryEvents,
} from "@shared/schema";

export interface GeneratedContentOwnership {
  id: number;
  userId: string | null;
  courseId: number | null;
}

export interface CourseOwnership {
  id: number;
}

export interface ContentApprovalResult {
  id: number;
  isApproved: boolean;
}

export interface IStorage {
  // Manual Fix Items (per conversion)
  getManualFixItems(id: number): Promise<{ title: string; reason: string }[] | null>;
  setManualFixItems(id: number, items: { title: string; reason: string }[]): Promise<void>;

  // AI Fix Retry Events
  logAiFixRetryEvent(criterion?: string, title?: string): Promise<void>;
  getAiFixRetryStats(): Promise<{ lifetimeCount: number; thisMonthCount: number }>;

  // Content approval (course-linked content)
  getGeneratedContent(id: number): Promise<GeneratedContentOwnership | null>;
  getCourseByOwner(courseId: number, userId: string): Promise<CourseOwnership | null>;
  toggleContentApproval(id: number): Promise<ContentApprovalResult | null>;
}

export class DatabaseStorage implements IStorage {
  // Manual Fix Items (per conversion)
  async getManualFixItems(id: number): Promise<{ title: string; reason: string }[] | null> {
    const [row] = await db.select({ manualFixItems: conversions.manualFixItems }).from(conversions).where(eq(conversions.id, id));
    if (!row) return null;
    const items = row.manualFixItems;
    if (!Array.isArray(items)) return null;
    return items as { title: string; reason: string }[];
  }

  async setManualFixItems(id: number, items: { title: string; reason: string }[]): Promise<void> {
    await db.update(conversions).set({ manualFixItems: items.length > 0 ? items : null }).where(eq(conversions.id, id));
  }

  // AI Fix Retry Events
  async logAiFixRetryEvent(criterion?: string, title?: string): Promise<void> {
    await db.insert(aiFixRetryEvents).values({ criterion: criterion ?? null, title: title ?? null });
  }

  async getAiFixRetryStats(): Promise<{ lifetimeCount: number; thisMonthCount: number }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [lifetimeRow] = await db.select({ value: count() }).from(aiFixRetryEvents);
    const [monthRow] = await db.select({ value: count() }).from(aiFixRetryEvents)
      .where(gte(aiFixRetryEvents.createdAt, startOfMonth));

    return {
      lifetimeCount: Number(lifetimeRow?.value ?? 0),
      thisMonthCount: Number(monthRow?.value ?? 0),
    };
  }

  // Content approval — queries the generatedContent and courses tables.
  // Returns null when the row is not found or the tables do not exist,
  // so callers degrade to 404 rather than throwing.
  async getGeneratedContent(id: number): Promise<GeneratedContentOwnership | null> {
    try {
      const result = await db.execute(
        sql`SELECT id, "userId", "courseId" FROM "generatedContent" WHERE id = ${id} LIMIT 1`,
      );
      const row = (result as any).rows?.[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: Number(row.id),
        userId: (row.userId as string | null) ?? null,
        courseId: row.courseId != null ? Number(row.courseId) : null,
      };
    } catch {
      return null;
    }
  }

  async getCourseByOwner(courseId: number, userId: string): Promise<CourseOwnership | null> {
    try {
      const result = await db.execute(
        sql`SELECT id FROM courses WHERE id = ${courseId} AND "userId" = ${userId} LIMIT 1`,
      );
      const row = (result as any).rows?.[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return { id: Number(row.id) };
    } catch {
      return null;
    }
  }

  async toggleContentApproval(id: number): Promise<ContentApprovalResult | null> {
    try {
      const result = await db.execute(
        sql`UPDATE "generatedContent"
            SET "isApproved" = NOT "isApproved"
            WHERE id = ${id}
            RETURNING id, "isApproved"`,
      );
      const row = (result as any).rows?.[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return { id: Number(row.id), isApproved: Boolean(row.isApproved) };
    } catch {
      return null;
    }
  }
}

export const storage = new DatabaseStorage();
