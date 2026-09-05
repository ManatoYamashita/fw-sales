/**
 * モバイルドロワーのフォーカストラップ (#253) の折り返し規則を固定するテスト。
 *
 * ドロワーは背後のページを覆うので、Tab がその外へ抜けると「見えない要素を操作して
 * いる」状態になる。折り返しの判断だけを純粋関数へ切り出してあるので、DOM を用意せずに
 * 全分岐を突ける (このリポジトリには React component テスト環境が無い)。
 */

import { describe, expect, it } from "vitest";
import { resolveDrawerFocusWrap } from "../sidebar-focus";

describe("Tab の折り返し", () => {
  it("末尾から Tab で先頭へ戻る", () => {
    expect(resolveDrawerFocusWrap("Tab", false, 4, 5)).toBe(0);
  });

  it("先頭から Shift+Tab で末尾へ回る", () => {
    expect(resolveDrawerFocusWrap("Tab", true, 0, 5)).toBe(4);
  });

  it("途中では折り返さず、ブラウザ既定の移動に任せる", () => {
    // ここで index を返してしまうと、ドロワー内の通常の Tab 移動まで
    // preventDefault で奪ってしまう。
    expect(resolveDrawerFocusWrap("Tab", false, 2, 5)).toBeNull();
    expect(resolveDrawerFocusWrap("Tab", true, 2, 5)).toBeNull();
  });

  it("フォーカスがドロワーの外にあれば、進む方向の端から引き戻す", () => {
    // 背後のページへ逃げていた場合。開いた直後にどこにもフォーカスが
    // 入っていない状態もここに落ちる。
    expect(resolveDrawerFocusWrap("Tab", false, -1, 5)).toBe(0);
    expect(resolveDrawerFocusWrap("Tab", true, -1, 5)).toBe(4);
  });

  it("フォーカス可能要素が 1 つだけなら、どちら向きでもそこに留まる", () => {
    // index 0 が先頭かつ末尾になる境界。片方向だけ null を返すと、
    // その向きに Tab した瞬間トラップから抜ける。
    expect(resolveDrawerFocusWrap("Tab", false, 0, 1)).toBe(0);
    expect(resolveDrawerFocusWrap("Tab", true, 0, 1)).toBe(0);
  });

  it("フォーカス可能要素が無ければ null を返す", () => {
    // ここで 0 を返すと存在しない要素へ focus() して落ちる。
    expect(resolveDrawerFocusWrap("Tab", false, -1, 0)).toBeNull();
    expect(resolveDrawerFocusWrap("Tab", true, -1, 0)).toBeNull();
  });

  it("Tab 以外のキーは null を返し、既定動作を妨げない", () => {
    // Escape は呼び出し側が先に処理する。ここで拾うと閉じられなくなる。
    for (const key of ["Escape", "Enter", " ", "ArrowDown", "a", "Home"]) {
      expect(resolveDrawerFocusWrap(key, false, 0, 5), key).toBeNull();
    }
  });
});
