/**
 * タブの矢印キー移動 (#252) の契約を固定するテスト。
 *
 * `TabsTrigger` は roving tabindex (アクティブ以外は `tabIndex={-1}`) を採るので、
 * この移動が無いと**非アクティブタブへ到達する手段が一つも無くなる**。
 * 狭幅の横スクロールを入れても、スクロール領域をキーボードで動かせないままになる。
 *
 * 移動先の決定だけを純粋関数へ切り出してあるので、DOM を用意せずに全分岐を突ける
 * (このリポジトリには React component テスト環境が無い)。DOM への配線
 * (focus / click / scrollIntoView) は `tabs-narrow.test.tsx` が描画結果で見る。
 */

import { describe, expect, it } from "vitest";
import { resolveTabNavigationTarget } from "../tabs";

describe("矢印キーの移動先", () => {
  it("ArrowRight は次へ進み、末尾では先頭へ回り込む", () => {
    expect(resolveTabNavigationTarget("ArrowRight", 0, 3)).toBe(1);
    expect(resolveTabNavigationTarget("ArrowRight", 1, 3)).toBe(2);
    expect(resolveTabNavigationTarget("ArrowRight", 2, 3)).toBe(0);
  });

  it("ArrowLeft は前へ戻り、先頭では末尾へ回り込む", () => {
    expect(resolveTabNavigationTarget("ArrowLeft", 2, 3)).toBe(1);
    expect(resolveTabNavigationTarget("ArrowLeft", 1, 3)).toBe(0);
    expect(resolveTabNavigationTarget("ArrowLeft", 0, 3)).toBe(2);
  });

  it("Home / End は端へ飛ぶ", () => {
    expect(resolveTabNavigationTarget("Home", 2, 3)).toBe(0);
    expect(resolveTabNavigationTarget("End", 0, 3)).toBe(2);
  });

  it("タブが 1 枚だけなら、どのキーでも自分自身に留まる", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(resolveTabNavigationTarget(key, 0, 1), key).toBe(0);
    }
  });

  it("フォーカスがタブ列の外 (-1) なら、進む方向の端から始める", () => {
    // 無効化されたタブにフォーカスがある場合など。どこへも移動できずに
    // 詰まるのを避け、押した方向の自然な入口へ入れる。
    expect(resolveTabNavigationTarget("ArrowRight", -1, 3)).toBe(0);
    expect(resolveTabNavigationTarget("ArrowLeft", -1, 3)).toBe(2);
  });

  it("移動に関係ないキーは null を返し、既定動作を妨げない", () => {
    // ここで null を返さないと、Tab / Enter / Space / 文字入力まで
    // preventDefault されてタブ UI から出られなくなる。
    for (const key of ["Tab", "Enter", " ", "a", "ArrowUp", "ArrowDown", "Escape"]) {
      expect(resolveTabNavigationTarget(key, 0, 3), key).toBeNull();
    }
  });

  it("有効なタブが 1 枚も無ければ null を返す", () => {
    // 全タブが disabled のとき (ai-prompt-template-dialog は isPending 中に起こる)。
    // ここで 0 を返すと存在しない要素へ focus() して落ちる。
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(resolveTabNavigationTarget(key, -1, 0), key).toBeNull();
    }
  });
});
