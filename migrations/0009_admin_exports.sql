CREATE TABLE IF NOT EXISTS "admin_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"exported_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"row_counts" jsonb
);
