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

-- ============================================================================
-- デフォルトテンプレート削除拒否 trigger
--
-- is_default = true のテンプレートを DELETE しようとした場合にエラーを返す。
-- Server Action 側でも Phase 2 でガードを実装するが、DB trigger で二重保護する。
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_default_prompt_template_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_default = true THEN
    RAISE EXCEPTION
      'デフォルトテンプレートは削除できません。先に別のテンプレートをデフォルトに設定してください。 (id: %)',
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
