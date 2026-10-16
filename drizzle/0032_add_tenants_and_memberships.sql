-- マルチテナント化 (#365) の土台です (#366)。tenants と memberships を作り、業務 9 テーブルへ tenant_id を足します。
-- 既存の行と、tenant_id をまだ知らないアプリ (lib/db/schema.ts への反映は #367) が書く行は、既定値で Firstweb テナントに入ります。
-- 定数の既定値付きの ADD COLUMN はテーブルを書き換えないため、tenant_id が NULL の期間はできません。既定値は #371 で外します。
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Firstweb テナントです。ID は tenant_id の既定値・アプリ側の定数 (FIRSTWEB_TENANT_ID) と同じ固定値にします。
-- 業務テーブルの外部キーが既存行を検証する前に、参照先の行を作っておきます。
INSERT INTO "tenants" ("id", "slug", "name", "created_at", "updated_at")
VALUES (
  'cfe871a5-8fc7-42da-9677-3a050665cafb',
  'firstweb',
  'Firstweb',
  to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
  to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "memberships_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_logs" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "place_candidates" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_research_runs" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "tenant_id" uuid DEFAULT 'cfe871a5-8fc7-42da-9677-3a050665cafb' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_candidates" ADD CONSTRAINT "place_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_research_runs" ADD CONSTRAINT "store_research_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- 既存のユーザー全員を、今のロール (admin / member / placeholder) のまま Firstweb の所属にします。
INSERT INTO "memberships" ("tenant_id", "user_id", "role", "created_at", "updated_at")
SELECT
  'cfe871a5-8fc7-42da-9677-3a050665cafb',
  "id",
  "role",
  "created_at",
  to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')
FROM "profiles";
--> statement-breakpoint
-- 0028 と同じく、クライアント用のポリシーは作らず、RLS 対象外の TRUNCATE も含めて Data API の権限を撤回します。
-- 読み書きするのはサーバーの owner/BYPASSRLS 接続だけです。FORCE ROW LEVEL SECURITY は付けません。
REVOKE ALL ON TABLE "public"."tenants", "public"."memberships" FROM PUBLIC;
--> statement-breakpoint
-- 通常のローカルPostgreSQLにはSupabase固有ロールが無いため、存在を確認します。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."tenants", "public"."memberships" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."tenants", "public"."memberships" FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
-- 新規ユーザーにも Firstweb の所属を作ります。「ログインできた人は全員 Firstweb のメンバー」という今の挙動を
-- 保つための暫定措置で、招待制 (#374) で置き換えます。プロフィールの作成は 0004 から変えていません。
-- CREATE OR REPLACE は所有者と権限 (0031 の REVOKE) を保ちますが、それ以外の属性は書いたものに置き換わるため、
-- SECURITY DEFINER と search_path の固定 (0031) をここで書き直します。
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url, role, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email),
    NEW.raw_user_meta_data ->> 'picture',
    'member',
    to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
    to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')
  );
  INSERT INTO public.memberships (tenant_id, user_id, role, created_at, updated_at)
  VALUES (
    'cfe871a5-8fc7-42da-9677-3a050665cafb',
    NEW.id,
    'member',
    to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
    to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
