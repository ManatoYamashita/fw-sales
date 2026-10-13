/**
 * 店舗タイトルの編集操作の描画を固定する (#321)。
 *
 * 表示中は鉛筆ボタンだけ、編集中は同じ差し替え点に「保存」「キャンセル」だけを出す。
 * 業態欄の下へ操作列を戻す変更 (#314 の旧配置) を、見出しの外に保存ボタンが
 * 出ていないことで検出する。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TITLE_EDIT_BUTTON_ID, TitleEditActions } from "../title-edit-actions";

const noop = () => {};

function render(editing: boolean, pending = false): string {
  return renderToStaticMarkup(
    <TitleEditActions
      editing={editing}
      pending={pending}
      onEdit={noop}
      onSave={noop}
      onCancel={noop}
    />,
  );
}

/** `<button ...>...</button>` を 1 つずつ取り出す。 */
function buttons(html: string): string[] {
  return html.match(/<button[\s\S]*?<\/button>/g) ?? [];
}

describe("TitleEditActions", () => {
  it("表示中は名前付きの鉛筆ボタンだけを出す", () => {
    const html = render(false);
    const list = buttons(html);
    expect(list).toHaveLength(1);
    expect(list[0]).toContain('aria-label="店舗名・業態を編集"');
    expect(list[0]).toContain(`id="${TITLE_EDIT_BUTTON_ID}"`);
    expect(html).not.toContain("保存");
    expect(html).not.toContain("キャンセル");
  });

  it("編集中は鉛筆ボタンを消し、同じ位置に保存・キャンセルを並べる", () => {
    const html = render(true);
    expect(html).not.toContain("店舗名・業態を編集");
    expect(html).not.toContain(TITLE_EDIT_BUTTON_ID);
    expect(html).toMatch(/^<span role="group" aria-label="店舗名・業態の編集操作"/);
    const list = buttons(html);
    expect(list).toHaveLength(2);
    expect(list[0]).toContain("保存");
    expect(list[1]).toContain("キャンセル");
    // 狭い幅では見出しの中で折り返すため、グループ自体は縮めない。
    expect(html).toMatch(/^<span[^>]*class="[^"]*\bshrink-0\b/);
  });

  it("保存中は保存ボタンが処理中表示になり、キャンセルも押せない", () => {
    const [save, cancel] = buttons(render(true, true));
    expect(save).toContain("保存中…");
    expect(save).toMatch(/\saria-busy="true"/);
    expect(save).toMatch(/\sdisabled=""/);
    expect(cancel).toMatch(/\sdisabled=""/);
    expect(cancel).not.toMatch(/\saria-busy=/);
  });

  it("保存中でなければどちらも押せる", () => {
    for (const button of buttons(render(true))) {
      expect(button).not.toMatch(/\sdisabled=/);
    }
  });

  it("操作ボタンは鉛筆ボタンと同じ寸法 (size=sm) で描く", () => {
    // 見出し行の高さを変えないため。sm の高さクラスは h-8。
    for (const button of [...buttons(render(false)), ...buttons(render(true))]) {
      expect(button).toMatch(/class="[^"]*\bh-8\b/);
    }
  });
});

describe("StoreTitleSection の配置", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../store-title-section.tsx"),
    "utf8",
  );

  it("編集操作は見出し (h1) の中、状態バッジの後ろに 1 か所だけ置く", () => {
    const h1 = source.slice(source.indexOf("<h1"), source.indexOf("</h1>"));
    expect(h1).toMatch(/<ResearchPhaseBadge[\s\S]*<TitleEditActions/);
    expect(source.match(/<TitleEditActions\b/g)).toHaveLength(1);
  });

  it("見出しの外に保存ボタンを置かない (業態欄の下の操作列を撤去した)", () => {
    const outsideH1 =
      source.slice(0, source.indexOf("<h1")) + source.slice(source.indexOf("</h1>"));
    expect(outsideH1).not.toMatch(/onClick=\{onSave\}/);
    expect(outsideH1).not.toMatch(/onClick=\{onCancel\}/);
  });
});
