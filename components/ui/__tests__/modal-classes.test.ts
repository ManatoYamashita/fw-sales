import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODAL_BODY_CLASS,
  MODAL_DIALOG_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_OVERLAY_CLASS,
  MODAL_WIDTH_CLASS,
} from "../modal-classes";

/**
 * モーダルの高さ・スクロール契約を、クラス文字列のレベルで固定する (#225 Phase 1)。
 *
 * jsdom を持たないため DOM を組み立てての検証はできない。代わりに
 * 「どのクラスが載っているか」「載ってはいけないクラスが無いか」を定数から直接読む。
 * 各 `it` には**それが防いでいる事故**をコメントで書くこと。
 */

const CLASSES = {
  MODAL_OVERLAY_CLASS,
  MODAL_DIALOG_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_BODY_CLASS,
  MODAL_FOOTER_CLASS,
} as const;

/** クラス文字列を空白区切りのトークン集合として見る (部分文字列の誤判定を避ける)。 */
function tokens(className: string): Set<string> {
  return new Set(className.split(" ").filter(Boolean));
}

describe("モーダルのクラス定数", () => {
  it("すべての定数がソースへリテラル文字列で書かれている", async () => {
    // 事故: テンプレートリテラルや連結でクラスを組み立てると Tailwind の静的走査に
    // 掛からず、CSS が**無言で**生成されない (data-table-responsive.ts と同じ制約)。
    const source = await readFile(
      path.resolve(import.meta.dirname, "../modal-classes.ts"),
      "utf8",
    );
    for (const [name, value] of Object.entries(CLASSES)) {
      expect(source, `${name} がリテラルで書かれていない`).toContain(`"${value}"`);
    }
    for (const [size, value] of Object.entries(MODAL_WIDTH_CLASS)) {
      expect(source, `MODAL_WIDTH_CLASS.${size} がリテラルで書かれていない`).toContain(
        `"${value}"`,
      );
    }
  });

  it("ダイアログが縦フレックス + 高さ上限 + クリップを持つ", () => {
    // 事故: max-h を落とすと本欠陥 (フッタに到達できない) がそのまま再発する。
    // flex-col を落とすとボディだけを伸縮させられなくなる。
    const t = tokens(MODAL_DIALOG_CLASS);
    expect(t).toContain("flex");
    expect(t).toContain("flex-col");
    expect(t).toContain("max-h-full");
    expect(t).toContain("overflow-clip");
  });

  it("ダイアログが幅ユーティリティを自前で持たない", () => {
    // 事故: MODAL_WIDTH_CLASS と max-w-* が二重になると、cn (tailwind-merge なし) では
    // CSS の記述順で勝敗が決まり size prop が無言で効かなくなる。
    expect([...tokens(MODAL_DIALOG_CLASS)].filter((c) => c.startsWith("max-w-"))).toEqual(
      [],
    );
  });

  it("ボディが min-h-0 を持つ", () => {
    // 事故: これが無いと column フレックスアイテムの自動最小サイズによりボディが縮まず、
    // max-h-full が**一切効かない**。しかもエラーは出ず、症状は「フッタに届かない」だけ。
    expect(tokens(MODAL_BODY_CLASS)).toContain("min-h-0");
  });

  it("ボディが唯一のスクロール領域である", () => {
    const t = tokens(MODAL_BODY_CLASS);
    expect(t).toContain("overflow-y-auto");
    expect(t).toContain("overscroll-contain"); // iOS のラバーバンドが背景へ連鎖するのを止める
  });

  it("フッタが下端に貼り付く", () => {
    // 事故: `bottom-0` にすると、sticky の基準がスクロールポートの padding box なので
    // ボディの py-4 のぶんだけフッタが 16px 内側へ引き寄せられ、**スクロールが無い
    // ときですら**短いモーダルのフッタが浮く (実測で確認済み)。
    // `-bottom-4` は貼り付き位置を -mb-4 による静的位置に一致させるための値。
    const t = tokens(MODAL_FOOTER_CLASS);
    expect(t).toContain("sticky");
    expect(t).toContain("-bottom-4");
    expect(t).not.toContain("bottom-0");
  });

  it("フッタが負マージンを保持している", () => {
    // 事故: 「sticky と衝突しそうだから」と -mb-4 を外す誤修正。
    // CSS 仕様上 sticky の貼り付き判定は border edge であって margin box ではないので
    // 衝突しない。負マージンはボディの px-5 py-4 を打ち消す役目を今も担っている。
    const t = tokens(MODAL_FOOTER_CLASS);
    expect(t).toContain("-mx-5");
    expect(t).toContain("-mb-4");
    expect(t).toContain("mt-4");
  });

  it("フッタの背景が不透明である", () => {
    // 事故: bg-muted/30 のような半透明のままだと、sticky で本文の上に乗ったときに
    // 文字が透けて読めなくなる。
    expect(MODAL_FOOTER_CLASS).not.toMatch(/\bbg-\S+\/\d+/);
    expect(tokens(MODAL_FOOTER_CLASS)).toContain("bg-modal-footer");
  });

  it("ヘッダがスクロール領域の外側に固定される", () => {
    expect(tokens(MODAL_HEADER_CLASS)).toContain("shrink-0");
  });

  it("オーバーレイが max-h-full の前提を保っている", () => {
    // max-height: 100% はオーバーレイのコンテンツボックス高に解決する。
    // fixed inset-0 と p-4 が消えると、ダイアログの最大高が**無言で**意味を失う。
    const t = tokens(MODAL_OVERLAY_CLASS);
    expect(t).toContain("fixed");
    expect(t).toContain("inset-0");
    expect(t).toContain("p-4");
  });

  it("オーバーレイがスクロールコンテナにならない", () => {
    // 事故: オーバーレイには「クリックで閉じる」が付いているため、スクロールバーが
    // 出ると**バーをドラッグしただけでモーダルが閉じる**。
    // items-start も不要 (max-h があれば上下対称のはみ出しは起きない)。
    const t = tokens(MODAL_OVERLAY_CLASS);
    expect([...t].filter((c) => c.startsWith("overflow"))).toEqual([]);
    expect(t).not.toContain("items-start");
    expect(t).toContain("items-center");
  });

  it("MODAL_WIDTH_CLASS が幅だけを決める", () => {
    // 事故: size prop に高さを混ぜると、高さの管理点が 2 つになって本欠陥が再発する。
    for (const [size, value] of Object.entries(MODAL_WIDTH_CLASS)) {
      expect(value, `${size} が max-w-* 単独でない`).toMatch(/^max-w-\S+$/);
    }
    expect(Object.keys(MODAL_WIDTH_CLASS)).toEqual(["sm", "md", "lg"]);
  });
});
