/**
 * モバイルドロワーの閉時が「画面外に居るだけ」になっていないこと (#253) を、
 * 実際の描画結果で固定する。
 *
 * 変更前は `-translate-x-full` だけで `inert` も `visibility:hidden` も無く、375px で
 * ドロワーを閉じたまま Tab すると**画面外のナビ全リンクとサインアウトへフォーカスが飛んだ**。
 * 視覚利用者にはフォーカスが消えたように見え、スクリーンリーダーは不可視のナビを読み上げる。
 *
 * `useState(false)` が初期値なので SSR は常に閉時を描く。開時の挙動 (フォーカストラップ /
 * Escape / スクロールロック) は DOM が要るためここでは見ない。折り返しの規則は
 * `sidebar-focus-trap.test.ts` が純粋関数として突いている。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/stores",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Server Action は import しただけで lib/db へ到達するため遮断する
// (stores-table-columns.test.tsx と同規約)。
vi.mock("@/lib/actions/auth-actions", () => ({ signOutAction: vi.fn() }));

const { Sidebar } = await import("../sidebar");

/** `<aside id="sidebar-nav">` の class 文字列。 */
function asideClasses(html: string): string {
  const match = /<aside[^>]*id="sidebar-nav"[^>]*class="([^"]*)"/.exec(html);
  const classes = match?.[1];
  expect(classes, "id=sidebar-nav の aside が見つからない").toBeTypeOf("string");
  return classes!;
}

function render() {
  return renderToStaticMarkup(<Sidebar />);
}

describe("ドロワー閉時 (モバイル)", () => {
  it("Tab 順と支援技術から外れている", () => {
    const classes = asideClasses(render());

    // 画面外へ動かすだけでは、フォーカスも読み上げも生きたまま残る。
    expect(classes).toContain("invisible");
    expect(classes).toContain("-translate-x-full");
  });

  it("md 以上では可視に戻る (デスクトップは常時表示のサイドバー)", () => {
    const classes = asideClasses(render());

    // ここが無いとデスクトップでナビが丸ごと操作不能になる。
    expect(classes).toContain("md:visible");
    expect(classes).toContain("md:translate-x-0");
  });

  it("visibility を遷移対象に含め、スライドアウトを保つ", () => {
    // visibility を transition から外すと即座に hidden になり、
    // 閉じるアニメーションが飛ぶ。
    expect(asideClasses(render())).toContain(
      "transition-[transform,width,visibility]",
    );
  });

  it("ハンバーガーが描画され、閉状態を伝える", () => {
    const html = render();

    expect(html).toContain('aria-label="メニューを開く"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="sidebar-nav"');
  });

  it("閉時はオーバーレイを出さない", () => {
    // 出ていると背後のページが常にクリックできなくなる。
    expect(render()).not.toContain("backdrop-blur-sm");
  });
});
