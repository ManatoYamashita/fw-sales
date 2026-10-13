-- 撤去済み Deep Research 自動パイプライン (#43 → #105 で手動貼付へ移行、#185 で通知種別撤去) が
-- 残した通知を削除する (#296)。
-- - 発行元はアプリ内に存在せず、二度と増えない (kind はアプリ側 NotificationKind に無い値)
-- - 本文が内部用語 (api_updated_at / sweep / invalid_json / finishReason) のまま
-- - 「再投入が可能です」と案内するが、再投入 UI は撤去済み
-- - リンク先の多くが削除済み店舗 (2026-10-07 時点で 24 件中 23 件)
-- 既読化では「中身の無い既読通知」がベルに残り続けるため、行ごと削除する。
-- スキーマ変更を含まないデータ移行のみ (0026 と同じ手書き migration)。
DELETE FROM notifications
WHERE kind IN ('deep_research_done', 'deep_research_failed', 'deep_research_budget_warning');
