import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMN_HIDE_CLASSES,
  COLUMN_HIDE_CLASSES_WITH_SELECTION,
  DATA_TABLE_CONTAINER_CLASS,
  SELECTION_COLUMN_WIDTH,
  resolveColumnHideClass,
  type ColumnMinContainerWidth,
} from "../data-table-responsive";

/**
 * 列の段階表示 (#220 / #224) の閾値マップと解決ロジックの単体テスト。
 *
 * ここが守っているのは「閾値表の写し間違い」と「Tailwind が拾えない書き方への退化」。
 * 実際に CSS が生成されるかは data-table-responsive-css.test.ts、
 * th/td の双方へ付くかは data-table-responsive-cells.test.tsx が見る。
 *
 * マップは 3 つのテーブル (/stores・/dashboard・/handoffs) で共有される横断
 * レジストリなので、キーの由来はここではなく各テーブルの列テストが持つ。
 * ここが見るのはマップ自身の整合性だけ。
 */

const SOURCE_PATH = path.resolve(
  import.meta.dirname,
  "../data-table-responsive.ts",
);

const thresholds = Object.keys(COLUMN_HIDE_CLASSES)
  .map(Number)
  .sort((a, b) => a - b) as ColumnMinContainerWidth[];

/** クラス名 (@max-…px/data-table:hidden 形式) から閾値の px を取り出す。 */
function hiddenBelowPx(className: string): number {
  const m = /^@max-\[(\d+)px\]\/data-table:hidden$/.exec(className);
  expect(m, `想定外のクラス形式: ${className}`).not.toBeNull();
  return Number(m![1]);
}

describe("閾値マップ", () => {
  it("#220 / #224 の配分表と一致する", () => {
    // 由来は data-table-responsive.ts の内訳コメントを参照。
    // 428/528/718 = /handoffs、456/594/695/835 = /dashboard、残りが /stores。
    expect(thresholds).toEqual([
      428, 456, 528, 594, 695, 718, 728, 835, 874, 971, 1171, 1281, 1391, 1492,
    ]);
  });

  it("選択列ありのマップはキー集合が一致し、閾値がちょうど選択列幅ぶん大きい", () => {
    expect(Object.keys(COLUMN_HIDE_CLASSES_WITH_SELECTION).map(Number).sort((a, b) => a - b))
      .toEqual(thresholds);

    for (const t of thresholds) {
      expect(hiddenBelowPx(COLUMN_HIDE_CLASSES_WITH_SELECTION[t]) - hiddenBelowPx(COLUMN_HIDE_CLASSES[t]))
        .toBe(SELECTION_COLUMN_WIDTH);
    }
  });

  it("キー (表示下限) とクラス内の px が一致する", () => {
    for (const t of thresholds) {
      expect(hiddenBelowPx(COLUMN_HIDE_CLASSES[t])).toBe(t);
      expect(hiddenBelowPx(COLUMN_HIDE_CLASSES_WITH_SELECTION[t])).toBe(
        t + SELECTION_COLUMN_WIDTH,
      );
    }
  });

  it("狭い方で隠す方向に単調である", () => {
    const px = thresholds.map((t) => hiddenBelowPx(COLUMN_HIDE_CLASSES[t]));
    expect([...px].sort((a, b) => a - b)).toEqual(px);
  });

  it("どの 2 つの閾値も選択列幅ぶんの差にならない", () => {
    // N と M が 48px 差だと HIDE_BELOW_WITH_SELECTION[N] と HIDE_BELOW[M] が同じ
    // px になり、CSS 側では 1 本の container query に畳まれる。それを検出するのは
    // data-table-responsive-css.test.ts の「生成クエリ数 = トークン数」だが、
    // あちらは "expected 27 to be 28" としか言わず衝突した組を名指ししない。
    // 閾値を足すときに原因が読める形をここに置く。
    // 衝突したら N を大きい方へずらすこと (小さくすると累計 < 閾値となり、
    // その帯で横スクロールが無言で戻る)。
    const collisions = thresholds.flatMap((a) =>
      thresholds
        .filter((b) => b - a === SELECTION_COLUMN_WIDTH)
        .map((b) => [a, b]),
    );

    expect(collisions).toEqual([]);
  });

  it("コンテナは名前付きで、クラス側の container 名と一致する", () => {
    expect(DATA_TABLE_CONTAINER_CLASS).toBe("@container/data-table");
    for (const t of thresholds) {
      expect(COLUMN_HIDE_CLASSES[t]).toContain("/data-table:");
      expect(COLUMN_HIDE_CLASSES_WITH_SELECTION[t]).toContain("/data-table:");
    }
  });
});

describe("Tailwind の静的走査に耐える書き方であること", () => {
  /**
   * Tailwind はソースを静的走査してクラス名を集めるため、テンプレートリテラルで
   * 組み立てた瞬間に CSS が生成されなくなる。しかもその失敗は無言 (横スクロールが
   * 残るだけ) なので、ソーステキストに逐語で現れることをここで固定する。
   */
  it("全クラスがソースへリテラルで書かれている", async () => {
    const source = await readFile(SOURCE_PATH, "utf8");
    const all = [
      DATA_TABLE_CONTAINER_CLASS,
      ...Object.values(COLUMN_HIDE_CLASSES),
      ...Object.values(COLUMN_HIDE_CLASSES_WITH_SELECTION),
    ];
    for (const cls of all) {
      expect(source).toContain(`"${cls}"`);
    }
  });
});

describe("resolveColumnHideClass", () => {
  it("minContainerWidth が無い列は常時表示 (undefined)", () => {
    expect(resolveColumnHideClass({})).toBeUndefined();
    expect(resolveColumnHideClass({ sortKey: "name" }, { activeSortKey: "next" }))
      .toBeUndefined();
  });

  it("選択列の有無でマップが切り替わる", () => {
    const col = { minContainerWidth: 728 } as const;
    expect(resolveColumnHideClass(col, { hasSelectionColumn: false })).toBe(
      "@max-[728px]/data-table:hidden",
    );
    expect(resolveColumnHideClass(col, { hasSelectionColumn: true })).toBe(
      "@max-[776px]/data-table:hidden",
    );
    // 省略時は選択列なし扱い
    expect(resolveColumnHideClass(col)).toBe("@max-[728px]/data-table:hidden");
  });

  it("ソート中の列は閾値を無視して常に表示する (要件5)", () => {
    const col = { minContainerWidth: 1391, sortKey: "meeting" } as const;
    expect(resolveColumnHideClass(col, { activeSortKey: "meeting" })).toBeUndefined();
    expect(resolveColumnHideClass(col, { activeSortKey: "meeting", hasSelectionColumn: true }))
      .toBeUndefined();
    expect(resolveColumnHideClass(col, { activeSortKey: "name" })).toBe(
      "@max-[1391px]/data-table:hidden",
    );
  });

  it("比較するのは key ではなく sortKey", () => {
    // 最終営業日は key:"updated" / sortKey:"meeting" と食い違う。
    // key で比較する実装に退行すると ?sort=meeting で列が隠れたままになる。
    const col = { minContainerWidth: 1391, sortKey: "meeting" } as const;
    expect(resolveColumnHideClass(col, { activeSortKey: "updated" })).toBe(
      "@max-[1391px]/data-table:hidden",
    );
  });

  it("sortKey を持たない列は強制表示の対象にならない", () => {
    const col = { minContainerWidth: 874 } as const;
    expect(resolveColumnHideClass(col, { activeSortKey: undefined })).toBe(
      "@max-[874px]/data-table:hidden",
    );
  });
});
