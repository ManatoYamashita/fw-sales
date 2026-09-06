import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "./support/build-css";
import { hidden } from "./support/scanner-hidden";
import {
  MODAL_BODY_CLASS,
  MODAL_DIALOG_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_OVERLAY_CLASS,
} from "../modal-classes";

/**
 * モーダルの高さ・スクロール契約が**実際に CSS になる**ことを、本物の Tailwind と
 * 本物の `app/globals.css` で確かめる (#225 Phase 1)。
 *
 * CI は `next build` を走らせないため、ここが CSS 生成の唯一のゲート。
 * とりわけ `bg-modal-footer` は `--color-modal-footer` を globals.css へ足し忘れると
 * **何も生成せずに無言で透明化する**ので、このテストが最後の砦になる。
 *
 * 期待値は Tailwind v4.2.4 の実出力をピン留めしたもの。バージョン更新で揺れたら、
 * 実機で描画を確認したうえで追随すること。
 */

const css = (className: string) => buildCss(className.split(" ")).then(normalize);

describe("モーダルのクラスが生成する CSS", () => {
  it("ダイアログが縦フレックスかつ高さ上限を持つ", async () => {
    const out = await css(MODAL_DIALOG_CLASS);
    expect(out).toContain("display: flex");
    expect(out).toContain("flex-direction: column");
    // オーバーレイ (fixed inset-0 p-4) のコンテンツボックス高に解決する。
    expect(out).toContain("max-height: 100%");
    expect(out).toContain("overflow: clip");
  });

  it("ボディがスクロール領域になる", async () => {
    const out = await css(MODAL_BODY_CLASS);
    expect(out).toContain("overflow-y: auto");
    expect(out).toContain("overscroll-behavior: contain");
    // Tailwind v4 は min-h-0 を spacing スケール経由で出す (`0px` ではない)。
    expect(out).toContain("min-height: calc(var(--spacing) * 0)");
  });

  it("フッタが下端に貼り付き、負マージンを保つ", async () => {
    const out = await css(MODAL_FOOTER_CLASS);
    expect(out).toContain("position: sticky");
    // `-bottom-4` は貼り付き位置を `-mb-4` による静的位置に一致させる値。
    // `bottom: 0` だとスクロールが無いときでもフッタが 16px 浮く (§3 参照)。
    expect(out).toContain("bottom: calc(var(--spacing) * -4)");
    expect(out).toContain("z-index: 10");
    expect(out).toContain("margin-inline: calc(var(--spacing) * -5)");
    expect(out).toContain("margin-bottom: calc(var(--spacing) * -4)");
    expect(out).toContain("margin-top: calc(var(--spacing) * 4)");
  });

  it("フッタ背景が --color-modal-footer から不透明色として出る", async () => {
    // これが落ちたら app/globals.css の `--color-modal-footer` を確認すること。
    // トークンが無いと bg-modal-footer は**何も生成せず**、フッタが透明になる。
    const out = await css(MODAL_FOOTER_CLASS);
    expect(out).toContain(
      "color-mix(in oklab, var(--muted) 30%, var(--popover))",
    );
    // color-mix 非対応ブラウザ向けのフォールバックが不透明であること
    // (Tailwind が @supports ガードと共に自動生成する)。
    expect(out).toMatch(/\.bg-modal-footer \{ background-color: var\(--muted\);/);
  });

  it("ヘッダが縮まない", async () => {
    // 生成される CSS プロパティは Tailwind の旧クラス名と同じ綴りを持つため、
    // 逐語で書くと走査対象外の設定が外れた日に候補として拾われる (#277)。
    expect(await css(MODAL_HEADER_CLASS)).toContain(hidden("flex-shr", "ink: 0"));
  });

  it("オーバーレイが fixed で、スクロールコンテナを作らない", async () => {
    const out = await css(MODAL_OVERLAY_CLASS);
    expect(out).toContain("position: fixed");
    // `html, body { overflow-x: clip }` などの base layer は常に出るので、
    // 「overflow ユーティリティのクラス定義が生成されていないこと」で判定する。
    expect(out).not.toMatch(/\.overflow-[\w-]* \{/);
  });

  it("存在しないクラスでは何も生成されない (空振り検出)", async () => {
    const out = await css("bg-does-not-exist-modal-footer");
    expect(out).not.toContain("bg-does-not-exist-modal-footer");
  });
});
