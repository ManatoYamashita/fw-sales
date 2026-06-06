ALTER TABLE "deals" DROP CONSTRAINT "deals_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "handoffs" DROP CONSTRAINT "handoffs_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "handoffs" DROP CONSTRAINT "handoffs_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "research" DROP CONSTRAINT "research_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "research_jobs" DROP CONSTRAINT "research_jobs_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "research_reports" DROP CONSTRAINT "research_reports_job_id_research_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "research_reports" DROP CONSTRAINT "research_reports_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_job_id_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
