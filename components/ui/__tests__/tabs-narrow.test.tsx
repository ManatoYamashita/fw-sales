/**
 * 狭幅で `TabsList` が横スクロールへ退避すること (#252) を、実際の描画結果で固定する。
 *
 * 変更前は `inline-flex items-center gap-1` だけで `flex-wrap` も `overflow-x-auto` も
 * 持たず、`app/globals.css` の `html, body { overflow-x: clip }` と組み合わさって
 * **溢れたタブがスクロールもできず切り取られ、押せなくなっていた**。横スクロールバーすら
 * 出ないため無言で機能が消える。
 *
 * 「高さとアクティブタブの位置を変えない」ことが受け入れ条件なので、レイアウトに効く
 * クラス (`p-1` / `items-center` / `gap-1`) が据え置きであることも同時に固定する。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "../tabs";

function render(variant?: "default" | "pill") {
  return renderToStaticMarkup(
    <Tabs defaultValue="b" variant={variant}>
      <TabsList>
        <TabsTrigger value="a">すべて (12)</TabsTrigger>
        <TabsTrigger value="b">候補 (8)</TabsTrigger>
        <TabsTrigger value="c">登録済 (30)</TabsTrigger>
        <TabsTrigger value="d">範囲内 (4)</TabsTrigger>
      </TabsList>
      <TabsPanel value="b">panel</TabsPanel>
    </Tabs>,
  );
}

/** `role="tablist"` を持つ要素の class 文字列。 */
function tablistClasses(html: string): string {
  const match = /<div[^>]*role="tablist"[^>]*class="([^"]*)"/.exec(html);
  const classes = match?.[1];
  expect(classes, "role=tablist の要素が見つからない").toBeTypeOf("string");
  return classes!;
}

describe("TabsList の狭幅退避", () => {
  it("横スクロール可能で、スクロールバーは出さない", () => {
    const classes = tablistClasses(render());

    // 溢れたぶんへ到達する手段。これが無いと overflow-x: clip に切り取られる。
    expect(classes).toContain("overflow-x-auto");
    // コンテナ幅で頭打ちにしないと inline-flex は内容幅のまま伸び、
    // overflow-x-auto がスクロール領域として成立しない。
    expect(classes).toContain("max-w-full");
    // トラックは 32px 級しかなく、スクロールバーを出すと高さが変わる。
    expect(classes).toContain("scrollbar-none");
  });

  it("収まるうちは内容幅に縮む (トラックをコンテナ幅いっぱいに広げない)", () => {
    // `flex` にするとブロックレベルになりトラックが全幅へ伸びて見た目が変わる。
    const classes = tablistClasses(render());

    expect(classes).toContain("inline-flex");
    expect(classes.split(/\s+/)).not.toContain("flex");
  });

  it.each([
    ["default", undefined, "bg-muted/50"],
    ["pill", "pill" as const, "rounded-full"],
  ])("%s バリアントのトラック装飾は変わらない", (_label, variant, expected) => {
    const classes = tablistClasses(render(variant));

    expect(classes).toContain(expected);
    // 高さとタブ位置に効くクラス。ここが動くと受け入れ条件を割る。
    expect(classes).toContain("p-1");
    expect(classes).toContain("items-center");
    expect(classes).toContain("gap-1");
  });
});

describe("roving tabindex は維持される", () => {
  it("アクティブタブだけが Tab 順に入り、他は矢印キー専用になる", () => {
    const html = render();
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);

    expect(tabs, "タブが 4 枚描画されていない").toHaveLength(4);

    const inTabOrder = tabs.filter((t) => t.includes('tabindex="0"'));
    expect(inTabOrder, "Tab 順に入るタブは 1 枚だけであるべき").toHaveLength(1);
    expect(inTabOrder[0]).toContain('aria-selected="true"');
    expect(inTabOrder[0]).toContain('data-state="active"');

    // 残りは tabIndex=-1。矢印キーの移動先を DOM から拾うために
    // `data-state="inactive"` と `role="tab"` は保つ必要がある。
    expect(tabs.filter((t) => t.includes('tabindex="-1"'))).toHaveLength(3);
  });
});
