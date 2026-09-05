/**
 * `Button` が実際に描く class が `buttonClasses()` の出力と一致することを固定する
 * (`docs/architecture/responsive.md` §5 の層 ④ 実描画検査)。
 *
 * ## なぜ必要か
 *
 * `class-conflicts.test.ts` も `button-touch-target.test.ts` も、**実装の表を読む**ことで
 * 写経を避けている。しかし読む先が component と違う関数だと、表は正しいのに描画は別物、
 * という穴が開く。実際 `gap` 軸 (#250) を足した直後、`Button` が `gap` を
 * `buttonVariants()` へ渡しておらず、
 *
 * - 描画は常に `gap-2` (既定) で、`gap="tight"` は一度も効かない
 * - 一方 `gap` は DOM へ `<button gap="tight">` として漏れる
 * - それでいて class 衝突ガードは `gap-1.5` を見ているので緑
 *
 * という三重に嫌な状態になっていた。ここは props → 描画結果の配線だけを見る。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BUTTON_GAP_CLASSES,
  BUTTON_SIZE_CLASSES,
  BUTTON_VARIANT_CLASSES,
  Button,
  buttonClasses,
  type ButtonVariantProps,
} from "../button";

const VARIANTS = Object.keys(BUTTON_VARIANT_CLASSES) as NonNullable<
  ButtonVariantProps["variant"]
>[];
const SIZES = Object.keys(BUTTON_SIZE_CLASSES) as NonNullable<
  ButtonVariantProps["size"]
>[];
const GAPS = Object.keys(BUTTON_GAP_CLASSES) as NonNullable<
  ButtonVariantProps["gap"]
>[];

/** 描画された `<button>` の class 属性。 */
function renderedClass(props: ButtonVariantProps): string {
  const html = renderToStaticMarkup(<Button {...props}>x</Button>);
  return /class="([^"]*)"/.exec(html)?.[1] ?? "";
}

const COMBINATIONS = VARIANTS.flatMap((variant) =>
  SIZES.flatMap((size) => GAPS.map((gap) => ({ variant, size, gap }))),
);

describe("Button の props → 描画の配線", () => {
  it("組み合わせが空でない (この走査が空振りしていないことの確認)", () => {
    expect(COMBINATIONS.length).toBe(
      VARIANTS.length * SIZES.length * GAPS.length,
    );
    expect(COMBINATIONS.length).toBeGreaterThan(0);
  });

  it.each(COMBINATIONS)(
    "variant=$variant size=$size gap=$gap は buttonClasses と一致する",
    (props) => {
      expect(renderedClass(props)).toBe(buttonClasses(props));
    },
  );

  it("変種 props を DOM 属性へ漏らさない", () => {
    const html = renderToStaticMarkup(
      <Button variant="ghost" size="sm" gap="tight">
        x
      </Button>,
    );

    expect(html).not.toMatch(/\svariant=/);
    expect(html).not.toMatch(/\ssize=/);
    expect(html).not.toMatch(/\sgap=/);
    // 通常の DOM 属性は素通しする。
    expect(
      renderToStaticMarkup(
        <Button aria-label="削除" disabled>
          x
        </Button>,
      ),
    ).toMatch(/aria-label="削除"/);
  });

  it("gap='tight' が実際に gap-1.5 として描かれる", () => {
    // 既定と違うクラスが出ることまで見ないと、両方 `gap-2` でも一致してしまう。
    expect(renderedClass({ gap: "tight" }).split(/\s+/)).toContain("gap-1.5");
    expect(renderedClass({ gap: "tight" }).split(/\s+/)).not.toContain("gap-2");
    expect(renderedClass({ gap: "default" }).split(/\s+/)).toContain("gap-2");
  });

  it("variant='link' は size の寸法を一切持たない", () => {
    // 打ち消しではなく非適用。`px-0` を書いても size の `px-*` に負けるため。
    const classes = renderedClass({ variant: "link", size: "md" }).split(/\s+/);

    for (const cls of BUTTON_SIZE_CLASSES.md.split(/\s+/)) {
      expect(classes, `link に ${cls} が乗っている`).not.toContain(cls);
    }
    expect(classes).toContain("underline-offset-4");
  });
});
