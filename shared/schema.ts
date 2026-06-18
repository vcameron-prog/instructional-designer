import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  serial,
  integer,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models (required for Replit Auth)
export * from "./models/auth";

// Courses table
export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  courseName: text("course_name").notNull(),
  courseNumber: text("course_number").notNull(),
  sectionNumber: text("section_number"),
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
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const insertCourseSchema = createInsertSchema(courses).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// Generated content table
export const generatedContent = pgTable("generated_content", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").references(() => courses.id, {
    onDelete: "cascade",
  }),
  userId: text("user_id"),
  toolType: text("tool_type").notNull(),
  toolName: text("tool_name").notNull(),
  formData: jsonb("form_data").notNull(),
  content: text("content").notNull(),
  isApproved: boolean("is_approved").default(false).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const insertGeneratedContentSchema = createInsertSchema(
  generatedContent,
).omit({
  id: true,
  createdAt: true,
});

export type InsertGeneratedContent = z.infer<
  typeof insertGeneratedContentSchema
>;
export type GeneratedContent = typeof generatedContent.$inferSelect;

// Version history for refinements
export const contentVersions = pgTable("content_versions", {
  id: serial("id").primaryKey(),
  generatedContentId: integer("generated_content_id")
    .notNull()
    .references(() => generatedContent.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  refinementRequest: text("refinement_request"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const insertContentVersionSchema = createInsertSchema(
  contentVersions,
).omit({
  id: true,
  createdAt: true,
});

export type InsertContentVersion = z.infer<typeof insertContentVersionSchema>;
export type ContentVersion = typeof contentVersions.$inferSelect;

// Saved content library (favorites)
export const savedContent = pgTable("saved_content", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  toolType: text("tool_type").notNull(),
  content: text("content").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const insertSavedContentSchema = createInsertSchema(savedContent).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertSavedContent = z.infer<typeof insertSavedContentSchema>;
export type SavedContent = typeof savedContent.$inferSelect;

// Document Accessibility Conversions table
export const conversions = pgTable("conversions", {
  id: serial("id").primaryKey(),
  originalFilename: text("original_filename").notNull(),
  fileSize: integer("file_size").notNull(),
  sourceType: text("source_type").notNull().default("pdf"),
  status: text("status").notNull().default("uploaded"),
  pageCount: integer("page_count"),
  extractedText: text("extracted_text"),
  accessibleHtml: text("accessible_html"),
  complianceReport: jsonb("compliance_report"),
  originalComplianceReport: jsonb("original_compliance_report"),
  statusMessage: text("status_message"),
  errorMessage: text("error_message"),
  pdfData: text("pdf_data"),
  ocrApplied: boolean("ocr_applied").notNull().default(false),
  selectedSheet: text("selected_sheet"),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  userId: varchar("user_id"),
  visitorToken: varchar("visitor_token"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const insertConversionSchema = createInsertSchema(conversions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertConversion = z.infer<typeof insertConversionSchema>;
export type Conversion = typeof conversions.$inferSelect;

// Course templates
export const COURSE_TEMPLATES = {
  lecture: {
    name: "Traditional Lecture",
    description: "Standard lecture-based course with exams and assignments",
    defaults: {
      additionalContext:
        "This is a traditional lecture course. Students attend scheduled lectures, complete readings, and are assessed through exams and written assignments. Consider incorporating active learning strategies and discussion opportunities.",
    },
  },
  lab: {
    name: "Laboratory Course",
    description: "Hands-on lab with practical experiments and reports",
    defaults: {
      additionalContext:
        "This is a laboratory course with hands-on components. Students work in lab settings conducting experiments or practical exercises. Assessment includes lab reports, practical exams, and safety compliance. Equipment and material preparation is required.",
    },
  },
  online: {
    name: "Fully Online",
    description: "Asynchronous online course with flexible scheduling",
    defaults: {
      additionalContext:
        "This is a fully online asynchronous course. All content is delivered through Blackboard Ultra. Students work at their own pace within weekly deadlines. Include video lectures, discussion forums, and varied assessment types for engagement.",
    },
  },
  hybrid: {
    name: "Hybrid/Blended",
    description: "Mix of in-person and online components",
    defaults: {
      additionalContext:
        "This is a hybrid course combining in-person and online components. Some sessions meet face-to-face while others are completed online. Clear communication about which sessions are in-person vs. online is essential.",
    },
  },
  seminar: {
    name: "Seminar/Discussion",
    description: "Discussion-based course with student presentations",
    defaults: {
      additionalContext:
        "This is a seminar-style course emphasizing discussion, critical analysis, and student presentations. Students are expected to actively participate, lead discussions, and engage with peer work. Assessment focuses on participation, presentations, and written analysis.",
    },
  },
  studio: {
    name: "Studio/Workshop",
    description: "Creative or skill-based hands-on course",
    defaults: {
      additionalContext:
        "This is a studio/workshop course focused on developing practical skills through hands-on work. Students create projects, receive critique, and iterate on their work. Assessment includes portfolio work, progress demonstrations, and final projects.",
    },
  },
} as const;

export type CourseTemplateId = keyof typeof COURSE_TEMPLATES;

// Cross-instance rate-limit log.
// Lightweight event log used to enforce shared (cross-process, cross-instance)
// rate limits without requiring an external store such as Redis.  Each row
// records one rate-limited event.  Rows outside the relevant time window are
// periodically purged by a background setInterval in server/routes.ts.
export const rateLimitLog = pgTable("rate_limit_log", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Persistent application metrics (key-value counters that survive server restarts)
export const appMetrics = pgTable("app_metrics", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  lastAt: timestamp("last_at", { withTimezone: true }),
});

export type AppMetric = typeof appMetrics.$inferSelect;

// Chat integration tables
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});
