CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "date" date NOT NULL,
  "page" text NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "analytics_events_date_idx" ON "analytics_events" ("date");
CREATE INDEX IF NOT EXISTS "analytics_events_session_id_idx" ON "analytics_events" ("session_id");
