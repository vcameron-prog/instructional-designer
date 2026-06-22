CREATE TABLE IF NOT EXISTS "content_versions" (
        "id" serial PRIMARY KEY NOT NULL,
        "generated_content_id" integer NOT NULL,
        "content" text NOT NULL,
        "refinement_request" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
        "id" serial PRIMARY KEY NOT NULL,
        "title" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "courses" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar NOT NULL,
        "course_name" text NOT NULL,
        "course_number" text NOT NULL,
        "section_number" text,
        "course_level" text NOT NULL,
        "credits" text NOT NULL,
        "semester" text NOT NULL,
        "instructor" text NOT NULL,
        "department" text NOT NULL,
        "course_description" text NOT NULL,
        "learning_outcomes" text NOT NULL,
        "prerequisites" text,
        "existing_syllabus" text,
        "additional_context" text,
        "syllabus_uploaded_at" timestamp,
        "rolled_over_from_id" integer,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generated_content" (
        "id" serial PRIMARY KEY NOT NULL,
        "course_id" integer,
        "user_id" text,
        "tool_type" text NOT NULL,
        "tool_name" text NOT NULL,
        "form_data" jsonb NOT NULL,
        "content" text NOT NULL,
        "is_approved" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
        "id" serial PRIMARY KEY NOT NULL,
        "conversation_id" integer NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_content" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar NOT NULL,
        "title" text NOT NULL,
        "tool_type" text NOT NULL,
        "content" text NOT NULL,
        "description" text,
        "form_data" jsonb,
        "course_id" integer,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_outcomes" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" varchar NOT NULL,
        "text" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
        "sid" varchar PRIMARY KEY NOT NULL,
        "sess" jsonb NOT NULL,
        "expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "email" varchar,
        "first_name" varchar,
        "last_name" varchar,
        "profile_image_url" varchar,
        "preferences" jsonb,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_generated_content_id_generated_content_id_fk" FOREIGN KEY ("generated_content_id") REFERENCES "public"."generated_content"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "generated_content" ADD CONSTRAINT "generated_content_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" USING btree ("expire");
