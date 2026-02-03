import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table (basic)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Courses table
export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  courseName: text("course_name").notNull(),
  courseNumber: text("course_number").notNull(),
  courseLevel: text("course_level").notNull(),
  credits: text("credits").notNull(),
  semester: text("semester").notNull(),
  instructor: text("instructor").notNull(),
  department: text("department").notNull(),
  courseDescription: text("course_description").notNull(),
  learningOutcomes: text("learning_outcomes").notNull(),
  prerequisites: text("prerequisites"),
  existingSyllabus: text("existing_syllabus"),
  additionalContext: text("additional_context"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCourseSchema = createInsertSchema(courses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// Generated content table
export const generatedContent = pgTable("generated_content", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  toolType: text("tool_type").notNull(), // syllabus, schedule, assignment, module, rubric, aipolicy, alignment
  toolName: text("tool_name").notNull(),
  formData: jsonb("form_data").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertGeneratedContentSchema = createInsertSchema(generatedContent).omit({
  id: true,
  createdAt: true,
});

export type InsertGeneratedContent = z.infer<typeof insertGeneratedContentSchema>;
export type GeneratedContent = typeof generatedContent.$inferSelect;

// Version history for refinements
export const contentVersions = pgTable("content_versions", {
  id: serial("id").primaryKey(),
  generatedContentId: integer("generated_content_id").notNull().references(() => generatedContent.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  refinementRequest: text("refinement_request"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertContentVersionSchema = createInsertSchema(contentVersions).omit({
  id: true,
  createdAt: true,
});

export type InsertContentVersion = z.infer<typeof insertContentVersionSchema>;
export type ContentVersion = typeof contentVersions.$inferSelect;
