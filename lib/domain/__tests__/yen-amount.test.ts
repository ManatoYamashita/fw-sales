/**
 * 金額 (整数円) 正規化・表示純粋関数のユニットテスト (#172 sales-activity-ux)。
 *
 * 仕様の要点:
 * - 表示は 3 桁カンマ区切りのみ。「10万円」のような日本語単位の補助表示は生成しない
 * - 送信値 (canonical) はカンマなしの整数円文字列。未入力は空文字
 * - 全角数字・カンマ付き貼り付け・前後空白を受け付けて正規化する
 * - 負数・小数・英字・記号・DB integer 上限 (2,147,483,647) 超過は拒否する
 */

import { describe, expect, it } from "vitest";
import {
  applyYenAmountInput,
  extractYenDigits,
  formatYenDigits,
  MAX_YEN_AMOUNT,
  parseCanonicalYenAmount,
  parseYenAmount,
} from "@/lib/domain/yen-amount";

describe("parseCanonicalYenAmount", () => {
  it.each([
    ["", null],
    ["0", 0],
    ["100", 100],
    ["2147483647", MAX_YEN_AMOUNT],
  ])("canonical入力 %j を受理する", (raw, value) => {
    expect(parseCanonicalYenAmount(raw)).toEqual({ ok: true, value, canonical: raw });
  });

  it.each(["1e3", "+100", "-100", "0x10", "0b101", "1.5", "1000円", " 100", "100 "])(
    "非canonical入力 %j を拒否する",
    (raw) => {
      expect(parseCanonicalYenAmount(raw)).toEqual({ ok: false, reason: "invalid" });
    },
  );

  it("DB integer上限超過を拒否する", () => {
    expect(parseCanonicalYenAmount("2147483648")).toEqual({ ok: false, reason: "out_of_range" });
  });
});

describe("parseYenAmount", () => {
  it("100000 → canonical 100000 (value 100000)", () => {
    expect(parseYenAmount("100000")).toEqual({ ok: true, value: 100000, canonical: "100000" });
  });

  it("カンマ付き貼り付け 1,000,000 → canonical 1000000", () => {
    expect(parseYenAmount("1,000,000")).toEqual({ ok: true, value: 1000000, canonical: "1000000" });
  });

  it("全角カンマ・読点も桁区切りとして受け付ける", () => {
    expect(parseYenAmount("1，000，000")).toEqual({ ok: true, value: 1000000, canonical: "1000000" });
    expect(parseYenAmount("1、000、000")).toEqual({ ok: true, value: 1000000, canonical: "1000000" });
  });

  it("全角数字を半角へ正規化する", () => {
    expect(parseYenAmount("１００００")).toEqual({ ok: true, value: 10000, canonical: "10000" });
  });

  it("前後空白 (半角・全角) を正規化する", () => {
    expect(parseYenAmount("  25000  ")).toEqual({ ok: true, value: 25000, canonical: "25000" });
    expect(parseYenAmount("　25000　")).toEqual({ ok: true, value: 25000, canonical: "25000" });
  });

  it("数字の途中の空白は拒否する", () => {
    expect(parseYenAmount("1 000")).toEqual({ ok: false, reason: "invalid" });
  });

  it("空欄・空白のみは未入力 (value null, canonical 空文字)", () => {
    expect(parseYenAmount("")).toEqual({ ok: true, value: null, canonical: "" });
    expect(parseYenAmount("   ")).toEqual({ ok: true, value: null, canonical: "" });
  });

  it("0 は 0 として受理する (空欄扱いにしない)", () => {
    expect(parseYenAmount("0")).toEqual({ ok: true, value: 0, canonical: "0" });
  });

  it("先頭の余分な 0 は除去する", () => {
    expect(parseYenAmount("007000")).toEqual({ ok: true, value: 7000, canonical: "7000" });
  });

  it("負数を拒否する", () => {
    expect(parseYenAmount("-1000")).toEqual({ ok: false, reason: "invalid" });
  });

  it("小数を拒否する", () => {
    expect(parseYenAmount("1000.5")).toEqual({ ok: false, reason: "invalid" });
  });

  it("英字・記号を拒否する", () => {
    for (const raw of ["10a00", "¥1000", "1000円", "1e3", "+1000"]) {
      expect(parseYenAmount(raw)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("DB integer 上限ちょうど (2,147,483,647) は受理し、+1 は拒否する", () => {
    expect(parseYenAmount("2147483647")).toEqual({ ok: true, value: MAX_YEN_AMOUNT, canonical: "2147483647" });
    expect(parseYenAmount("2147483648")).toEqual({ ok: false, reason: "out_of_range" });
  });

  it("safe integer を超える巨大値・非常に長い入力を拒否する", () => {
    expect(parseYenAmount("9007199254740993")).toEqual({ ok: false, reason: "out_of_range" });
    expect(parseYenAmount("9".repeat(100))).toEqual({ ok: false, reason: "out_of_range" });
  });
});

describe("applyYenAmountInput (UI 入力状態遷移)", () => {
  it.each(["-100", "1.5", "1e3", "1000円"])("%s を別の金額へ変換せず拒否する", (raw) => {
    const state = applyYenAmountInput(raw);
    expect(state).toMatchObject({ display: raw, canonical: "" });
    expect(state.error).not.toBeNull();
  });

  it.each([
    ["１０００００", "100,000", "100000"],
    ["100,000", "100,000", "100000"],
    ["100，000", "100,000", "100000"],
    ["100、000", "100,000", "100000"],
    ["", "", ""],
    ["0", "0", "0"],
    ["2147483647", "2,147,483,647", "2147483647"],
  ])("%s を受理して表示 %s・canonical %s にする", (raw, display, canonical) => {
    expect(applyYenAmountInput(raw)).toEqual({ display, canonical, error: null });
  });

  it("上限 + 1 は拒否して canonical 送信値を作らない", () => {
    expect(applyYenAmountInput("2147483648")).toMatchObject({
      display: "2147483648",
      canonical: "",
    });
    expect(applyYenAmountInput("2147483648").error).not.toBeNull();
  });

  it("不正値を修正するとエラーが解除され canonical が復元する", () => {
    expect(applyYenAmountInput("-100").error).not.toBeNull();
    expect(applyYenAmountInput("100")).toEqual({ display: "100", canonical: "100", error: null });
  });
});

describe("extractYenDigits (入力中の逐次正規化)", () => {
  it("数字以外の文字を除外して数字列だけ残す", () => {
    expect(extractYenDigits("12a3b4")).toBe("1234");
    expect(extractYenDigits("abc")).toBe("");
  });

  it("カンマ・空白を除去し、全角数字を半角化する", () => {
    expect(extractYenDigits(" 1,２３4 ")).toBe("1234");
  });

  it("先頭 0 を除去する (0 単独は残す)", () => {
    expect(extractYenDigits("0012")).toBe("12");
    expect(extractYenDigits("0")).toBe("0");
  });

  it("空文字は空文字のまま", () => {
    expect(extractYenDigits("")).toBe("");
  });
});

describe("formatYenDigits (表示用カンマ区切り)", () => {
  it("100000 → 100,000 / 1000000 → 1,000,000", () => {
    expect(formatYenDigits("100000")).toBe("100,000");
    expect(formatYenDigits("1000000")).toBe("1,000,000");
  });

  it("3桁以下はカンマなし", () => {
    expect(formatYenDigits("0")).toBe("0");
    expect(formatYenDigits("999")).toBe("999");
  });

  it("空文字は空文字のまま (未入力に 0 を自動表示しない)", () => {
    expect(formatYenDigits("")).toBe("");
  });

  it("数字とカンマ以外の文字 (「万」「円」等の日本語単位) を含む表示を生成しない", () => {
    for (const canonical of ["100000", "2147483647", "0", "12345"]) {
      expect(formatYenDigits(canonical)).toMatch(/^[0-9,]*$/);
    }
  });
});
