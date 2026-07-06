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
  syllabusUploadedAt: timestamp("syllabus_uploaded_at"),
  rolledOverFromId: integer("rolled_over_from_id"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export type Course = typeof courses.$inferSelect;

// Generated content table
export const generatedContent = pgTable("generated_content", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").references(() => courses.id, {
    onDelete: "cascade",
  }),
  userId: text("user_id"),
  visitorToken: varchar("visitor_token"),
  toolType: text("tool_type").notNull(),
  toolName: text("tool_name").notNull(),
  formData: jsonb("form_data").notNull(),
  content: text("content").notNull(),
  isApproved: boolean("is_approved").default(false).notNull(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export type GeneratedContent = typeof generatedContent.$inferSelect;

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
  manualFixItems: jsonb("manual_fix_items"),
  ocrApplied: boolean("ocr_applied").notNull().default(false),
  extractionWarnings: jsonb("extraction_warnings").$type<string[]>(),
  contentFidelity: jsonb("content_fidelity"),
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

// AI fix retry events — persisted so counts survive server restarts.
export const aiFixRetryEvents = pgTable("ai_fix_retry_events", {
  id: serial("id").primaryKey(),
  criterion: text("criterion"),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export type AiFixRetryEvent = typeof aiFixRetryEvents.$inferSelect;

// Cross-instance rate-limit log.
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

// Admin export audit log — records when an admin triggered a stats CSV export.
export const adminExports = pgTable("admin_exports", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  exportedAt: timestamp("exported_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  rowCounts: jsonb("row_counts").$type<{
    courses: number;
    content: number;
    conversions: number;
    users: number;
  }>(),
});

export type AdminExport = typeof adminExports.$inferSelect;
