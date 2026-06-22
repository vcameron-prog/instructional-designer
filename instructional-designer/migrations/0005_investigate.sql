-- No-op placeholder. This entry was added to the migration journal as a
-- tracking marker. All schema changes it was intended to capture were already
-- applied by earlier migrations (0001_catchup_missing_columns.sql and
-- 0004_add_manual_fix_items_column.sql, both of which use IF NOT EXISTS).
-- Keeping this file ensures the Drizzle runtime migrator does not error when
-- it encounters the journal entry.
SELECT 1;
