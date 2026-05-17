-- ============================================================================
-- Migration 0005: 旧担当者 text 列の DROP (auth-and-notifications Phase 2)
-- ----------------------------------------------------------------------------
-- 前提:
--   - 0004 マイグレーション (assigned_*_user_id uuid 列追加 + profiles テーブル) 適用済
--   - scripts/backfill-assignees.ts --apply 完了 (旧 text 値が新 uuid 列にマップ済)
--   - Phase 7 で全アプリ層が user_id 主参照に切替済 (旧 text 列への書込みが空文字に固定)
--
-- ロールバック注意 (design.md §Migration Strategy):
--   本マイグレーション適用後は旧 text 値が DB 上から完全消失するため、Phase 1 と異なり
--   単純な ALTER ADD COLUMN では rollback できない。データ復元が必要な場合は backup から
--   個別 UPDATE を組む必要があるため、ステージング環境での十分な検証を前提に適用する。
-- ============================================================================
ALTER TABLE "deals" DROP COLUMN "assigned_sales";--> statement-breakpoint
ALTER TABLE "stores" DROP COLUMN "assigned_planner";--> statement-breakpoint
ALTER TABLE "stores" DROP COLUMN "assigned_sales";