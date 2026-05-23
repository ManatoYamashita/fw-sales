CREATE TABLE "research_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"deep_research_task_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_log" jsonb,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"research_started_at" timestamp with time zone,
	"research_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"store_id" text NOT NULL,
	"category_1_basic" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_2_owner" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_3_menu" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_4_customer" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_5_marketing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_6_competitor" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_7_owned_media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_8_other" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hearing_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"full_markdown" text NOT NULL,
	"all_source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_cost_yen" numeric(10, 2),
	"total_duration_sec" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_job_id_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_jobs_status_enqueued_idx" ON "research_jobs" USING btree ("status","enqueued_at");--> statement-breakpoint
CREATE INDEX "research_jobs_store_idx" ON "research_jobs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "research_jobs_user_enqueued_idx" ON "research_jobs" USING btree ("user_id","enqueued_at");--> statement-breakpoint
CREATE INDEX "research_jobs_enqueued_idx" ON "research_jobs" USING btree ("enqueued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_reports_job_idx" ON "research_reports" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "research_reports_store_created_idx" ON "research_reports" USING btree ("store_id","created_at");