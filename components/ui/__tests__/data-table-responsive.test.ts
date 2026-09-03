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
 * 列の段階表示 (#220 / PR2/3) の閾値マップと解決ロジックの単体テスト。
 *
 * ここが守っているのは「閾値表の写し間違い」と「Tailwind が拾えない書き方への退化」。
 * 実際に CSS が生成されるかは data-table-responsive-css.test.ts、
 * th/td の双方へ付くかは data-table-responsive-cells.test.tsx が見る。
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

/**
 * 閾値がどの画面の列予算から来たか。
 *
 * マップは 1 本のはしごではなく**テーブルごとの予算の和集合**なので、キーを足す人に
 * 「どの画面のぶんか」を書かせるための表でもある。ここを更新せずにマップだけ触ると
 * 下の 2 つのテストが落ちる。
 */
const STORES_LADDER = [728, 874, 971, 1171, 1281, 1391, 1492] as const; // #220
const DASHBOARD_LADDER = [406, 516, 652, 792] as const; // #224

describe("閾値マップ", () => {
  it("#220 (/stores) と #224 (/dashboard) の配分表の和集合と一致する", () => {
    expect(thresholds).toEqual([
      406, 516, 652, 728, 792, 874, 971, 1171, 1281, 1391, 1492,
    ]);
  });

  it("すべての閾値がいずれかの画面の予算に由来する", () => {
    // 出自不明の閾値が紛れ込むと、後から「これは何の列だったか」を誰も辿れなくなる。
    const declared = [...STORES_LADDER, ...DASHBOARD_LADDER].sort((a, b) => a - b);
    expect(new Set(STORES_LADDER).size + new Set(DASHBOARD_LADDER).size).toBe(
      new Set(declared).size,
    ); // 2 つのラダーは互いに素
    expect(declared).toEqual(thresholds);
  });

  it("どの 2 閾値も選択列幅ちょうど離れていない", () => {
    // 事故: 差が SELECTION_COLUMN_WIDTH だと HIDE_BELOW[b] と
    // HIDE_BELOW_WITH_SELECTION[b - 48] が同一文字列になり、Set が重複を潰して
    // data-table-responsive-css.test.ts の「ユニークなクエリ数 === トークン数」が
    // **原因の分からないメッセージで**落ちる。ここで先回りして名指しする。
    for (const a of thresholds) {
      for (const b of thresholds) {
        expect(
          b - a,
          `閾値 ${a} と ${b} が選択列幅 (${SELECTION_COLUMN_WIDTH}px) ちょうど離れている。` +
            `どちらかを 1px でもずらすこと。`,
        ).not.toBe(SELECTION_COLUMN_WIDTH);
      }
    }
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
