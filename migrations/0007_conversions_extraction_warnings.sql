-- No-op placeholder. This entry is a duplicate of 0006_conversions_extraction_warnings.sql,
-- which is the canonical migration that adds the extraction_warnings column.
-- The 0006 migration was already applied when this entry was first tracked in the
-- journal; keeping this file as a no-op ensures the Drizzle runtime migrator does
-- not error when it encounters the journal entry.
SELECT 1;
