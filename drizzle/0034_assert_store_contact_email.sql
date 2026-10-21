-- #384 Phase 2: 0033 で既に作成した stores.contact_email の定義だけを検証する。
-- add/drop/alter は実行しない。定義が異なる場合は安全に停止する。
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