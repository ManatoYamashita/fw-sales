-- #371 expand: 既存のunique/PK/FK/DEFAULTを残して、次段コードと複合FKの前提だけを追加する。
-- Drizzleのtransaction内で実行する。取得待ちが長ければ無変更で失敗させ、再実行する。
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "ai_prompt_templates_tenant_user_created_idx" ON "ai_prompt_templates" USING btree ("tenant_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_templates_tenant_user_default_idx" ON "ai_prompt_templates" USING btree ("tenant_id","user_id") WHERE "ai_prompt_templates"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_tenant_key_idx" ON "app_settings" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "deals_tenant_store_idx" ON "deals" USING btree ("tenant_id","store_id");--> statement-breakpoint
CREATE INDEX "deals_tenant_created_idx" ON "deals" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "handoffs_tenant_store_idx" ON "handoffs" USING btree ("tenant_id","store_id");--> statement-breakpoint
CREATE INDEX "handoffs_tenant_deal_idx" ON "handoffs" USING btree ("tenant_id","deal_id");--> statement-breakpoint
CREATE INDEX "handoffs_tenant_created_idx" ON "handoffs" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "place_candidates_tenant_google_place_idx" ON "place_candidates" USING btree ("tenant_id","google_place_id");--> statement-breakpoint
CREATE INDEX "place_candidates_tenant_matched_store_idx" ON "place_candidates" USING btree ("tenant_id","matched_store_id");--> statement-breakpoint
CREATE INDEX "store_research_runs_tenant_store_started_idx" ON "store_research_runs" USING btree ("tenant_id","store_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "store_research_runs_tenant_running_store_idx" ON "store_research_runs" USING btree ("tenant_id","store_id") WHERE "store_research_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "stores_tenant_created_idx" ON "stores" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stores_tenant_google_place_idx" ON "stores" USING btree ("tenant_id","google_place_id");--> statement-breakpoint
CREATE INDEX "stores_tenant_lat_lng_idx" ON "stores" USING btree ("tenant_id","lat","lng") WHERE "stores"."lat" is not null and "stores"."lng" is not null;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_id_unique" UNIQUE("tenant_id","id");
