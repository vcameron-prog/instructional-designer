import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";
import { 
  courses, 
  generatedContent, 
  contentVersions,
  savedContent,
  users,
  type Course, 
  type InsertCourse,
  type GeneratedContent,
  type InsertGeneratedContent,
  type ContentVersion,
  type InsertContentVersion,
  type SavedContent,
  type InsertSavedContent,
  type User,
  type InsertUser
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Courses
  getAllCourses(): Promise<Course[]>;
  getCourse(id: number): Promise<Course | undefined>;
  createCourse(course: InsertCourse): Promise<Course>;
  updateCourse(id: number, course: Partial<InsertCourse>): Promise<Course | undefined>;
  deleteCourse(id: number): Promise<void>;
  
  // Generated Content
  getContentByCourse(courseId: number): Promise<GeneratedContent[]>;
  getApprovedContentByCourse(courseId: number): Promise<GeneratedContent[]>;
  getContent(id: number): Promise<GeneratedContent | undefined>;
  createContent(content: InsertGeneratedContent): Promise<GeneratedContent>;
  updateContent(id: number, content: string): Promise<GeneratedContent | undefined>;
  toggleContentApproval(id: number, isApproved: boolean): Promise<GeneratedContent | undefined>;
  
  // Content Versions
  createVersion(version: InsertContentVersion): Promise<ContentVersion>;
  getVersionsByContent(contentId: number): Promise<ContentVersion[]>;
  
  // Saved Content Library
  getAllSavedContent(): Promise<SavedContent[]>;
  getSavedContent(id: number): Promise<SavedContent | undefined>;
  createSavedContent(content: InsertSavedContent): Promise<SavedContent>;
  deleteSavedContent(id: number): Promise<void>;
  
  // Course Duplication
  duplicateCourse(id: number): Promise<Course | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const [user] = await db.insert(users).values({ ...insertUser, id }).returning();
    return user;
  }

  // Courses
  async getAllCourses(): Promise<Course[]> {
    return db.select().from(courses).orderBy(desc(courses.updatedAt));
  }

  async getCourse(id: number): Promise<Course | undefined> {
    const [course] = await db.select().from(courses).where(eq(courses.id, id));
    return course;
  }

  async createCourse(course: InsertCourse): Promise<Course> {
    const [created] = await db.insert(courses).values(course).returning();
    return created;
  }

  async updateCourse(id: number, course: Partial<InsertCourse>): Promise<Course | undefined> {
    const [updated] = await db
      .update(courses)
      .set({ ...course, updatedAt: new Date() })
      .where(eq(courses.id, id))
      .returning();
    return updated;
  }

  async deleteCourse(id: number): Promise<void> {
    await db.delete(courses).where(eq(courses.id, id));
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

  // Course Duplication
  async duplicateCourse(id: number): Promise<Course | undefined> {
    const original = await this.getCourse(id);
    if (!original) return undefined;

    const duplicated = await this.createCourse({
      courseName: `${original.courseName} (Copy)`,
      courseNumber: original.courseNumber,
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
    });

    return duplicated;
  }
}

export const storage = new DatabaseStorage();
