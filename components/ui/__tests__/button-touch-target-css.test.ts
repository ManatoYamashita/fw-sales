/**
 * タッチターゲットの下限クラスが、実際に 44px の CSS になることを
 * **本物の Tailwind と本物の `app/globals.css`** で確かめる (#225 Phase 1)。
 *
 * `min-h-11` は `calc(var(--spacing) * 11)` に展開されるので、44px という主張は
 * `--spacing` の値に依存する。`@theme` で `--spacing` を動かせば全ボタンの下限が
 * 無言でずれるため、ここで算術ごと固定する。
 */

import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "./support/build-css";

/** 44px = 2.75rem。`--spacing` の既定 0.25rem × 11。 */
const TOUCH_TARGET_STEPS = 11;

describe("タッチターゲット下限の CSS 生成", () => {
  it("min-h-11 / min-w-11 が --spacing の 11 段として出る", async () => {
    const css = normalize(await buildCss(["min-h-11", "min-w-11"]));

    expect(css).toContain(
      `.min-h-11 { min-height: calc(var(--spacing) * ${TOUCH_TARGET_STEPS}); }`,
    );
    expect(css).toContain(
      `.min-w-11 { min-width: calc(var(--spacing) * ${TOUCH_TARGET_STEPS}); }`,
    );
  });

  it("--spacing が 0.25rem なので 11 段 = 2.75rem = 44px になる", async () => {
    // ここが動くと上の 11 段がそのまま別の px になる。算術の前提を固定する。
    const css = normalize(await buildCss(["min-h-11"]));

    expect(css).toContain("--spacing: 0.25rem");
    expect(0.25 * TOUCH_TARGET_STEPS * 16).toBe(44);
  });

  it("md:min-h-0 / md:min-w-0 が 768px 以上で下限を解除する", async () => {
    const css = normalize(await buildCss(["md:min-h-0", "md:min-w-0"]));

    // 48rem = 768px。ここより下で解除されるとモバイルの 44px が消える。
    expect(css).toMatch(
      /\.md\\:min-h-0 \{ @media \(width >= 48rem\) \{ min-height: calc\(var\(--spacing\) \* 0\)/,
    );
    expect(css).toMatch(
      /\.md\\:min-w-0 \{ @media \(width >= 48rem\) \{ min-width: calc\(var\(--spacing\) \* 0\)/,
    );
  });

  it("存在しないクラスは何も生成しない (このテスト自体が空振りしていないことの確認)", async () => {
    const css = normalize(await buildCss(["min-h-notavalue", "md:min-w-notavalue"]));

    expect(css).not.toContain("min-h-notavalue");
    expect(css).not.toContain("min-w-notavalue");
  });
});
