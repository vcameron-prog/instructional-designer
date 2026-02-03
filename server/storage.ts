import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import { 
  courses, 
  generatedContent, 
  contentVersions,
  users,
  type Course, 
  type InsertCourse,
  type GeneratedContent,
  type InsertGeneratedContent,
  type ContentVersion,
  type InsertContentVersion,
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
  getContent(id: number): Promise<GeneratedContent | undefined>;
  createContent(content: InsertGeneratedContent): Promise<GeneratedContent>;
  updateContent(id: number, content: string): Promise<GeneratedContent | undefined>;
  
  // Content Versions
  createVersion(version: InsertContentVersion): Promise<ContentVersion>;
  getVersionsByContent(contentId: number): Promise<ContentVersion[]>;
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
}

export const storage = new DatabaseStorage();
