/**
 * 店舗系 FK の ON DELETE 実態を検証する読み取り専用スクリプト (#152)。
 *
 * 検証内容 (design.md §Data Models の FK ポリシー宣言と DB 実態の一致):
 * - deals.store_id / store_research_runs.store_id / handoffs.store_id /
 *   handoffs.deal_id → ON DELETE CASCADE
 *   (Issue #110 で research テーブルを DROP したため対象から外した)
 * - place_candidates.matched_store_id → ON DELETE SET NULL
 *
 * 検証は 2 方向で行う (Issue #229):
 * 1. 順方向 — EXPECTED の各制約が宣言どおりの ON DELETE を持つか
 * 2. 逆方向 — stores を親とする FK を pg_constraint から全数列挙し、EXPECTED に
 *    未登録のものが無いか。1 だけだと「知っている制約しか見ない」ため、子テーブルが
 *    増えても黙って通ってしまう。実際 #180 の store_research_runs はこの穴を通り、
 *    削除確認ダイアログの影響カウントからも漏れたまま本番稼働した。
 *
 * 不一致・未登録・存在しない制約があれば一覧を出力して exit 1、全一致で exit 0。
 * pg_constraint への SELECT のみでデータ・スキーマへの書き込みは一切行わない。
 *
 * 実行: `pnpm db:verify-fks` (DATABASE_URL は .env.local または環境変数から供給)。
 * 接続様式は supabase-keepalive.yml と同一 (Node postgres / prepare:false / 単一接続)。
 * psql (libpq) は DATABASE_URL 中の特殊文字を host と誤読するため使わない。
 * 接続文字列の値はログに出力しない。
 *
 * 期待値 (EXPECTED) は `_store-fk-policy.mjs` に置き、schema.ts 宣言との突合を行う
 * Vitest ガード (store-cascade-fk-coverage.test.ts) と共有する (#241)。本ファイルは
 * import しただけで DB へ接続し exit する副作用を持つため、期待値の側を切り出してある。
 */
import postgres from "postgres";

import { DELTYPE_LABEL, EXPECTED } from "./_store-fk-policy.mjs";

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
  // EXPECTED の制約 (stores 以外を親とする handoffs.deal_id を含む) に加えて、
  // stores を親とする FK を全数取得する。後者が逆方向チェックの母集合になる。
  const rows = await sql`
    select conname,
           conrelid::regclass::text as child,
           confrelid::regclass::text as parent,
           confdeltype,
           pg_get_constraintdef(oid) as def
    from pg_constraint
    where contype = 'f'
      and (conname = any(${EXPECTED.map((e) => e.conname)})
           or confrelid = 'stores'::regclass)`;
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

  // 逆方向: stores を親とする FK のうち EXPECTED に無いものを検出する。
  const expectedNames = new Set(EXPECTED.map((e) => e.conname));
  const storeChildren = rows.filter((r) => r.parent === "stores");
  const unregistered = storeChildren.filter((r) => !expectedNames.has(r.conname));
  for (const row of unregistered) {
    const got = DELTYPE_LABEL[row.confdeltype] ?? row.confdeltype;
    console.error(`NG ${row.child} | ${row.conname}`);
    console.error(
      `   stores を親とする FK が EXPECTED に未登録です (ON DELETE ${got})`,
    );
    console.error(
      "   → scripts/_store-fk-policy.mjs の EXPECTED と、削除確認ダイアログの" +
        " DELETE_IMPACT_CATEGORIES / StoreDeleteImpact への追加が必要です",
    );
  }

  await sql.end({ timeout: 5 });
  if (failures > 0 || unregistered.length > 0) {
    if (failures > 0) {
      console.error(
        `\nVERIFY FAILED: ${failures}/${EXPECTED.length} 件の FK が期待と不一致です。` +
          " migration 0021 (#152) の適用状況を確認してください。",
      );
    }
    if (unregistered.length > 0) {
      console.error(
        `\nVERIFY FAILED: stores を親とする FK ${unregistered.length} 件が未登録です。` +
          " 子テーブル追加時の影響カウント漏れ (#229) と同じ経路です。",
      );
    }
    process.exit(1);
  }
  console.log(
    `\nVERIFY OK: ${EXPECTED.length} 件の FK がすべて期待どおりです` +
      ` (stores を親とする FK ${storeChildren.length} 件を全数走査し、未登録 0 件)。`,
  );
} catch (err) {
  console.error("VERIFY ERROR:", err instanceof Error ? err.message : String(err));
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
