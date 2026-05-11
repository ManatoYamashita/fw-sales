CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"read_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "assigned_sales_user_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "assigned_planner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "assigned_sales_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_assigned_sales_user_id_profiles_id_fk" FOREIGN KEY ("assigned_sales_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_assigned_planner_user_id_profiles_id_fk" FOREIGN KEY ("assigned_planner_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_assigned_sales_user_id_profiles_id_fk" FOREIGN KEY ("assigned_sales_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ============================================================================
-- auth.users → public.profiles の cross-schema FK と自動展開 trigger
-- (drizzle-kit では cross-schema FK / trigger を表現できないため、本マイグレーションで
--  raw SQL を直接記述する)
-- ============================================================================
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_auth_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint
-- ============================================================================
-- notifications.user_id 検索の高速化 (通知ベル UI のクエリは高頻度)
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" ("user_id");--> statement-breakpoint
-- ============================================================================
-- auth.users への INSERT 発火時に public.profiles を自動展開する関数 / trigger
--   - SECURITY DEFINER で auth.users への権限を保持
--   - role は default 'member' で初期化
--   - display_name は raw_user_meta_data.name → email の順にフォールバック
--   - avatar_url は raw_user_meta_data.picture (Google OAuth)
--   - created_at / updated_at は JST の YYYY-MM-DD で初期化 (既存規約)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
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
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();