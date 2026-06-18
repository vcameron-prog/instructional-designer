-- Add selected_sheet column to conversions for Google Sheets source type support.
-- Uses IF NOT EXISTS so this is safe to run on any database state.

ALTER TABLE "conversions" ADD COLUMN IF NOT EXISTS "selected_sheet" text;
