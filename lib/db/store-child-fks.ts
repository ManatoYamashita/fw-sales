/**
 * schema.ts が宣言する外部キーを、DB へ接続せずにメタデータから列挙する読み取り専用
 * ヘルパー (Issue #229 / #241)。
 *
 * drizzle の `getTableConfig` が返す宣言だけを見る。子テーブルの取りこぼしを CI で検出する
 * 3 つのガードが、同一の母集合を参照するための単一の真実である。
 *
 * - `store-cascade-fk-coverage.test.ts` — 子テーブル集合と `DELETE_IMPACT_CATEGORIES` の一致、
 *   および FK ポリシー期待値 (`scripts/_store-fk-policy.mjs` の `EXPECTED`) との一致
 * - `store-repository.delete-impact.test.ts` — `getDeleteImpact` が発行する SQL の網羅性
 *
 * 各ガードが対象テーブルを直値で持つと、それは「更新すべき snapshot」であってガードでは
 * なくなる。5 本目の子テーブルが増えたとき、カテゴリとマッピングだけ追加してスカラー
 * サブクエリを書き忘れた実装が緑のまま通り、新カテゴリが常に 0 件と表示される — #229 で
 * 本番 13 店舗が「紐づけデータはありません」と誤表示したのと同じ経路が再来する。
 * 導出元をここへ寄せることで、schema.ts への子テーブル追加が全ガードへ自動的に波及する。
 */

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export interface ForeignKeyDeclaration {
  /**
   * drizzle が生成する制約名 (`pg_constraint.conname` と一致する)。
   * 命名規約 (`<child>_<column>_<parent>_<column>_fk`) を文字列で組み立てず、
   * drizzle 自身の `ForeignKey#getName()` から取る。drizzle-kit が DDL を生成するときと
   * 同じ関数のため、本番に存在する制約名と定義上ずれない。
   */
  name: string;
  /** 子テーブルの物理名 */
  child: string;
  /** FK を構成する列名 (複合 FK はカンマ区切り) */
  column: string;
  /** 親テーブルの物理名 */
  parent: string;
  /** drizzle の onDelete 宣言。未指定は undefined (= NO ACTION) */
  onDelete: string | undefined;
}

export interface StoreChildForeignKey {
  /** 子テーブルの物理名 */
  child: string;
  /** FK を構成する列名 (複合 FK はカンマ区切り) */
  column: string;
  /** drizzle の onDelete 宣言。未指定は undefined (= NO ACTION) */
  onDelete: string | undefined;
}

/**
 * schema.ts の全 export を走査し、宣言されている FK を親テーブルによらず列挙する。
 * テーブル以外の export (型・enum・ヘルパー) は getTableConfig が例外を投げるので読み飛ばす。
 *
 * FK ポリシー期待値との突合は親が `stores` 以外のエントリ
 * (`handoffs.deal_id → deals.id`) も対象にするため、`stores` で絞らない母集合が要る。
 */
export function collectForeignKeyDeclarations(): ForeignKeyDeclaration[] {
  const found: ForeignKeyDeclaration[] = [];
  for (const exported of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(exported as PgTable);
    } catch {
      continue;
    }
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      found.push({
        name: fk.getName(),
        child: config.name,
        column: ref.columns.map((c) => c.name).join(","),
        parent: getTableConfig(ref.foreignTable).name,
        onDelete: fk.onDelete,
      });
    }
  }
  return found;
}

/**
 * `stores` を親とする FK を列挙する (削除影響カウント系ガードの母集合)。
 */
export function collectStoreChildForeignKeys(): StoreChildForeignKey[] {
  return collectForeignKeyDeclarations()
    .filter((fk) => fk.parent === "stores")
    .map(({ child, column, onDelete }) => ({ child, column, onDelete }));
}
