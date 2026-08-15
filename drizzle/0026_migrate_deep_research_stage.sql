-- store.stage の4値→3値移行("DeepResearch済み" を撤去、AI 店舗調査再設計 Plan v3.2 §15, PR5)
-- 列自体は text 型のまま(CHECK 制約なし)のため、データ移行のみで完結する。
UPDATE stores SET stage = '調査済み' WHERE stage = 'DeepResearch済み';
