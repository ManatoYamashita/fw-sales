/**
 * `Card.Header` / `Card.Footer` の折り返しに使うクラスから、実際に CSS が生成される
 * ことを**本物の Tailwind と本物の `app/globals.css`** で確かめる (#270)。
 *
 * CI (`.github/workflows/ci.yml`) は typecheck / lint / vitest だけで `next build` を
 * 走らせないため、CSS の生成は現状まったくゲートされていない。生成失敗は無言で、
 * 症状は「狭幅で操作が切り取られたまま」= 変更前と同じ壊れ方に戻る。
 */

import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "./support/build-css";

describe("Card の折り返しクラスの CSS 生成", () => {
  it("flex-wrap が折り返しを許可する", async () => {
    const css = normalize(await buildCss(["flex-wrap"]));

    expect(css).toContain("flex-wrap: wrap");
  });

  it("2 番目以降の子への auto マージンが 2 行目の右寄せを作る", async () => {
    // justify-content は行ごとに効くので、操作群だけが落ちた 2 行目は
    // justify-between でも左寄せになる。右寄せはこの margin が担う。
    // 任意バリアントはセレクタごと生成されるので、宣言だけでなく
    // **どの要素に当たるか**まで見る (last-child ではなく 2 番目以降)。
    const css = normalize(await buildCss(["[&>*+*]:ml-auto"]));

    // Tailwind v4 はネスト規則で出す。空白は入らない (`&>*+*`)。
    expect(css).toMatch(/&>\*\+\* \{ margin-left: auto/);
  });

  it("折り返しても行の寄せと間隔は変わらない", async () => {
    const css = normalize(
      await buildCss(["justify-between", "justify-end", "items-center", "gap-3", "gap-2"]),
    );

    expect(css).toContain("justify-content: space-between");
    expect(css).toContain("justify-content: flex-end");
    expect(css).toContain("align-items: center");
  });

  it("last-child ではなく 2 番目以降に当たる", async () => {
    // 「最後の子を右へ」だと、見出しだけのヘッダで見出しが右へ飛ぶ。
    // セレクタの形そのものが契約なので、別形が来たら落とす。
    const css = normalize(await buildCss(["[&>*+*]:ml-auto"]));

    expect(css).not.toMatch(/last-child/);
  });

  it("存在しないクラスは何も生成しない (このテスト自体が空振りしていないことの確認)", async () => {
    const css = normalize(await buildCss(["flex-notavalue", "ml-notavalue", "[&>*+*]:ml-notavalue"]));

    expect(css).not.toContain("flex-wrap: notavalue");
    expect(css).not.toContain("margin-left: notavalue");
  });
});
