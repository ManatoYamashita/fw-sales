/**
 * 位置契約のクラスから実際に CSS が生成されることを、**本物の Tailwind と本物の
 * `app/globals.css`** で確かめる (#225 Phase 3)。
 *
 * CI は `next build` を持たないため CSS 生成はゲートされておらず、失敗は無言。
 * `md:relative` が出なければ包みは狭幅の `static` のままになり、**デスクトップで
 * パネルがトリガから離れてビューポート右端へ飛ぶ**。症状が出るのは md 以上だけなので
 * 気づきにくい。
 */

import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "./support/build-css";
import {
  OVERLAY_ANCHOR_CONTAINER,
  OVERLAY_PANEL_ALIGN_END,
  OVERLAY_PANEL_ALIGN_START,
} from "../overlay-anchor-classes";

const ALL = [OVERLAY_ANCHOR_CONTAINER, OVERLAY_PANEL_ALIGN_END, OVERLAY_PANEL_ALIGN_START]
  .flatMap((s) => s.split(/\s+/));

describe("位置契約クラスの CSS 生成", () => {
  it("契約に含まれる全クラスが CSS を生成する", async () => {
    // 定数から直接候補を作る。写経すると契約へ足したクラスが検査から漏れる。
    expect(ALL.length).toBeGreaterThan(0);
    const css = normalize(await buildCss(ALL));

    expect(css).toContain("position: static");
    expect(css).toContain("position: relative");
  });

  it("md 側だけが 768px 以上のメディアクエリに入る", async () => {
    const css = normalize(await buildCss(["static", "md:relative"]));

    // 48rem = 768px。ここがずれると基準の切替点が動く。
    expect(css).toMatch(/\.md\\:relative \{ @media \(width >= 48rem\) \{ position: relative/);
    // base の static は無条件で出る (メディアクエリに入ってはいけない)。
    expect(css).toMatch(/\.static \{ position: static; \}/);
  });

  it.each([
    ["right-4", "md:right-0", "right"],
    ["left-4", "md:left-0", "left"],
  ])("%s / %s が同じ辺のオフセットを生成する", async (base, md, side) => {
    const css = normalize(await buildCss([base, md]));

    expect(css).toContain(`${side}: calc(var(--spacing) * 4)`);
    expect(css).toMatch(new RegExp(`@media \\(width >= 48rem\\) \\{ ${side}: calc\\(var\\(--spacing\\) \\* 0\\)`));
  });

  it("存在しないクラスは何も生成しない (このテスト自体が空振りしていないことの確認)", async () => {
    const css = normalize(await buildCss(["md:relative-notavalue", "right-notavalue"]));

    expect(css).not.toContain("relative-notavalue");
    expect(css).not.toContain("right-notavalue");
  });
});
