-- #384 Phase 2: 0033 で追加済みの stores.contact_email が、schema.ts と同じ定義 (text / NOT NULL / DEFAULT '') かを確かめる。
-- schema.ts に列を足すと db:generate は同じ ADD COLUMN を再び作るため、その中身をこの確認ブロックに置き換えた
-- (docs/store-contact-email-rollout.md)。列の追加・削除・変更はしない。列が無い場合と定義が違う場合は
-- migration 全体を失敗させ、トランザクションごと ROLLBACK する。
--
-- information_schema.columns を読む間だけ、stores の AccessShare ロックを一瞬取る (読み終えるとすぐ放す)。
-- 通常の読み書きとはぶつからないが、ほかの DDL が stores の排他ロックを持っていると待つため、0033 と同じく
-- 待ちを 3 秒で打ち切る (打ち切った場合は何も変わらないので、Apply Migrations の失敗したジョブを再実行する)。
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
DO $$
DECLARE
  col record;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'contact_email';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stores.contact_email がありません。0033 の適用を確認してください。';
  END IF;
  IF col.data_type <> 'text'
    OR col.is_nullable <> 'NO'
    OR col.column_default IS DISTINCT FROM '''''::text'
  THEN
    RAISE EXCEPTION 'stores.contact_email の定義が異なります(type=%, nullable=%, default=%)',
      col.data_type, col.is_nullable, col.column_default;
  END IF;
END $$;
