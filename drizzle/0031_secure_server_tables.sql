ALTER TABLE "ai_prompt_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_research_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- サーバーのowner/BYPASSRLS接続でのみ業務データへアクセスします。
-- RLS対象外のTRUNCATE等も含め、Data APIのクライアント権限を撤回します。
REVOKE ALL ON TABLE public.ai_prompt_templates, public.app_settings, public.deals,
  public.event_logs, public.handoffs, public.notifications, public.place_candidates,
  public.profiles, public.store_research_runs, public.stores FROM PUBLIC;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS private;
--> statement-breakpoint
ALTER FUNCTION public.handle_new_user() SET SCHEMA private;
--> statement-breakpoint
ALTER FUNCTION private.handle_new_user() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.prevent_default_prompt_template_deletion() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.check_prompt_template_limit() SET search_path = public, pg_temp;
--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.handle_new_user(),
  public.prevent_default_prompt_template_deletion(), public.check_prompt_template_limit() FROM PUBLIC;
--> statement-breakpoint
-- 通常のローカルPostgreSQLにはSupabase固有ロールが無いため、存在を確認します。
DO $$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.ai_prompt_templates, public.app_settings,
        public.deals, public.event_logs, public.handoffs, public.notifications,
        public.place_candidates, public.profiles, public.store_research_runs, public.stores FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON FUNCTION private.handle_new_user(),
        public.prevent_default_prompt_template_deletion(), public.check_prompt_template_limit() FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON SCHEMA private FROM %I', client_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', client_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
