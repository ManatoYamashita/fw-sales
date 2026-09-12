CREATE TABLE "event_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"kind" text NOT NULL,
	"event" text NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"target_type" text NOT NULL,
	"target_id" text,
	"store_id" text,
	"payload" jsonb NOT NULL,
	"error" jsonb
);
--> statement-breakpoint
ALTER TABLE "event_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "event_logs_occurred_at_idx" ON "event_logs" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_logs_store_occurred_at_idx" ON "event_logs" USING btree ("store_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_logs_event_occurred_at_idx" ON "event_logs" USING btree ("event","occurred_at" DESC NULLS LAST);
--> statement-breakpoint
-- Same public-schema RLS approach as 0010, with no client policies. Default
-- Supabase grants must not expose audit data (including TRUNCATE, outside RLS).
-- Owner/BYPASSRLS server connections keep access; do not FORCE ROW LEVEL SECURITY.
REVOKE ALL ON TABLE "public"."event_logs" FROM PUBLIC;
--> statement-breakpoint
-- Plain local Postgres may not have Supabase roles. On Supabase both exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."event_logs" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."event_logs" FROM authenticated;
  END IF;
END $$;
