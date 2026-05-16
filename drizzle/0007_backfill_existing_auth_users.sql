-- ============================================================================
-- Migration 0007: 既存 auth.users への profiles backfill (Issue #28)
-- ----------------------------------------------------------------------------
-- 経緯:
--   0004 で導入した `handle_new_user()` trigger は `AFTER INSERT ON auth.users`
--   で発火するため、本 migration 適用時点で既に `auth.users` に存在するユーザー
--   には遡及発火しない。その結果、Phase 1-6 完了済みの新規環境で初回ログイン
--   すると `/dashboard` の `profiles where id = $1` クエリが Failed query で
--   落ちる事故が 2026-05-16 に発生。
-- ----------------------------------------------------------------------------
-- 適用内容:
--   - 既存 `auth.users` 全件について、対応する `public.profiles` row が無い
--     ものを冪等に INSERT
--   - 列マッピングは 0004 の `handle_new_user()` 関数と完全一致
--     (差異が出ると trigger 経由分と backfill 分で揺れるため厳守)
--   - 冪等性は `ON CONFLICT (id) DO NOTHING` で担保 (再実行・反復適用安全)
--   - 結果として `SELECT COUNT(*) FROM auth.users = SELECT COUNT(*) FROM profiles`
--     が成立する (email が NULL のレコードは除外)
-- ----------------------------------------------------------------------------
-- 関連: profile-repository.ts (`@scripts/backfill-assignees.ts` 参照は obsolete、
--       本 migration が同等の責務を恒久的に担う)
-- ============================================================================
INSERT INTO public.profiles (
  id,
  email,
  display_name,
  avatar_url,
  role,
  created_at,
  updated_at
)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data ->> 'name', u.email),
  u.raw_user_meta_data ->> 'picture',
  'member',
  to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
  to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO NOTHING;
