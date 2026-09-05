/**
 * 「stores を参照する子テーブル」と「削除影響カテゴリ」の一致を機械検証する
 * 不変条件テスト (Issue #229)。
 *
 * design.md §Revalidation Triggers は「stores を参照する新テーブルの追加時は
 * getDeleteImpact / カテゴリ定義 / FK ポリシー宣言の 3 点を同時更新する義務」を
 * 課しているが、#180 で store_research_runs を追加した際にこれが履行されず、
 * 本番 13 店舗 (75 run) の削除ダイアログが「紐づけデータはありません」と誤って
 * 断言する状態が続いた。義務を人間の注意力に委ねないための CI ガードである。
 *
 * 検証は drizzle の `getTableConfig` によるスキーマ**メタデータ**走査で行う
 * (走査の実体は `lib/db/store-child-fks.ts`。SQL 網羅性ガードと母集合を共有する)。
 * schema.ts をソース文字列として grep する方式は採らない — このリポジトリには
 * 「文字列検査テストが撤去記録コメントに自己ヒットして空虚に green になる」
 * 失敗事例があり、メタデータ走査ならその失敗モード自体が存在しないため。
 *
 * DB には接続しない (CI の test job はダミー DATABASE_URL しか持たない)。
 * ON DELETE の宣言と本番 DB 実態の一致は `pnpm db:verify-fks` が別途担保する。
 */

import { describe, expect, it, vi } from "vitest";
import { collectStoreChildForeignKeys } from "@/lib/db/store-child-fks";

// 対象モジュールは Server Action を import しており、その先の repos → lib/db が
// 実 DB 接続を試みるためモックで遮断する (store-delete-confirm-dialog.test.ts と同様)。
vi.mock("@/lib/actions/store-actions", () => ({
  getStoreDeleteImpactAction: vi.fn(),
}));

const { DELETE_IMPACT_CATEGORIES } = await import(
  "../store-delete-confirm-dialog"
);

/** ON DELETE 宣言と、ダイアログが表示する処理種別の対応。 */
const ON_DELETE_TO_EFFECT: Record<string, "delete" | "unlink"> = {
  cascade: "delete",
  "set null": "unlink",
};

describe("stores を参照する子テーブルと削除影響カテゴリの整合 (#229)", () => {
  it("stores 参照 FK は子テーブルごとに高々 1 本 (key = テーブル名の前提)", () => {
    // StoreDeleteImpact のキーは子テーブル名そのものを使う規約。1 テーブルから
    // stores へ FK が 2 本張られるとキーが衝突して本テストの前提が崩れるため、
    // その時点で落として設計を見直させる。
    const fks = collectStoreChildForeignKeys();
    const children = fks.map((fk) => fk.child);
    expect(new Set(children).size).toBe(children.length);
  });

  it("stores 参照 FK の子テーブル集合が DELETE_IMPACT_CATEGORIES の key 集合と一致する", () => {
    const fkChildren = collectStoreChildForeignKeys()
      .map((fk) => fk.child)
      .sort();
    const categoryKeys = DELETE_IMPACT_CATEGORIES.map((c) => c.key as string).sort();

    // 差分をメッセージに出さないと「どのテーブルを足すのか」が分からないため、
    // 集合そのものを比較する (toEqual の diff がそのまま作業指示になる)。
    expect(categoryKeys).toEqual(fkChildren);
  });

  it("各カテゴリの effect が FK の ON DELETE 宣言と対応する", () => {
    const byChild = new Map(
      collectStoreChildForeignKeys().map((fk) => [fk.child, fk]),
    );
    for (const category of DELETE_IMPACT_CATEGORIES) {
      const fk = byChild.get(category.key);
      expect(fk, `${category.key} に対応する stores 参照 FK が無い`).toBeDefined();
      const onDelete = fk?.onDelete;
      const expectedEffect = onDelete ? ON_DELETE_TO_EFFECT[onDelete] : undefined;
      // 対応表に無い ON DELETE (no action / restrict 等) が現れた場合はここで落ちる。
      // その FK は「削除で消える / 紐付けが外れる」のどちらでもないため、
      // カテゴリ定義に載せてよいか設計判断が要る。
      expect(
        expectedEffect,
        `${category.key} の ON DELETE (${onDelete ?? "no action"}) に対応する effect が未定義`,
      ).toBeDefined();
      expect(category.effect).toBe(expectedEffect);
    }
  });

  it("現行スキーマの stores 参照 FK を実測で固定する (4 本)", () => {
    // 上の 3 つは相対的な整合しか見ないため、両方から同時に漏れると通ってしまう。
    // 実測値を直に固定して、片側だけを直す修正でも気づけるようにする。
    const fks = collectStoreChildForeignKeys().sort((a, b) =>
      a.child.localeCompare(b.child),
    );
    expect(fks).toEqual([
      { child: "deals", column: "store_id", onDelete: "cascade" },
      {
        child: "handoffs",
        column: "store_id",
        onDelete: "cascade",
      },
      {
        child: "place_candidates",
        column: "matched_store_id",
        onDelete: "set null",
      },
      {
        child: "store_research_runs",
        column: "store_id",
        onDelete: "cascade",
      },
    ]);
  });
});
