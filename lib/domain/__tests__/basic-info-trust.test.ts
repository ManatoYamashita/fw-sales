/**
 * 基本情報の値の信頼度判定 (#335)。
 *
 * 境界値 (0・49・50・69・70・80・81・100)、未入力、スコア欠落、範囲外・非有限値を固定する。
 * 取得区分 (tier) や由来 (filled_by) で判定が変わらないことも確かめる。
 */

import { describe, expect, it } from "vitest";
import {
  basicInfoTrustLabel,
  classifyBasicInfoTrust,
  classifyConfidenceScore,
  hasBasicInfoValue,
} from "../basic-info-trust";
import type { BasicInfoField } from "@/types/basic-info";

function field(overrides: Partial<BasicInfoField> = {}): BasicInfoField {
  return {
    value: "東京都港区",
    tier: "A",
    filled_by: "manual",
    updated_at: "2026-10-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("classifyConfidenceScore", () => {
  it.each([
    [100, "high"],
    [81, "high"],
    [80.99, "check"],
    [80, "check"],
    [70, "check"],
    [69, "check"],
    [50, "check"],
    [49.99, "low"],
    [49, "low"],
    [0, "low"],
  ] as const)("%s → %s", (score, expected) => {
    expect(classifyConfidenceScore(score)).toBe(expected);
  });

  it.each([
    ["範囲外 (上)", 100.01],
    ["範囲外 (下)", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["数字の文字列", "90"],
    ["null", null],
    ["undefined", undefined],
  ])("%s は判定しない", (_name, score) => {
    expect(classifyConfidenceScore(score)).toBeNull();
  });
});

describe("classifyBasicInfoTrust", () => {
  it("値が無ければ、スコアや取得区分に関係なく未入力 (色なし)", () => {
    expect(classifyBasicInfoTrust(undefined)).toEqual({ kind: "empty" });
    expect(classifyBasicInfoTrust(field({ value: null, confidence: 95 }))).toEqual({ kind: "empty" });
    expect(classifyBasicInfoTrust(field({ value: "  \n ", confidence: 95 }))).toEqual({ kind: "empty" });
    // 旧表示は空欄にも既定の区分 A から「高信頼」を出していた。
    expect(classifyBasicInfoTrust(field({ value: "", tier: "A" }))).toEqual({ kind: "empty" });
  });

  it("スコアが無い値は未評価。手入力・Places 由来でも緑にしない", () => {
    expect(classifyBasicInfoTrust(field({ filled_by: "manual" }))).toEqual({ kind: "unrated" });
    expect(classifyBasicInfoTrust(field({ filled_by: "places" }))).toEqual({ kind: "unrated" });
    expect(classifyBasicInfoTrust(field({ tier: "A", confidence: undefined }))).toEqual({ kind: "unrated" });
  });

  it("壊れたスコアは未評価に倒し、丸めて高信頼にしない", () => {
    expect(classifyBasicInfoTrust(field({ confidence: 150 }))).toEqual({ kind: "unrated" });
    expect(classifyBasicInfoTrust(field({ confidence: Number.NaN }))).toEqual({ kind: "unrated" });
    // jsonb から読んだ値は型どおりとは限らない。
    expect(
      classifyBasicInfoTrust(field({ confidence: "95" as unknown as number })),
    ).toEqual({ kind: "unrated" });
  });

  it("スコアがある値はスコアだけで段階を決め、取得区分では決めない", () => {
    expect(classifyBasicInfoTrust(field({ tier: "C", confidence: 90 }))).toEqual({
      kind: "rated",
      level: "high",
      score: 90,
    });
    expect(classifyBasicInfoTrust(field({ tier: "A", confidence: 30 }))).toEqual({
      kind: "rated",
      level: "low",
      score: 30,
    });
    expect(classifyBasicInfoTrust(field({ tier: "B", confidence: 75 }))).toEqual({
      kind: "rated",
      level: "check",
      score: 75,
    });
  });
});

describe("basicInfoTrustLabel / hasBasicInfoValue", () => {
  it("色以外でも区別できる短いラベルを返す", () => {
    expect(basicInfoTrustLabel({ kind: "rated", level: "high", score: 90 })).toBe("高");
    expect(basicInfoTrustLabel({ kind: "rated", level: "check", score: 60 })).toBe("要確認");
    expect(basicInfoTrustLabel({ kind: "rated", level: "low", score: 10 })).toBe("低");
    expect(basicInfoTrustLabel({ kind: "empty" })).toBe("未入力");
    expect(basicInfoTrustLabel({ kind: "unrated" })).toBe("未評価");
  });

  it("空白だけの値は未入力として数える", () => {
    expect(hasBasicInfoValue(field({ value: "x" }))).toBe(true);
    expect(hasBasicInfoValue(field({ value: " " }))).toBe(false);
    expect(hasBasicInfoValue(field({ value: null }))).toBe(false);
    expect(hasBasicInfoValue(undefined)).toBe(false);
  });
});
