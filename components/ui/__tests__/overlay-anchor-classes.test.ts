/**
 * オーバーレイの位置契約 (#225 Phase 3) を固定する。
 *
 * 狭幅では `absolute right-0` がトリガの右端にパネル右端を合わせるため、トリガが
 * 左寄りだとパネルが**左へ**はみ出す。実測で `/stores` の絞り込みは 375px viewport で
 * -216..129 (可視 37%)、通知ドロップダウンは -15..305 (可視 95%) だった。
 *
 * **この破れは `documentElement.scrollWidth` では検出できない** (LTR で左溢れは
 * スクロール領域を作らない)。自動テストで押さえられるのはクラス契約までなので、
 * 「包み側とパネル側が対で成立していること」をここで固定する。
 */

import { describe, expect, it } from "vitest";
import {
  OVERLAY_ANCHOR_CONTAINER,
  OVERLAY_PANEL_ALIGN_END,
  OVERLAY_PANEL_ALIGN_START,
} from "../overlay-anchor-classes";

const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

describe("包み側", () => {
  it("md 未満で static、md 以上で relative へ戻る", () => {
    const t = tokens(OVERLAY_ANCHOR_CONTAINER);

    // base が `relative` のままだと基準がトリガに残り、狭幅の破れが直らない。
    expect(t).toContain("static");
    // これが無いとデスクトップでもパネルがビューポート右端へ飛ぶ。
    expect(t).toContain("md:relative");
    expect(t, "base に relative を残してはいけない").not.toContain("relative");
  });
});

describe("パネル側", () => {
  it.each([
    ["end", OVERLAY_PANEL_ALIGN_END, "right"],
    ["start", OVERLAY_PANEL_ALIGN_START, "left"],
  ])("%s 寄せは base で画面端から余白を取り、md でトリガ基準へ戻る", (_a, cls, side) => {
    const t = tokens(cls);

    // base の `-4` (16px) はビューポート端からの余白。`-0` だと画面端に密着する。
    expect(t).toContain(`${side}-4`);
    // md で 0 に戻さないと、デスクトップでトリガから 16px ずれる。
    expect(t).toContain(`md:${side}-0`);
    expect(t, "base に -0 を置くと画面端へ密着する").not.toContain(`${side}-0`);
  });

  it("end と start は左右の鏡像で、それ以外は同じ", () => {
    // 片側だけ直して他方を忘れる事故を防ぐ。
    expect(OVERLAY_PANEL_ALIGN_START.replaceAll("left", "right")).toBe(
      OVERLAY_PANEL_ALIGN_END,
    );
  });

  it("パネル側と包み側で同じブレークポイントを使う", () => {
    // 境界がずれると、その帯だけ基準が二重になって位置が飛ぶ。
    const bp = (s: string) => [...s.matchAll(/([a-z]+):/g)].map((m) => m[1]);
    expect(new Set([
      ...bp(OVERLAY_ANCHOR_CONTAINER),
      ...bp(OVERLAY_PANEL_ALIGN_END),
      ...bp(OVERLAY_PANEL_ALIGN_START),
    ])).toEqual(new Set(["md"]));
  });
});
