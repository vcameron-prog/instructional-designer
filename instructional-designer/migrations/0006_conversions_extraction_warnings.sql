-- Add extraction_warnings column to conversions for surfacing non-fatal
-- source-file warnings to the user (e.g. RTF files missing \ansicpg).

ALTER TABLE "conversions" ADD COLUMN IF NOT EXISTS "extraction_warnings" jsonb;
