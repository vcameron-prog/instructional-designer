-- Catch-up migration: adds columns that existed in the schema but were never
-- captured by the old ad-hoc runStartupMigrations() approach.
-- All statements use IF NOT EXISTS so this is safe to run on any DB state.

ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "syllabus_uploaded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "rolled_over_from_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb;
--> statement-breakpoint
ALTER TABLE "saved_content" ADD COLUMN IF NOT EXISTS "form_data" jsonb;
--> statement-breakpoint
ALTER TABLE "saved_content" ADD COLUMN IF NOT EXISTS "course_id" integer;
