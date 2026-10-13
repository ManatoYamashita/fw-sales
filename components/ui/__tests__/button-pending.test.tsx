/**
 * `Button` の `pending` prop の描画を固定する (#326)。
 *
 * 処理中の見た目 (スピナー) だけでなく、押せないこと (`disabled`) と
 * 支援技術向けの `aria-busy` が同時に出ることを確かめる。
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, buttonClasses } from "../button";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("Button pending", () => {
  it("pending のときスピナー・disabled・aria-busy をまとめて出す", () => {
    const html = render(<Button pending>保存中…</Button>);
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toMatch(/<button[^>]*\saria-busy="true"/);
    expect(html).toContain('data-slot="button-spinner"');
  });

  it("スピナーは読み上げず、ラベルより前に置く", () => {
    const html = render(<Button pending>保存中…</Button>);
    expect(html).toMatch(/<svg[^>]*data-slot="button-spinner"[^>]*aria-hidden="true"/);
    expect(html.indexOf("button-spinner")).toBeLessThan(html.indexOf("保存中…"));
  });

  it("pending でなければ何も足さない", () => {
    // class にも `disabled:` や `aria-busy:` の文字列が入るので、属性として調べる。
    const html = render(<Button>保存</Button>);
    expect(html).not.toMatch(/\sdisabled=/);
    expect(html).not.toMatch(/\saria-busy=/);
    expect(html).not.toContain('data-slot="button-spinner"');
  });

  it("disabled だけを渡したボタン (キャンセル側) は処理中に見せない", () => {
    const html = render(<Button disabled>キャンセル</Button>);
    expect(html).toMatch(/\sdisabled=""/);
    expect(html).not.toMatch(/\saria-busy=/);
    expect(html).not.toContain('data-slot="button-spinner"');
  });

  it("pending と disabled は OR になる (pending が終わっても disabled 側の理由で押せないまま)", () => {
    const html = render(
      <Button pending={false} disabled>
        保存
      </Button>,
    );
    expect(html).toMatch(/\sdisabled=""/);
  });

  it("pending を DOM 属性として漏らさない", () => {
    expect(render(<Button pending>x</Button>)).not.toMatch(/\spending=/);
  });

  it("処理中は半透明にしないクラスを基底に持つ", () => {
    expect(buttonClasses({})).toContain("aria-busy:disabled:opacity-100");
  });

  it("スピナー直後の先頭アイコンを隠す規則が globals.css にある", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\[data-slot="button-spinner"\]\s*\+\s*svg\s*\{\s*display:\s*none;/);
  });
});
