/**
 * `stores` を親とする外部キーを schema.ts のメタデータから列挙する読み取り専用ヘルパー
 * (Issue #229)。
 *
 * DB へは接続せず、drizzle の `getTableConfig` が返す宣言だけを見る。削除影響カウントの
 * 「子テーブル取りこぼし」を CI で検出する 2 つのガードが、同一の母集合を参照するための
 * 単一の真実である。
 *
 * - `store-cascade-fk-coverage.test.ts` — 子テーブル集合と `DELETE_IMPACT_CATEGORIES` の一致
 * - `store-repository.delete-impact.test.ts` — `getDeleteImpact` が発行する SQL の網羅性
 *
 * 各ガードが対象テーブルを直値で持つと、それは「更新すべき snapshot」であってガードでは
 * なくなる。5 本目の子テーブルが増えたとき、カテゴリとマッピングだけ追加してスカラー
 * サブクエリを書き忘れた実装が緑のまま通り、新カテゴリが常に 0 件と表示される — #229 で
 * 本番 13 店舗が「紐づけデータはありません」と誤表示したのと同じ経路が再来する。
 * 導出元をここへ寄せることで、schema.ts への子テーブル追加が両ガードへ自動的に波及する。
 */

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export interface StoreChildForeignKey {
  /** 子テーブルの物理名 */
  child: string;
  /** FK を構成する列名 (複合 FK はカンマ区切り) */
  column: string;
  /** drizzle の onDelete 宣言。未指定は undefined (= NO ACTION) */
  onDelete: string | undefined;
}

/**
 * schema.ts の全 export を走査し、`stores` を親とする FK を列挙する。
 * テーブル以外の export (型・enum・ヘルパー) は getTableConfig が例外を投げるので読み飛ばす。
 */
export function collectStoreChildForeignKeys(): StoreChildForeignKey[] {
  const found: StoreChildForeignKey[] = [];
  for (const exported of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(exported as PgTable);
    } catch {
      continue;
    }
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (getTableConfig(ref.foreignTable).name !== "stores") continue;
      found.push({
        child: config.name,
        column: ref.columns.map((c) => c.name).join(","),
        onDelete: fk.onDelete,
      });
    }
  }
  return found;
}
