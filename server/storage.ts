import { db } from "./db";
import { eq, desc, and, ne, isNull, notInArray, inArray, count, gte } from "drizzle-orm";
import { 
  courses, 
  conversions,
  generatedContent, 
  contentVersions,
  savedContent,
  savedOutcomes,
  aiFixRetryEvents,
  type Course, 
  type InsertCourse,
  type GeneratedContent,
  type InsertGeneratedContent,
  type ContentVersion,
  type InsertContentVersion,
  type SavedContent,
  type InsertSavedContent,
  type SavedOutcome,
} from "@shared/schema";
import { users } from "../shared/models/auth";

export interface IStorage {
  // User preferences (server-synced)
  getUserPreferences(userId: string): Promise<Record<string, unknown> | null>;
  setUserPreferences(userId: string, prefs: Record<string, unknown>): Promise<void>;

  // Courses (user-scoped)
  getAllCourses(userId: string): Promise<Course[]>;
  getCourse(id: number, userId: string): Promise<Course | undefined>;
  createCourse(course: InsertCourse & { syllabusUploadedAt?: Date | null }, userId: string): Promise<Course>;
  updateCourse(id: number, course: Partial<InsertCourse> & { syllabusUploadedAt?: Date | null }, userId: string): Promise<Course | undefined>;
  deleteCourse(id: number, userId: string): Promise<void>;
  
  // Generated Content
  getContentByCourse(courseId: number): Promise<GeneratedContent[]>;
  getApprovedContentByCourse(courseId: number): Promise<GeneratedContent[]>;
  getContent(id: number): Promise<GeneratedContent | undefined>;
  createContent(content: InsertGeneratedContent): Promise<GeneratedContent>;
  updateContent(id: number, content: string): Promise<GeneratedContent | undefined>;
  toggleContentApproval(id: number, isApproved: boolean): Promise<GeneratedContent | undefined>;
  
  // Standalone Content (no course)
  getStandaloneContent(userId: string): Promise<GeneratedContent[]>;
  getStandaloneContentById(id: number, userId: string): Promise<GeneratedContent | undefined>;
  getRecentStandaloneContent(userId: string, limit: number): Promise<GeneratedContent[]>;
  deleteContent(id: number, userId: string): Promise<void>;

  // Content Versions
  createVersion(version: InsertContentVersion): Promise<ContentVersion>;
  getVersionsByContent(contentId: number): Promise<ContentVersion[]>;
  getVersionById(id: number): Promise<ContentVersion | undefined>;
  pruneOldVersions(contentId: number, keepCount: number): Promise<void>;
  
  // Saved Content Library (user-scoped)
  getAllSavedContent(userId: string): Promise<SavedContent[]>;
  getSavedContent(id: number, userId: string): Promise<SavedContent | undefined>;
  createSavedContent(content: InsertSavedContent, userId: string): Promise<SavedContent>;
  deleteSavedContent(id: number, userId: string): Promise<void>;
  
  // Tool Usage (user-scoped via course ownership)
  getToolUsage(courseId: number, userId: string): Promise<string[]>;

  // Course Duplication (user-scoped)
  duplicateCourse(id: number, userId: string): Promise<Course | undefined>;

  // Semester Rollover (user-scoped) — copies course setup only, no generated content
  rolloverCourse(id: number, userId: string, semester: string): Promise<Course | undefined>;

  // Saved Outcomes (personal faculty collection)
  getSavedOutcomes(userId: string): Promise<SavedOutcome[]>;
  createSavedOutcome(text: string, userId: string): Promise<SavedOutcome>;
  updateSavedOutcome(id: number, text: string, userId: string): Promise<SavedOutcome>;
  deleteSavedOutcome(id: number, userId: string): Promise<number>;

  // Manual Fix Items (per conversion)
  getManualFixItems(id: number): Promise<{ title: string; reason: string }[] | null>;
  setManualFixItems(id: number, items: { title: string; reason: string }[]): Promise<void>;

  // AI Fix Retry Events
  logAiFixRetryEvent(criterion?: string, title?: string): Promise<void>;
  getAiFixRetryStats(): Promise<{ lifetimeCount: number; thisMonthCount: number }>;

  // Copy selected content items from one course to another (user-scoped)
  copyContentItemsToNewCourse(contentIds: number[], sourceCourseId: number, targetCourseId: number, userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User preferences (server-synced)
  async getUserPreferences(userId: string): Promise<Record<string, unknown> | null> {
    const [row] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
    if (!row) return null;
    return (row.preferences as Record<string, unknown>) ?? null;
  }

  async setUserPreferences(userId: string, prefs: Record<string, unknown>): Promise<void> {
    await db.update(users).set({ preferences: prefs, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  // Courses (user-scoped)
  async getAllCourses(userId: string): Promise<Course[]> {
    return db.select().from(courses).where(eq(courses.userId, userId)).orderBy(desc(courses.updatedAt));
  }

  async getCourse(id: number, userId: string): Promise<Course | undefined> {
    const [course] = await db.select().from(courses).where(and(eq(courses.id, id), eq(courses.userId, userId)));
    return course;
  }

  async createCourse(course: InsertCourse & { syllabusUploadedAt?: Date | null }, userId: string): Promise<Course> {
    const [created] = await db.insert(courses).values({ ...course, userId }).returning();
    return created;
  }

  async updateCourse(id: number, course: Partial<InsertCourse> & { syllabusUploadedAt?: Date | null }, userId: string): Promise<Course | undefined> {
    const [updated] = await db
      .update(courses)
      .set({ ...course, updatedAt: new Date() })
      .where(and(eq(courses.id, id), eq(courses.userId, userId)))
      .returning();
    return updated;
  }

  async deleteCourse(id: number, userId: string): Promise<void> {
    await db.delete(courses).where(and(eq(courses.id, id), eq(courses.userId, userId)));
  }

  // Generated Content
  async getContentByCourse(courseId: number): Promise<GeneratedContent[]> {
    return db
      .select()
      .from(generatedContent)
      .where(eq(generatedContent.courseId, courseId))
      .orderBy(desc(generatedContent.createdAt));
  }

  async getContent(id: number): Promise<GeneratedContent | undefined> {
    const [content] = await db
      .select()
      .from(generatedContent)
      .where(eq(generatedContent.id, id));
    return content;
  }

  async createContent(content: InsertGeneratedContent): Promise<GeneratedContent> {
    const [created] = await db.insert(generatedContent).values(content).returning();
    return created;
  }

  async updateContent(id: number, content: string): Promise<GeneratedContent | undefined> {
    const [updated] = await db
      .update(generatedContent)
      .set({ content })
      .where(eq(generatedContent.id, id))
      .returning();
    return updated;
  }

  async getApprovedContentByCourse(courseId: number): Promise<GeneratedContent[]> {
    return db
      .select()
      .from(generatedContent)
      .where(and(eq(generatedContent.courseId, courseId), eq(generatedContent.isApproved, true)))
      .orderBy(desc(generatedContent.createdAt));
  }

  async toggleContentApproval(id: number, isApproved: boolean): Promise<GeneratedContent | undefined> {
    const [updated] = await db
      .update(generatedContent)
      .set({ isApproved })
      .where(eq(generatedContent.id, id))
      .returning();
    return updated;
  }

  async getStandaloneContent(userId: string): Promise<GeneratedContent[]> {
    return db
      .select()
      .from(generatedContent)
      .where(and(isNull(generatedContent.courseId), eq(generatedContent.userId, userId)))
      .orderBy(desc(generatedContent.createdAt));
  }

  async getStandaloneContentById(id: number, userId: string): Promise<GeneratedContent | undefined> {
    const [content] = await db
      .select()
      .from(generatedContent)
      .where(and(eq(generatedContent.id, id), eq(generatedContent.userId, userId)));
    return content;
  }

  async getRecentStandaloneContent(userId: string, limit: number): Promise<GeneratedContent[]> {
    return db
      .select()
      .from(generatedContent)
      .where(and(isNull(generatedContent.courseId), eq(generatedContent.userId, userId)))
      .orderBy(desc(generatedContent.createdAt))
      .limit(limit);
  }

  async deleteContent(id: number, userId: string): Promise<void> {
    await db
      .delete(generatedContent)
      .where(and(eq(generatedContent.id, id), eq(generatedContent.userId, userId)));
  }

  // Content Versions
  async createVersion(version: InsertContentVersion): Promise<ContentVersion> {
    const [created] = await db.insert(contentVersions).values(version).returning();
    return created;
  }

  async getVersionsByContent(contentId: number): Promise<ContentVersion[]> {
    return db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.generatedContentId, contentId))
      .orderBy(desc(contentVersions.createdAt));
  }

  async getVersionById(id: number): Promise<ContentVersion | undefined> {
    const [version] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.id, id));
    return version;
  }

  async pruneOldVersions(contentId: number, keepCount: number): Promise<void> {
    const toKeep = await db
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .where(eq(contentVersions.generatedContentId, contentId))
      .orderBy(desc(contentVersions.createdAt))
      .limit(keepCount);

    if (toKeep.length < keepCount) return;

    const keepIds = toKeep.map((v) => v.id);
    await db
      .delete(contentVersions)
      .where(
        and(
          eq(contentVersions.generatedContentId, contentId),
          notInArray(contentVersions.id, keepIds),
        ),
      );
  }

  // Saved Content Library (user-scoped)
  async getAllSavedContent(userId: string): Promise<SavedContent[]> {
    return db.select().from(savedContent).where(eq(savedContent.userId, userId)).orderBy(desc(savedContent.createdAt));
  }

  async getSavedContent(id: number, userId: string): Promise<SavedContent | undefined> {
    const [content] = await db.select().from(savedContent).where(and(eq(savedContent.id, id), eq(savedContent.userId, userId)));
    return content;
  }

  async createSavedContent(content: InsertSavedContent, userId: string): Promise<SavedContent> {
    const [created] = await db.insert(savedContent).values({ ...content, userId }).returning();
    return created;
  }

  async deleteSavedContent(id: number, userId: string): Promise<void> {
    await db.delete(savedContent).where(and(eq(savedContent.id, id), eq(savedContent.userId, userId)));
  }

  // Saved Outcomes (personal faculty collection)
  async getSavedOutcomes(userId: string): Promise<SavedOutcome[]> {
    return db.select().from(savedOutcomes).where(eq(savedOutcomes.userId, userId)).orderBy(desc(savedOutcomes.createdAt));
  }

  async createSavedOutcome(text: string, userId: string): Promise<SavedOutcome> {
    const [created] = await db.insert(savedOutcomes).values({ text, userId }).returning();
    return created;
  }

  async updateSavedOutcome(id: number, text: string, userId: string): Promise<SavedOutcome> {
    const existing = await db
      .select()
      .from(savedOutcomes)
      .where(
        and(
          eq(savedOutcomes.userId, userId),
          eq(savedOutcomes.text, text),
          ne(savedOutcomes.id, id),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      const err = new Error("Duplicate outcome") as Error & { code: string };
      err.code = "DUPLICATE_OUTCOME";
      throw err;
    }
    const [updated] = await db
      .update(savedOutcomes)
      .set({ text })
      .where(and(eq(savedOutcomes.id, id), eq(savedOutcomes.userId, userId)))
      .returning();
    if (!updated) throw new Error("Outcome not found or not owned by user");
    return updated;
  }

  async deleteSavedOutcome(id: number, userId: string): Promise<number> {
    const rows = await db
      .delete(savedOutcomes)
      .where(and(eq(savedOutcomes.id, id), eq(savedOutcomes.userId, userId)))
      .returning({ id: savedOutcomes.id });
    return rows.length;
  }

  // Tool Usage (user-scoped via course ownership)
  async getToolUsage(courseId: number, userId: string): Promise<string[]> {
    // Verify course ownership first
    const course = await this.getCourse(courseId, userId);
    if (!course) return [];

    const rows = await db
      .selectDistinct({ toolType: generatedContent.toolType })
      .from(generatedContent)
      .where(eq(generatedContent.courseId, courseId));

    return rows.map((r) => r.toolType);
  }

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

  // Course Duplication (user-scoped)
  async duplicateCourse(id: number, userId: string): Promise<Course | undefined> {
    const original = await this.getCourse(id, userId);
    if (!original) return undefined;

    const duplicated = await this.createCourse({
      courseName: `${original.courseName} (Copy)`,
      courseNumber: original.courseNumber,
      sectionNumber: original.sectionNumber,
      courseLevel: original.courseLevel,
      credits: original.credits,
      semester: original.semester,
      instructor: original.instructor,
      department: original.department,
      courseDescription: original.courseDescription,
      learningOutcomes: original.learningOutcomes,
      prerequisites: original.prerequisites,
      existingSyllabus: original.existingSyllabus,
      additionalContext: original.additionalContext,
    }, userId);

    return duplicated;
  }

  // Copy selected content items from one course to another (user-scoped)
  async copyContentItemsToNewCourse(contentIds: number[], sourceCourseId: number, targetCourseId: number, userId: string): Promise<void> {
    if (contentIds.length === 0) return;
    const sourceCourse = await this.getCourse(sourceCourseId, userId);
    if (!sourceCourse) return;
    const items = await db
      .select()
      .from(generatedContent)
      .where(and(eq(generatedContent.courseId, sourceCourseId), inArray(generatedContent.id, contentIds)));
    for (const item of items) {
      await this.createContent({
        courseId: targetCourseId,
        toolType: item.toolType,
        toolName: item.toolName,
        formData: item.formData as Record<string, unknown>,
        content: item.content,
        isApproved: item.isApproved,
      });
    }
  }

  // Semester Rollover (user-scoped) — copies course setup only, no generated content or syllabus
  async rolloverCourse(id: number, userId: string, semester: string): Promise<Course | undefined> {
    const original = await this.getCourse(id, userId);
    if (!original) return undefined;

    const rolledOver = await this.createCourse({
      courseName: original.courseName,
      courseNumber: original.courseNumber,
      sectionNumber: original.sectionNumber,
      courseLevel: original.courseLevel,
      credits: original.credits,
      semester,
      instructor: original.instructor,
      department: original.department,
      courseDescription: original.courseDescription,
      learningOutcomes: original.learningOutcomes,
      prerequisites: original.prerequisites,
      existingSyllabus: null,
      additionalContext: original.additionalContext,
      rolledOverFromId: original.id,
    }, userId);

    return rolledOver;
  }
}

export const storage = new DatabaseStorage();
