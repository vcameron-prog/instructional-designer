import { db } from "./db";
import { eq, count, gte, and, not } from "drizzle-orm";
import {
  conversions,
  aiFixRetryEvents,
  courses,
  generatedContent,
} from "@shared/schema";
import { users } from "@shared/models/auth";

export interface UserPreferences {
  skipPreview?: boolean;
  autoExpand?: boolean;
  defaultLanguage?: string;
  preferredTool?: string;
  titleQualityMinLength?: number;
}

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
  // User preferences
  getUserPreferences(userId: string): Promise<UserPreferences>;
  setUserPreferences(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences>;

  // Manual Fix Items (per conversion)
  getManualFixItems(id: number): Promise<{ title: string; reason: string; criterion?: string }[] | null>;
  setManualFixItems(id: number, items: { title: string; reason: string; criterion?: string }[]): Promise<void>;

  // AI Fix Retry Events
  logAiFixRetryEvent(criterion?: string, title?: string): Promise<void>;
  getAiFixRetryStats(): Promise<{ lifetimeCount: number; thisMonthCount: number }>;

  // Content approval (course-linked content)
  getGeneratedContent(id: number): Promise<GeneratedContentOwnership | null>;
  getCourseByOwner(courseId: number, userId: string): Promise<CourseOwnership | null>;
  toggleContentApproval(id: number): Promise<ContentApprovalResult | null>;
}

export class DatabaseStorage implements IStorage {
  // User preferences
  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const [row] = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) return {};
    return (row.preferences as UserPreferences) ?? {};
  }

  async setUserPreferences(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const existing = await this.getUserPreferences(userId);
    const merged: UserPreferences = { ...existing, ...patch };
    await db
      .update(users)
      .set({ preferences: merged })
      .where(eq(users.id, userId));
    return merged;
  }

  // Manual Fix Items (per conversion)
  async getManualFixItems(id: number): Promise<{ title: string; reason: string }[] | null> {
    const [row] = await db.select({ manualFixItems: conversions.manualFixItems }).from(conversions).where(eq(conversions.id, id));
    if (!row) return null;
    const items = row.manualFixItems;
    if (!Array.isArray(items)) return null;
    return items as { title: string; reason: string; criterion?: string }[];
  }

  async setManualFixItems(id: number, items: { title: string; reason: string; criterion?: string }[]): Promise<void> {
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
  async getGeneratedContent(id: number): Promise<GeneratedContentOwnership | null> {
    const [row] = await db
      .select({
        id: generatedContent.id,
        userId: generatedContent.userId,
        courseId: generatedContent.courseId,
      })
      .from(generatedContent)
      .where(eq(generatedContent.id, id));
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId ?? null,
      courseId: row.courseId ?? null,
    };
  }

  async getCourseByOwner(courseId: number, userId: string): Promise<CourseOwnership | null> {
    const [row] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.userId, userId)));
    if (!row) return null;
    return { id: row.id };
  }

  async toggleContentApproval(id: number): Promise<ContentApprovalResult | null> {
    // Concurrency safety: the `NOT(isApproved)` expression is evaluated by
    // PostgreSQL inside a single atomic UPDATE statement.  PostgreSQL acquires
    // a row-level lock on the target row before reading its current value, so
    // two concurrent callers on the same row are serialised: the second UPDATE
    // blocks until the first transaction commits, then it reads the *already-
    // flipped* value.  There is therefore no read-then-write race: neither
    // caller can see a stale base value that the other has already changed.
    // The net effect of two rapid concurrent flips is that both complete
    // successfully, the final value is the doubly-toggled (original) value,
    // and no update is silently discarded.
    const [updated] = await db
      .update(generatedContent)
      .set({ isApproved: not(generatedContent.isApproved) })
      .where(eq(generatedContent.id, id))
      .returning({ id: generatedContent.id, isApproved: generatedContent.isApproved });
    if (!updated) return null;
    return { id: updated.id, isApproved: updated.isApproved };
  }
}

export const storage = new DatabaseStorage();
