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
 * 義務 3 (`scripts/verify-store-cascade-fks.mjs` が使う FK ポリシー期待値への登録) も
 * 同じ母集合で突き合わせる (Issue #241)。期待値は `scripts/_store-fk-policy.mjs` に
 * 切り出してあり、本テストと検証スクリプトの双方がそこを唯一の真実として読む。
 * これが無いと、義務 1 と 2 を正しく履行し 3 だけ忘れた変更が PR を緑で通過し、
 * 本番へ DDL が当たった後の `db:verify-fks` (逆方向チェック) で初めて落ちる。
 *
 * DB には接続しない (CI の test job はダミー DATABASE_URL しか持たない)。
 * ON DELETE の宣言と本番 DB 実態の一致は `pnpm db:verify-fks` が別途担保する。
 */

import { describe, expect, it, vi } from "vitest";
import {
  collectForeignKeyDeclarations,
  collectStoreChildForeignKeys,
} from "@/lib/db/store-child-fks";
import { EXPECTED } from "@/scripts/_store-fk-policy.mjs";

// 対象モジュールは Server Action を import しており、その先の repos → lib/db が
// 実 DB 接続を試みるためモックで遮断する (store-delete-confirm-dialog.test.ts と同様)。
vi.mock("@/lib/actions/store-actions", () => ({
  getStoreDeleteImpactAction: vi.fn(),
}));

const { DELETE_IMPACT_CATEGORIES } = await import(
  "../store-delete-confirm-dialog"
);

/**
 * `pg_constraint.confdeltype` の生値と drizzle の onDelete 宣言の対応。
 * EXPECTED 側は SQL の生値 (c / n / ...)、schema.ts 側は drizzle の文字列を持つため、
 * 突合にはこの変換が要る。表に無い deltype が現れた場合は undefined になって落ちる。
 */
const DELTYPE_TO_ON_DELETE: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

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

describe("FK ポリシー期待値 (EXPECTED) と schema.ts 宣言の整合 (#241)", () => {
  const declarations = collectForeignKeyDeclarations();
  const byName = new Map(declarations.map((fk) => [fk.name, fk]));

  it("EXPECTED の各エントリが schema.ts の FK 宣言と一致する", () => {
    for (const expected of EXPECTED) {
      const declared = byName.get(expected.conname);
      expect(
        declared,
        `${expected.conname} に対応する FK 宣言が schema.ts に無い` +
          " (EXPECTED の残骸、または制約名が変わっている)",
      ).toBeDefined();
      const fk = declared!;

      expect(
        fk.child,
        `${expected.conname} の子テーブルが EXPECTED と食い違う`,
      ).toBe(expected.child);

      const wantOnDelete = DELTYPE_TO_ON_DELETE[expected.deltype];
      expect(
        wantOnDelete,
        `${expected.conname} の deltype "${expected.deltype}" が対応表に無い`,
      ).toBeDefined();
      // drizzle は onDelete 未指定を undefined で返す (= SQL 上の NO ACTION)。
      expect(
        fk.onDelete ?? "no action",
        `${expected.conname} の ON DELETE 宣言が EXPECTED と食い違う`,
      ).toBe(wantOnDelete);
    }
  });

  it("stores を親とする FK がすべて EXPECTED に登録されている", () => {
    const declaredStoreFks = declarations
      .filter((fk) => fk.parent === "stores")
      .map((fk) => fk.name)
      .sort();

    // EXPECTED 側の母集合も「解決した宣言の parent」で作る。制約名を文字列として
    // パースして親を推測すると、drizzle の命名規約への依存が二重になるうえ、
    // stores を親としないエントリ (handoffs.deal_id → deals.id) の除外を誤る。
    const registeredStoreFks = EXPECTED.filter(
      (expected) => byName.get(expected.conname)?.parent === "stores",
    )
      .map((expected) => expected.conname)
      .sort();

    // 差分そのものが作業指示になるよう集合を比較する。子テーブルを追加して
    // scripts/_store-fk-policy.mjs への登録を忘れた変更は、ここで落ちる。
    expect(registeredStoreFks).toEqual(declaredStoreFks);
  });

  it("EXPECTED のうち stores を親としないエントリを実測で固定する", () => {
    // 直上のケースが意図的に見逃す除外集合。ここを固定しておかないと、
    // 除外対象が黙って増えたときに逆方向の突合が骨抜きになる。
    const nonStoreParents = EXPECTED.filter((expected) => {
      const declared = byName.get(expected.conname);
      return declared !== undefined && declared.parent !== "stores";
    })
      .map((expected) => expected.conname)
      .sort();

    expect(nonStoreParents).toEqual(["handoffs_deal_id_deals_id_fk"]);
  });
});
