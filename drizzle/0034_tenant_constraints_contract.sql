-- #371 contract: 0033と複合キー対応コードの本番反映後にだけ適用する。
-- 全DDLをDrizzleのtransactionで適用する。既存の越境参照はFK追加時に失敗し、全体が戻る。
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DO $$ BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'tenant contract requires PostgreSQL 15 or later';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "handoffs" DROP CONSTRAINT "handoffs_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "handoffs" DROP CONSTRAINT "handoffs_deal_id_deals_id_fk";
--> statement-breakpoint
ALTER TABLE "place_candidates" DROP CONSTRAINT "place_candidates_matched_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "store_research_runs" DROP CONSTRAINT "store_research_runs_store_id_stores_id_fk";
--> statement-breakpoint
DROP INDEX "deals_store_id_idx";--> statement-breakpoint
DROP INDEX "handoffs_store_id_idx";--> statement-breakpoint
DROP INDEX "handoffs_deal_id_idx";--> statement-breakpoint
DROP INDEX "place_candidates_google_place_id_idx";--> statement-breakpoint
DROP INDEX "place_candidates_matched_store_id_idx";--> statement-breakpoint
DROP INDEX "store_research_runs_store_started_idx";--> statement-breakpoint
DROP INDEX "store_research_runs_running_store_idx";--> statement-breakpoint
DROP INDEX "stores_google_place_id_idx";--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_pkey";--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "event_logs" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "handoffs" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "place_candidates" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "store_research_runs" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_key_pk" PRIMARY KEY USING INDEX "app_settings_tenant_key_idx";--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_store_fk" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_store_fk" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_candidates" ADD CONSTRAINT "place_candidates_tenant_store_fk" FOREIGN KEY ("tenant_id","matched_store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE SET NULL ("matched_store_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_research_runs" ADD CONSTRAINT "store_research_runs_tenant_store_fk" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_created_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- 0033でテナント×ユーザーの部分uniqueを追加済み。旧global制約だけを外す。
DROP INDEX "ai_prompt_templates_default_idx";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.check_prompt_template_limit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE template_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id = OLD.tenant_id AND NEW.user_id = OLD.user_id THEN RETURN NEW; END IF;
  END IF;
  -- 接続プールを跨いでも有効なtransaction lock。会社とユーザーの組で直列化する。
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text), hashtext(NEW.user_id::text));
  SELECT count(*) INTO template_count FROM public.ai_prompt_templates
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id;
  IF template_count >= 5 THEN
    RAISE EXCEPTION 'テンプレートは最大5件まで作成できます';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER ai_prompt_templates_check_limit ON public.ai_prompt_templates;
--> statement-breakpoint
CREATE TRIGGER ai_prompt_templates_check_limit
  BEFORE INSERT OR UPDATE OF tenant_id, user_id ON public.ai_prompt_templates
  FOR EACH ROW EXECUTE FUNCTION public.check_prompt_template_limit();
