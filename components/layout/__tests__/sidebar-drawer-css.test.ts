/**
 * ドロワーの可視性制御に使うクラスから、実際に CSS が生成されることを
 * **本物の Tailwind と本物の `app/globals.css`** で確かめる (#253)。
 *
 * CI は `next build` を走らせないため CSS 生成はゲートされておらず、失敗は無言。
 * `invisible` が生成されなければ、症状は「閉じたドロワーに Tab が入る」= 変更前と
 * 同じ壊れ方に戻る。複数プロパティを列挙する任意値の遷移クラスは、Tailwind の
 * 任意値構文が変わったときにもここで落ちる。
 */

import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "../../ui/__tests__/support/build-css";

describe("ドロワー可視性クラスの CSS 生成", () => {
  it("invisible が visibility: hidden を生成する", async () => {
    expect(normalize(await buildCss(["invisible"]))).toContain(
      "visibility: hidden",
    );
  });

  it("md:visible が 768px 以上でのみ可視へ戻す", async () => {
    const css = normalize(await buildCss(["md:visible"]));

    expect(css).toContain("visibility: visible");
    // 768px より下で効いてしまうと、閉じたドロワーが Tab 順へ戻る。
    expect(css).toMatch(/@media \(width >= 48rem\)/);
  });

  it("transition-[transform,width,visibility] が 3 プロパティを対象にする", async () => {
    const css = normalize(
      await buildCss(["transition-[transform,width,visibility]"]),
    );

    expect(css).toContain("transition-property: transform,width,visibility");
  });

  it("存在しないクラスは何も生成しない (このテスト自体が空振りしていないことの確認)", async () => {
    const css = normalize(await buildCss(["invisible-notavalue", "md:visible-notavalue"]));

    expect(css).not.toContain("visibility:");
  });
});
