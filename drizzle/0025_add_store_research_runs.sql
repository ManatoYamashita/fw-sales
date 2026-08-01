CREATE TABLE "store_research_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"requested_by_user_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"stage" text,
	"result" jsonb,
	"source_registry" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_completed_at" timestamp with time zone,
	"token_usage" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_kind" text,
	"error_message" text,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "store_research_runs" ADD CONSTRAINT "store_research_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_research_runs" ADD CONSTRAINT "store_research_runs_requested_by_user_id_profiles_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_research_runs_store_started_idx" ON "store_research_runs" USING btree ("store_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_research_runs_running_store_idx" ON "store_research_runs" USING btree ("store_id") WHERE "store_research_runs"."status" = 'running';