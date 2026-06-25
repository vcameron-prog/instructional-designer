-- Drop legacy username/password columns that predate Replit Auth.
-- These columns are no longer referenced anywhere in the codebase.
-- IF EXISTS guards make this safe to run on any DB state (including
-- databases that were created after these columns were already gone).

ALTER TABLE "users" DROP COLUMN IF EXISTS "username";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password";
