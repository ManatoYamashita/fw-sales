/**
 * 店舗系 FK ポリシーの期待値 (Issue #152 / #229 / #241)。
 *
 * `verify-store-cascade-fks.mjs` (本番 DB との突合) と
 * `store-cascade-fk-coverage.test.ts` (schema.ts 宣言との突合) の双方が、
 * 同一の期待値を参照するための単一の真実である。
 *
 * このモジュールは副作用を一切持たない純データである。スクリプト本体へ
 * `export` を足す形にしなかったのは、本体がトップレベルで DATABASE_URL 検査 →
 * `process.exit(1)` / 接続生成 / top-level await の SELECT を実行するため、
 * import した時点で Vitest プロセスごと落ちるからである。本体を `main()` +
 * エントリポイントガードで包む案は採らない — ガード判定が false に転んだとき、
 * 検証スクリプトが「何も検証せずに exit 0」する失敗モードが生まれる。
 * ドリフト検知器が黙って緑になるのは、このリポジトリが最も避けてきた事故である。
 */

/**
 * 期待する ON DELETE 挙動。
 * `deltype` は `pg_constraint.confdeltype` の生値 (下の DELTYPE_LABEL のキー)。
 *
 * `stores` を親としない `handoffs_deal_id_deals_id_fk` を含む点に注意。
 * 「stores を親とする FK の全数」と本配列を突き合わせるときは、この 1 件を
 * 母集合から外す必要がある (件数の単純比較は誤検知する)。
 */
export const EXPECTED = [
  { child: "deals", conname: "deals_store_id_stores_id_fk", deltype: "c" },
  {
    child: "store_research_runs",
    conname: "store_research_runs_store_id_stores_id_fk",
    deltype: "c",
  },
  { child: "handoffs", conname: "handoffs_store_id_stores_id_fk", deltype: "c" },
  { child: "handoffs", conname: "handoffs_deal_id_deals_id_fk", deltype: "c" },
  {
    child: "place_candidates",
    conname: "place_candidates_matched_store_id_stores_id_fk",
    deltype: "n",
  },
];

/** `pg_constraint.confdeltype` の生値と SQL 上の表記の対応。 */
export const DELTYPE_LABEL = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};
