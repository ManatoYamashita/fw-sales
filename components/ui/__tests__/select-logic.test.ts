/**
 * 共通 Select (#334) のキー操作・文字入力・配置の判定を固定する。
 *
 * このリポジトリには React component のテスト環境が無いので、判定を純粋関数へ
 * 切り出して全分岐を突く (`tabs-keyboard.test.ts` と同じ方針)。
 * DOM への配線 (フォーカス・ポップオーバー) は `select.test.tsx` の描画結果と E2E が見る。
 */

import { describe, expect, it } from "vitest";
import {
  PANEL_GAP,
  PANEL_MAX_HEIGHT,
  VIEWPORT_MARGIN,
  computePanelPlacement,
  findTypeaheadMatch,
  initialValueOf,
  isOutsideViewport,
  isTypeaheadKey,
  optionsFromValues,
  resolveActiveIndex,
  resolveOpeningIndex,
  type SelectOption,
} from "../select-logic";

const STAGES: SelectOption[] = [
  { value: "未調査", label: "未調査" },
  { value: "調査済み", label: "調査済み" },
  { value: "架電済み", label: "架電済み" },
];

/** 先頭・中間・末尾に無効な候補を含む並び。 */
const WITH_DISABLED: SelectOption[] = [
  { value: "", label: "並び替え", disabled: true },
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana", disabled: true },
  { value: "c", label: "Cherry" },
  { value: "z", label: "Zucchini", disabled: true },
];

describe("初期値 (非制御モードで defaultValue が無いとき)", () => {
  it("ネイティブの select と同じく先頭の有効な候補", () => {
    expect(initialValueOf(STAGES)).toBe("未調査");
    expect(initialValueOf(WITH_DISABLED)).toBe("a");
  });

  it("候補が無ければ空文字", () => {
    expect(initialValueOf([])).toBe("");
  });
});

describe("開いたときの強調", () => {
  it("選択中の候補から始める", () => {
    expect(resolveOpeningIndex("ArrowDown", STAGES, "調査済み")).toBe(1);
    expect(resolveOpeningIndex("Enter", STAGES, "架電済み")).toBe(2);
  });

  it("候補にない値・空値は先頭の有効な候補から", () => {
    expect(resolveOpeningIndex("ArrowDown", STAGES, "uuid-unknown")).toBe(0);
    expect(resolveOpeningIndex("ArrowDown", WITH_DISABLED, "")).toBe(1);
  });

  it("Home / End は端の有効な候補へ", () => {
    expect(resolveOpeningIndex("Home", WITH_DISABLED, "c")).toBe(1);
    expect(resolveOpeningIndex("End", WITH_DISABLED, "a")).toBe(3);
  });
});

describe("開いているときの矢印キー", () => {
  it("上下で 1 つずつ動き、端では回り込まない", () => {
    expect(resolveActiveIndex("ArrowDown", STAGES, 0)).toBe(1);
    expect(resolveActiveIndex("ArrowDown", STAGES, 2)).toBe(2);
    expect(resolveActiveIndex("ArrowUp", STAGES, 1)).toBe(0);
    expect(resolveActiveIndex("ArrowUp", STAGES, 0)).toBe(0);
  });

  it("無効な候補を飛ばし、端の無効な候補では止まる", () => {
    expect(resolveActiveIndex("ArrowDown", WITH_DISABLED, 1)).toBe(3);
    expect(resolveActiveIndex("ArrowDown", WITH_DISABLED, 3)).toBe(3);
    expect(resolveActiveIndex("ArrowUp", WITH_DISABLED, 3)).toBe(1);
    expect(resolveActiveIndex("ArrowUp", WITH_DISABLED, 1)).toBe(1);
  });

  it("Home / End / PageUp / PageDown", () => {
    expect(resolveActiveIndex("Home", WITH_DISABLED, 3)).toBe(1);
    expect(resolveActiveIndex("End", WITH_DISABLED, 1)).toBe(3);
    const many = Array.from({ length: 30 }, (_, i) => ({ value: `${i}`, label: `${i}` }));
    expect(resolveActiveIndex("PageDown", many, 0)).toBe(10);
    expect(resolveActiveIndex("PageDown", many, 25)).toBe(29);
    expect(resolveActiveIndex("PageUp", many, 15)).toBe(5);
    expect(resolveActiveIndex("PageUp", many, 3)).toBe(0);
  });

  it("強調が無い (-1) ときは押した方向の端から入る", () => {
    expect(resolveActiveIndex("ArrowDown", STAGES, -1)).toBe(0);
    expect(resolveActiveIndex("ArrowUp", STAGES, -1)).toBe(2);
  });

  it("移動に関係ないキーは null (Tab などの既定動作を奪わない)", () => {
    for (const key of ["Tab", "Enter", " ", "Escape", "a", "ArrowLeft", "ArrowRight"]) {
      expect(resolveActiveIndex(key, STAGES, 0), key).toBeNull();
    }
  });

  it("選べる候補が 1 つも無ければ null", () => {
    expect(resolveActiveIndex("ArrowDown", [{ value: "x", label: "x", disabled: true }], -1)).toBeNull();
  });
});

describe("文字入力による候補移動", () => {
  const FRUITS: SelectOption[] = [
    { value: "1", label: "Apple" },
    { value: "2", label: "Avocado" },
    { value: "3", label: "Banana" },
    { value: "4", label: "Apricot" },
    { value: "5", label: "Blueberry", disabled: true },
  ];

  it("入力した文字列で始まる候補へ移る (大文字小文字を区別しない)", () => {
    expect(findTypeaheadMatch(FRUITS, "b", 0)).toBe(2);
    expect(findTypeaheadMatch(FRUITS, "AV", 0)).toBe(1);
  });

  it("同じ 1 文字の繰り返しは、その文字で始まる候補を順に巡る", () => {
    expect(findTypeaheadMatch(FRUITS, "a", 0)).toBe(1);
    expect(findTypeaheadMatch(FRUITS, "aa", 1)).toBe(3);
    expect(findTypeaheadMatch(FRUITS, "aaa", 3)).toBe(0);
  });

  it("絞り込み中は現在の候補に留まる (入力を続けて強調が飛ばない)", () => {
    expect(findTypeaheadMatch(FRUITS, "ap", 0)).toBe(0);
    expect(findTypeaheadMatch(FRUITS, "apr", 0)).toBe(3);
  });

  it("強調が無ければ先頭から探す", () => {
    expect(findTypeaheadMatch(FRUITS, "a", -1)).toBe(0);
    expect(findTypeaheadMatch(FRUITS, "ban", -1)).toBe(2);
  });

  it("無効な候補には移らない。一致が無ければ -1", () => {
    expect(findTypeaheadMatch(FRUITS, "bl", 0)).toBe(-1);
    expect(findTypeaheadMatch(FRUITS, "x", 0)).toBe(-1);
    expect(findTypeaheadMatch(FRUITS, "", 0)).toBe(-1);
  });

  it("全角・半角の違いで一致を逃さない", () => {
    const options: SelectOption[] = [
      { value: "1", label: "ＤＭ" },
      { value: "2", label: "電話" },
    ];
    expect(findTypeaheadMatch(options, "d", -1)).toBe(0);
    expect(findTypeaheadMatch(options, "電", -1)).toBe(1);
  });

  it("修飾キー付きと名前付きキーは文字入力として扱わない", () => {
    const none = { ctrlKey: false, metaKey: false, altKey: false };
    expect(isTypeaheadKey("a", none)).toBe(true);
    expect(isTypeaheadKey(" ", none)).toBe(true);
    expect(isTypeaheadKey("あ", none)).toBe(true);
    expect(isTypeaheadKey("ArrowDown", none)).toBe(false);
    expect(isTypeaheadKey("Enter", none)).toBe(false);
    expect(isTypeaheadKey("a", { ...none, metaKey: true })).toBe(false);
    expect(isTypeaheadKey("a", { ...none, ctrlKey: true })).toBe(false);
  });
});

describe("候補パネルの配置", () => {
  const viewport = { width: 375, height: 800 };
  const trigger = { top: 100, bottom: 144, left: 16, width: 200 };

  it("既定はトリガーの直下、左端を揃える", () => {
    const p = computePanelPlacement(trigger, { width: 200, height: 150 }, viewport);
    expect(p).toEqual({ side: "bottom", top: 144 + PANEL_GAP, left: 16, maxHeight: PANEL_MAX_HEIGHT });
  });

  it("下に収まらず上の方が広ければ上へ開き、パネルの下端をトリガーの上に付ける", () => {
    const low = { top: 700, bottom: 744, left: 16, width: 200 };
    const p = computePanelPlacement(low, { width: 200, height: 150 }, viewport);
    expect(p.side).toBe("top");
    expect(p.top + 150).toBe(700 - PANEL_GAP);
  });

  it("下が狭くても、上より広ければ下のまま高さを詰める (パネル内でスクロール)", () => {
    const mid = { top: 380, bottom: 424, left: 16, width: 200 };
    const p = computePanelPlacement(mid, { width: 200, height: 2000 }, viewport);
    expect(p.side).toBe("bottom");
    expect(p.maxHeight).toBe(PANEL_MAX_HEIGHT);
    const lowish = { top: 500, bottom: 544, left: 16, width: 200 };
    const q = computePanelPlacement(lowish, { width: 200, height: 2000 }, { width: 375, height: 600 });
    // 下 600-544-4-8=44 < 上 500-4-8=488 なので上へ。上限 320 で詰める。
    expect(q.side).toBe("top");
    expect(q.maxHeight).toBe(PANEL_MAX_HEIGHT);
    expect(q.top).toBe(500 - PANEL_GAP - PANEL_MAX_HEIGHT);
  });

  it("長い候補は上限の高さで止める", () => {
    const p = computePanelPlacement(trigger, { width: 200, height: 5000 }, viewport);
    expect(p.maxHeight).toBe(PANEL_MAX_HEIGHT);
  });

  it("右端からはみ出す分だけ内側へ寄せ、画面端から余白を保つ", () => {
    const right = { top: 100, bottom: 144, left: 300, width: 60 };
    const p = computePanelPlacement(right, { width: 240, height: 100 }, viewport);
    expect(p.left).toBe(375 - VIEWPORT_MARGIN - 240);
    const left = { top: 100, bottom: 144, left: -20, width: 60 };
    expect(computePanelPlacement(left, { width: 100, height: 100 }, viewport).left).toBe(
      VIEWPORT_MARGIN,
    );
  });

  it("画面より広いパネルは左端の余白に揃える", () => {
    const p = computePanelPlacement(trigger, { width: 600, height: 100 }, viewport);
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });

  it("トリガーが画面外へ出たら閉じる判定", () => {
    expect(isOutsideViewport({ top: -60, bottom: -10, left: 0, width: 100 }, viewport)).toBe(true);
    expect(isOutsideViewport({ top: 810, bottom: 850, left: 0, width: 100 }, viewport)).toBe(true);
    expect(isOutsideViewport({ top: -10, bottom: 30, left: 0, width: 100 }, viewport)).toBe(false);
  });
});

describe("optionsFromValues", () => {
  it("ラベルを省くと値をそのまま表示する", () => {
    expect(optionsFromValues(["対面", "電話"])).toEqual([
      { value: "対面", label: "対面" },
      { value: "電話", label: "電話" },
    ]);
  });

  it("ラベル関数で表示名を引く", () => {
    expect(optionsFromValues(["a"], (v) => v.toUpperCase())).toEqual([{ value: "a", label: "A" }]);
  });
});
