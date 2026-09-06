/**
 * `StatSkeleton` が `Stat` と同じ箱・同じ 3 行構造で描かれること (#265) を、
 * 実際の描画結果で固定する。
 *
 * ## 変更前は何が壊れていたか
 *
 * placeholder は高さを数値で持っていた。settings が 88px、dashboard / kpi が 112px を
 * 任意値で固定。**実体はいずれも 144px** で、データ到着時に 56px / 32px 跳ねていた。
 *
 * 144px は独立した定数ではなく「border 2 + padding 40 + gap 16 + 行1 36 + 行2 30 +
 * 行3 20」の合計で、行 1 は**アイコン枠 (`h-9`) がラベル (16px) を上回って支配**する。
 * つまりアイコンの寸法やパディングを変えれば動く値なので、写した瞬間に古くなる。
 *
 * ここでは数値ではなく**構造の一致**を検査する。高さそのものはブラウザでしか測れない
 * ため (`docs/architecture/responsive.md` §5「この土台で検知できないもの」)、自動で
 * 押さえられるのは「同じ箱クラスを使い、同じ 3 行を出すこと」まで。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stat, StatSkeleton, STAT_BOX_CLASS } from "../stat";
import { Search } from "lucide-react";

const statHtml = () =>
  renderToStaticMarkup(<Stat label="AI調査" value={42} icon={<Search />} />);
const skeletonHtml = () => renderToStaticMarkup(<StatSkeleton />);

/** ルート要素の class。抽出自体を確かめて空虚な green を防ぐ。 */
function rootClasses(html: string): string[] {
  const match = /^<div[^>]*class="([^"]*)"/.exec(html);
  const classes = match?.[1];
  expect(classes, "ルートの <div> を抽出できていない").toBeTypeOf("string");
  return classes!.split(/\s+/).filter(Boolean);
}

describe("StatSkeleton は Stat と同じ箱を使う", () => {
  it("箱のクラスを両方が出す", () => {
    const box = STAT_BOX_CLASS.split(/\s+/);
    const stat = rootClasses(statHtml());
    const skeleton = rootClasses(skeletonHtml());

    for (const token of box) {
      expect(stat, `Stat に ${token} が無い`).toContain(token);
      expect(skeleton, `StatSkeleton に ${token} が無い`).toContain(token);
    }
  });

  it("箱に高さを固定するクラスを持たない", () => {
    // 事故: placeholder 側で 88px のような数値を持つと、Stat の内訳を
    // 変えた瞬間に無言でずれる。高さは内容と padding から出る。
    for (const token of [...rootClasses(statHtml()), ...rootClasses(skeletonHtml())]) {
      expect(token, `高さを固定するクラス ${token} がある`).not.toMatch(/^h-/);
    }
  });

  it("placeholder は hover の affordance を持たない", () => {
    // 影と移動はレイアウトに効かないが、まだ何も無い箱が浮き上がる意味は無い。
    expect(rootClasses(skeletonHtml()).some((t) => t.startsWith("hover:"))).toBe(false);
    expect(rootClasses(statHtml()).some((t) => t.startsWith("hover:"))).toBe(true);
  });
});

describe("StatSkeleton は Stat と同じ 3 行を出す", () => {
  it.each([
    ["行1 (ラベル + アイコン枠)", "flex items-start justify-between gap-3"],
    ["行3 (delta / sub の枠)", "flex items-center gap-2 min-h-5"],
  ])("%s の構造が一致する", (_label, classes) => {
    expect(skeletonHtml()).toContain(`class="${classes}"`);
    expect(statHtml()).toContain(`class="${classes}"`);
  });

  it("行1 の高さはアイコン枠が支配する (36px)", () => {
    // ラベルの placeholder (h-3 = 12px) は下回るので効かない。
    // Stat 側のアイコン枠も h-9 であることを同時に見る。
    expect(skeletonHtml()).toMatch(/class="[^"]*\bh-9 w-9\b/);
    expect(statHtml()).toMatch(/class="[^"]*\bh-9 w-9\b/);
  });

  it("行2 の高さは text-3xl + leading-none の行送りに従う", () => {
    // `h-[1em]` の 1em は継承した 1.875rem を指すので、30 という数値を書かずに済む。
    const html = skeletonHtml();

    expect(html).toContain("text-3xl");
    expect(html).toContain("leading-none");
    expect(html).toContain("h-[1em]");
    expect(statHtml()).toMatch(/text-3xl[^"]*leading-none/);
  });

  it("Skeleton を <p> の中に置かない", () => {
    // Skeleton は div を返す。<p> の中に置くとブラウザが <p> を自動で閉じ、
    // 3 行構造が崩れる (高さが一致しなくなる)。
    expect(skeletonHtml()).not.toMatch(/<p[^>]*>\s*<div/);
    expect(skeletonHtml()).not.toContain("<p");
  });

  it("アイコン枠に rounded-lg を渡していない", () => {
    // Skeleton の基底は rounded-md を持つ。rounded-lg を重ねると
    // class-conflicts.test.ts が border-radius の衝突として落とす。
    expect(skeletonHtml()).not.toMatch(/class="[^"]*rounded-lg[^"]*h-9/);
  });
});
