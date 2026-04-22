import { db } from "./db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { 
  courses, 
  generatedContent, 
  contentVersions,
  savedContent,
  type Course, 
  type InsertCourse,
  type GeneratedContent,
  type InsertGeneratedContent,
  type ContentVersion,
  type InsertContentVersion,
  type SavedContent,
  type InsertSavedContent,
} from "@shared/schema";

export interface IStorage {
  // Courses (user-scoped)
  getAllCourses(userId: string): Promise<Course[]>;
  getCourse(id: number, userId: string): Promise<Course | undefined>;
  createCourse(course: InsertCourse, userId: string): Promise<Course>;
  updateCourse(id: number, course: Partial<InsertCourse>, userId: string): Promise<Course | undefined>;
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

  // Content Versions
  createVersion(version: InsertContentVersion): Promise<ContentVersion>;
  getVersionsByContent(contentId: number): Promise<ContentVersion[]>;
  getVersionById(id: number): Promise<ContentVersion | undefined>;
  
  // Saved Content Library
  getAllSavedContent(): Promise<SavedContent[]>;
  getSavedContent(id: number): Promise<SavedContent | undefined>;
  createSavedContent(content: InsertSavedContent): Promise<SavedContent>;
  deleteSavedContent(id: number): Promise<void>;
  
  // Course Duplication (user-scoped)
  duplicateCourse(id: number, userId: string): Promise<Course | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Courses (user-scoped)
  async getAllCourses(userId: string): Promise<Course[]> {
    return db.select().from(courses).where(eq(courses.userId, userId)).orderBy(desc(courses.updatedAt));
  }

  async getCourse(id: number, userId: string): Promise<Course | undefined> {
    const [course] = await db.select().from(courses).where(and(eq(courses.id, id), eq(courses.userId, userId)));
    return course;
  }

  async createCourse(course: InsertCourse, userId: string): Promise<Course> {
    const [created] = await db.insert(courses).values({ ...course, userId }).returning();
    return created;
  }

  async updateCourse(id: number, course: Partial<InsertCourse>, userId: string): Promise<Course | undefined> {
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

  // Saved Content Library
  async getAllSavedContent(): Promise<SavedContent[]> {
    return db.select().from(savedContent).orderBy(desc(savedContent.createdAt));
  }

  async getSavedContent(id: number): Promise<SavedContent | undefined> {
    const [content] = await db.select().from(savedContent).where(eq(savedContent.id, id));
    return content;
  }

  async createSavedContent(content: InsertSavedContent): Promise<SavedContent> {
    const [created] = await db.insert(savedContent).values(content).returning();
    return created;
  }

  async deleteSavedContent(id: number): Promise<void> {
    await db.delete(savedContent).where(eq(savedContent.id, id));
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
}

export const storage = new DatabaseStorage();
