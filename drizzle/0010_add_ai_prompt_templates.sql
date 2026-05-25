-- ============================================================================
-- Migration 0009: ai_prompt_templates テーブル追加 (Issue #42)
--
-- 目的:
--   ユーザー別 Gemini プロンプトテンプレート機能の DB 土台を追加する。
--   各ユーザーは最大 5 件のテンプレートを保持し、1 件をデフォルトとして指定できる。
--
-- 注意:
--   - is_default = true の partial unique index は Drizzle ORM で表現できないため
--     raw SQL で追加する (drizzle-kit generate を実行しても上書きされない)
--   - デフォルトテンプレートの削除拒否は DB trigger で保証する
--   - RLS は Supabase ダッシュボードで別途設定すること (既存プロジェクトの規約に従う)
--     → 設定すべきポリシー:
--       SELECT / INSERT / UPDATE / DELETE はすべて auth.uid() = user_id のみ許可
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ai_prompt_templates" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    uuid        NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "name"       text        NOT NULL,
  "is_default" boolean     NOT NULL DEFAULT false,
  "body"       text        NOT NULL,
  "created_at" text        NOT NULL,
  "updated_at" text        NOT NULL
);
--> statement-breakpoint

-- user_id による検索の高速化 (テンプレート一覧取得・件数チェック)
CREATE INDEX IF NOT EXISTS "ai_prompt_templates_user_idx"
  ON "ai_prompt_templates" ("user_id");
--> statement-breakpoint

-- 1 ユーザーにつきデフォルトテンプレートは 1 件のみ許可する partial unique index
-- (Drizzle ORM 非対応のため raw SQL で追加)
CREATE UNIQUE INDEX IF NOT EXISTS "ai_prompt_templates_default_idx"
  ON "ai_prompt_templates" ("user_id")
  WHERE "is_default" = true;
--> statement-breakpoint

-- Enable RLS for direct Supabase access.
-- Policies are managed outside this migration.
ALTER TABLE ai_prompt_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ============================================================================
-- デフォルトテンプレート削除拒否 trigger
--
-- is_default = true のテンプレートを直接 DELETE しようとした場合にエラーを返す。
-- CASCADE 経由 (profile 削除等) の DELETE は pg_trigger_depth() で検出してスキップ。
-- Server Action 側でも Phase 2 でガードを実装するが、DB trigger で二重保護する。
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_default_prompt_template_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- CASCADE 経由(profile 削除等)はスキップ。直接 DELETE のみ拒否。
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF OLD.is_default = true THEN
    RAISE EXCEPTION
      'デフォルトテンプレートは削除できません (id: %)',
      OLD.id;
  END IF;

  RETURN OLD;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS ai_prompt_templates_prevent_default_delete
  ON "ai_prompt_templates";
--> statement-breakpoint

CREATE TRIGGER ai_prompt_templates_prevent_default_delete
  BEFORE DELETE ON "ai_prompt_templates"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_default_prompt_template_deletion();
--> statement-breakpoint

-- ============================================================================
-- 1 ユーザー最大 5 件制限 trigger (H-1: race condition 対応)
--
-- advisory transaction lock で同一 user_id の同時 INSERT を直列化した上で
-- 件数チェックを行う。アクション層の countByUser チェックは二重ガードとして残す。
-- ============================================================================
CREATE OR REPLACE FUNCTION check_prompt_template_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  template_count integer;
BEGIN
  -- 同一ユーザーの同時作成を直列化する (hashtext は user_id uuid → bigint)
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));

  SELECT count(*) INTO template_count
  FROM ai_prompt_templates
  WHERE user_id = NEW.user_id;

  IF template_count >= 5 THEN
    RAISE EXCEPTION
      'テンプレートは最大5件まで作成できます (user_id: %)',
      NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS ai_prompt_templates_check_limit
  ON "ai_prompt_templates";
--> statement-breakpoint

CREATE TRIGGER ai_prompt_templates_check_limit
  BEFORE INSERT ON "ai_prompt_templates"
  FOR EACH ROW
  EXECUTE FUNCTION check_prompt_template_limit();
