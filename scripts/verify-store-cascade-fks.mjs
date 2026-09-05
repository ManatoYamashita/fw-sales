/**
 * 店舗系 FK の ON DELETE 実態を検証する読み取り専用スクリプト (#152)。
 *
 * 検証内容 (design.md §Data Models の FK ポリシー宣言と DB 実態の一致):
 * - deals.store_id / handoffs.store_id / handoffs.deal_id → ON DELETE CASCADE
 *   (Issue #110 で research テーブルを DROP したため対象から外した)
 * - place_candidates.matched_store_id → ON DELETE SET NULL
 *
 * 一致しない・存在しない制約があれば一覧を出力して exit 1、全一致で exit 0。
 * pg_constraint への SELECT のみでデータ・スキーマへの書き込みは一切行わない。
 *
 * 実行: `pnpm db:verify-fks` (DATABASE_URL は .env.local または環境変数から供給)。
 * 接続様式は supabase-keepalive.yml と同一 (Node postgres / prepare:false / 単一接続)。
 * psql (libpq) は DATABASE_URL 中の特殊文字を host と誤読するため使わない。
 * 接続文字列の値はログに出力しない。
 */
import postgres from "postgres";

/** 期待する ON DELETE 挙動。confdeltype: c=CASCADE, n=SET NULL, a=NO ACTION, r=RESTRICT, d=SET DEFAULT */
const EXPECTED = [
  { child: "deals", conname: "deals_store_id_stores_id_fk", deltype: "c" },
  { child: "handoffs", conname: "handoffs_store_id_stores_id_fk", deltype: "c" },
  { child: "handoffs", conname: "handoffs_deal_id_deals_id_fk", deltype: "c" },
  {
    child: "place_candidates",
    conname: "place_candidates_matched_store_id_stores_id_fk",
    deltype: "n",
  },
];

const DELTYPE_LABEL = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
});

try {
  const rows = await sql`
    select conname,
           conrelid::regclass::text as child,
           confdeltype,
           pg_get_constraintdef(oid) as def
    from pg_constraint
    where contype = 'f'
      and conname = any(${EXPECTED.map((e) => e.conname)})`;
  const byName = new Map(rows.map((r) => [r.conname, r]));

  let failures = 0;
  for (const expected of EXPECTED) {
    const actual = byName.get(expected.conname);
    const want = DELTYPE_LABEL[expected.deltype];
    if (!actual) {
      failures++;
      console.error(`NG ${expected.child} | ${expected.conname}`);
      console.error(`   expected: ON DELETE ${want} / actual: 制約が存在しません`);
      continue;
    }
    if (actual.child !== expected.child || actual.confdeltype !== expected.deltype) {
      failures++;
      const got = DELTYPE_LABEL[actual.confdeltype] ?? actual.confdeltype;
      console.error(`NG ${actual.child} | ${expected.conname}`);
      console.error(`   expected: ON DELETE ${want} / actual: ON DELETE ${got}`);
      console.error(`   def: ${actual.def}`);
      continue;
    }
    console.log(`OK ${expected.child} | ${expected.conname} | ON DELETE ${want}`);
  }

  await sql.end({ timeout: 5 });
  if (failures > 0) {
    console.error(
      `\nVERIFY FAILED: ${failures}/${EXPECTED.length} 件の FK が期待と不一致です。` +
        " migration 0021 (#152) の適用状況を確認してください。",
    );
    process.exit(1);
  }
  console.log(`\nVERIFY OK: ${EXPECTED.length} 件の FK がすべて期待どおりです。`);
} catch (err) {
  console.error("VERIFY ERROR:", err instanceof Error ? err.message : String(err));
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
