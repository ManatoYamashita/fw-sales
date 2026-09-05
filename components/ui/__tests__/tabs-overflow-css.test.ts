/**
 * `TabsList` の狭幅退避に使うクラスから、実際に CSS が生成されることを
 * **本物の Tailwind と本物の `app/globals.css`** で確かめる (#252)。
 *
 * CI (`.github/workflows/ci.yml`) は typecheck / lint / vitest だけで `next build` を
 * 走らせないため、CSS の生成は現状まったくゲートされていない。そして生成失敗は無言で、
 * 症状は「狭幅でタブが切り取られたまま」= 変更前と同じ壊れ方に戻る。
 *
 * とくに `scrollbar-none` は Tailwind が生成するユーティリティではなく
 * `app/globals.css` の `@layer utilities` に手書きされた CSS なので、
 * globals.css 側の整理で消えても TypeScript も lint も何も言わない。ここで押さえる。
 */

import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "./support/build-css";

describe("狭幅退避クラスの CSS 生成", () => {
  it("overflow-x-auto がスクロール領域を作る", async () => {
    const css = normalize(await buildCss(["overflow-x-auto"]));

    expect(css).toContain("overflow-x: auto");
  });

  it("max-w-full がコンテナ幅で頭打ちにする", async () => {
    // これが無いと inline-flex は内容幅のまま伸び、overflow-x-auto が
    // スクロール領域として成立しない (溢れたまま clip される)。
    const css = normalize(await buildCss(["max-w-full"]));

    expect(css).toContain("max-width: 100%");
  });

  it("scrollbar-none がスクロールバーを消す (globals.css の手書きユーティリティ)", async () => {
    const css = normalize(await buildCss(["scrollbar-none"]));

    // Firefox / 標準
    expect(css).toContain("scrollbar-width: none");
    // 旧 Edge
    expect(css).toContain("-ms-overflow-style: none");
    // WebKit / Blink。擬似要素まで含めて残っていること。
    expect(css).toMatch(/\.scrollbar-none::-webkit-scrollbar \{ display: none/);
  });

  it("存在しないクラスは何も生成しない (このテスト自体が空振りしていないことの確認)", async () => {
    const css = normalize(await buildCss(["overflow-x-notavalue", "max-w-notavalue"]));

    expect(css).not.toContain("overflow-x: notavalue");
    expect(css).not.toContain("max-width: notavalue");
  });
});
