-- Add visitor_token column to generated_content for anonymous quick-tool ownership.
-- Allows the server to verify that the anonymous caller who created a piece of
-- quick-tool content (userId=null) is the same session that tries to mutate it later.

ALTER TABLE "generated_content" ADD COLUMN IF NOT EXISTS "visitor_token" varchar;
