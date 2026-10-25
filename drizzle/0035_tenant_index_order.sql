-- ORDER BY ... DESCの既定NULLS FIRSTに合わせ、追加した索引でSortを省略できるようにする。
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DROP INDEX "ai_prompt_templates_tenant_user_created_idx";--> statement-breakpoint
DROP INDEX "deals_tenant_created_idx";--> statement-breakpoint
DROP INDEX "handoffs_tenant_created_idx";--> statement-breakpoint
DROP INDEX "notifications_tenant_user_created_idx";--> statement-breakpoint
DROP INDEX "store_research_runs_tenant_store_started_idx";--> statement-breakpoint
DROP INDEX "stores_tenant_created_idx";--> statement-breakpoint
CREATE INDEX "ai_prompt_templates_tenant_user_created_idx" ON "ai_prompt_templates" USING btree ("tenant_id","user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "deals_tenant_created_idx" ON "deals" USING btree ("tenant_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "handoffs_tenant_created_idx" ON "handoffs" USING btree ("tenant_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_created_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "store_research_runs_tenant_store_started_idx" ON "store_research_runs" USING btree ("tenant_id","store_id","started_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "stores_tenant_created_idx" ON "stores" USING btree ("tenant_id","created_at" DESC NULLS FIRST);
