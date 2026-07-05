-- #152: 店舗系 FK 4 本を ON DELETE CASCADE で再宣言する是正 migration。
--
-- 背景: 0015_store_cascade_delete は本番 DB へ未適用のまま、0016 以降の適用で
-- drizzle migrator の水位線 (最終適用行の created_at) に追い越され永久スキップとなった。
-- その結果、本番の deals / research / handoffs の FK は ON DELETE 句なし (NO ACTION) で残存し、
-- 紐づけデータを持つ店舗の削除が SQLSTATE 23503 でブロックされていた。
--
-- 設計 (design.md §Data Models):
-- - 制約 1 本 = 1 文。DROP CONSTRAINT IF EXISTS と ADD CONSTRAINT を同一 ALTER TABLE に
--   束ねることで statement 原子性を確保し、「制約が存在しない窓」を作らない。
-- - 冪等: 既に CASCADE の環境に適用しても同一結果に収束する。
-- - place_candidates (ON DELETE SET NULL) は 0020 で適用済みのため触れない。
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_store_id_stores_id_fk", ADD CONSTRAINT "deals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" DROP CONSTRAINT IF EXISTS "research_store_id_stores_id_fk", ADD CONSTRAINT "research_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" DROP CONSTRAINT IF EXISTS "handoffs_store_id_stores_id_fk", ADD CONSTRAINT "handoffs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" DROP CONSTRAINT IF EXISTS "handoffs_deal_id_deals_id_fk", ADD CONSTRAINT "handoffs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
