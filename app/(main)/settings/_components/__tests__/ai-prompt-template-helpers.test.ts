import { describe, expect, it } from "vitest";
import {
  createEmptyFewshot,
  calculateFewshotLength,
  canRemoveFewshot,
  canAddFewshot,
  MAX_FEWSHOTS,
  MAX_FEWSHOT_LENGTH,
} from "../ai-prompt-template-helpers";

describe("createEmptyFewshot", () => {
  it("空フィールドの FewShotExample を返す", () => {
    expect(createEmptyFewshot()).toEqual({
      title: "",
      store_meta: "",
      call_script_ideal: "",
    });
  });

  it("呼び出しごとに独立したオブジェクトを返す", () => {
    const a = createEmptyFewshot();
    const b = createEmptyFewshot();
    expect(a).not.toBe(b);
    a.title = "changed";
    expect(b.title).toBe("");
  });
});

describe("calculateFewshotLength", () => {
  it("3 フィールドの合計文字数を返す", () => {
    expect(
      calculateFewshotLength({
        title: "abc",
        store_meta: "de",
        call_script_ideal: "f",
      }),
    ).toBe(6);
  });

  it("全フィールドが空なら 0", () => {
    expect(calculateFewshotLength(createEmptyFewshot())).toBe(0);
  });

  it("マルチバイト文字も 1 文字としてカウントする", () => {
    expect(
      calculateFewshotLength({
        title: "あ",
        store_meta: "い",
        call_script_ideal: "う",
      }),
    ).toBe(3);
  });
});

describe("canRemoveFewshot", () => {
  it("1 件では false (削除不可)", () => {
    expect(canRemoveFewshot([createEmptyFewshot()])).toBe(false);
  });

  it("2 件では true (削除可)", () => {
    expect(canRemoveFewshot([createEmptyFewshot(), createEmptyFewshot()])).toBe(true);
  });

  it("MAX_FEWSHOTS 件でも true (削除可)", () => {
    const arr = Array.from({ length: MAX_FEWSHOTS }, createEmptyFewshot);
    expect(canRemoveFewshot(arr)).toBe(true);
  });
});

describe("canAddFewshot", () => {
  it("0 件では true", () => {
    expect(canAddFewshot([])).toBe(true);
  });

  it("MAX_FEWSHOTS - 1 件では true", () => {
    const arr = Array.from({ length: MAX_FEWSHOTS - 1 }, createEmptyFewshot);
    expect(canAddFewshot(arr)).toBe(true);
  });

  it("MAX_FEWSHOTS 件では false (上限)", () => {
    const arr = Array.from({ length: MAX_FEWSHOTS }, createEmptyFewshot);
    expect(canAddFewshot(arr)).toBe(false);
  });
});

describe("定数値", () => {
  it("MAX_FEWSHOTS は 10", () => {
    expect(MAX_FEWSHOTS).toBe(10);
  });

  it("MAX_FEWSHOT_LENGTH は 4000", () => {
    expect(MAX_FEWSHOT_LENGTH).toBe(4000);
  });
});
