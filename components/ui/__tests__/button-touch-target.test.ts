/**
 * モバイル (md 未満) でボタンのタッチターゲットが 44px を下回らないこと (#225 Phase 1) を
 * **全 size を走査して**固定する。
 *
 * WCAG 2.2 SC 2.5.8 (AA) の 24x24 は既定の 36px で元から満たしている。ここで守るのは
 * SC 2.5.5 (AAA) と、営業が外回りでスマホから操作する運用を踏まえた 44px。
 *
 * size は将来増える。列挙をテスト側に写経すると新しい size が素通りするので、
 * 実装が持つ `BUTTON_SIZE_CLASSES` をそのまま走査する。
 */

import { describe, expect, it } from "vitest";
import { BUTTON_SIZE_CLASSES, buttonVariants } from "../button";

type SizeKey = keyof typeof BUTTON_SIZE_CLASSES;
const SIZES = Object.keys(BUTTON_SIZE_CLASSES) as SizeKey[];

/** その size のクラス集合。 */
function classesOf(size: SizeKey): string[] {
  return BUTTON_SIZE_CLASSES[size].split(/\s+/);
}

/** 幅を固定する size (アイコンボタン) か。 */
function isSquare(size: SizeKey): boolean {
  return classesOf(size).some((c) => /^w-\d/.test(c));
}

describe("モバイルのタッチターゲット下限", () => {
  it("size が 1 つ以上ある (この走査が空振りしていないことの確認)", () => {
    expect(SIZES.length).toBeGreaterThan(0);
  });

  it.each(SIZES)("%s は md 未満で高さ 44px を下回らない", (size) => {
    const classes = classesOf(size);

    // 元から 44px (`h-11`) か、下限を重ねている (`min-h-11`) かのどちらか。
    expect(
      classes.includes("h-11") || classes.includes("min-h-11"),
      `${size}: h-11 も min-h-11 も無い`,
    ).toBe(true);
  });

  it.each(SIZES.filter(isSquare))("%s は md 未満で幅も 44px を下回らない", (size) => {
    // アイコンボタンは正方形。高さだけ広げると縦長になり、指の当たり判定も足りない。
    const classes = classesOf(size);

    expect(
      classes.includes("w-11") || classes.includes("min-w-11"),
      `${size}: w-11 も min-w-11 も無い`,
    ).toBe(true);
  });

  it.each(SIZES)("%s は高さそのものをレスポンシブに差し替えない", (size) => {
    // `h-11 md:h-9` 方式にすると、`variant: link` の `h-auto` や消費者が className で
    // 足した `h-*` と同じプロパティを争い、勝敗が生成 CSS の記述順で決まる
    // (docs/architecture/responsive.md §4.3)。min-h は別プロパティなので争わない。
    expect(classesOf(size).filter((c) => /^md:h-/.test(c)), size).toEqual([]);
  });
});

describe("デスクトップの見た目は据え置き", () => {
  it.each([
    ["sm", "h-8"],
    ["md", "h-9"],
    ["lg", "h-10"],
    ["icon", "h-9"],
    ["icon-sm", "h-8"],
    ["icon-lg", "h-10"],
  ] as const)("%s は元の高さ %s を保ち、md で下限を解除する", (size, height) => {
    const classes = classesOf(size);

    expect(classes, `${size} の高さが変わっている`).toContain(height);
    // これが無いと 44px の下限がデスクトップにも残り、既存レイアウトが動く。
    expect(classes, `${size} の下限が md で解除されていない`).toContain("md:min-h-0");
  });

  it("元から 44px の size には下限を足さない", () => {
    // 足しても無害だが、意味の無いクラスは dead CSS と区別が付かなくなる。
    for (const size of ["xl", "touch", "icon-touch"] as const) {
      expect(classesOf(size), size).not.toContain("min-h-11");
    }
  });
});

describe("cva への配線", () => {
  it("buttonVariants が size のクラスをそのまま出す", () => {
    // 表を定義しただけで cva へ渡し忘れていないことの確認。
    for (const size of SIZES) {
      const rendered = buttonVariants({ size }).split(/\s+/);
      for (const cls of classesOf(size)) {
        expect(rendered, `${size} の ${cls} が出ていない`).toContain(cls);
      }
    }
  });

  it("既定 size (md) でも下限が効く", () => {
    expect(buttonVariants({}).split(/\s+/)).toContain("min-h-11");
  });
});
