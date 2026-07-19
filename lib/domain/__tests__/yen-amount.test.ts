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
import { extractYenDigits, formatYenDigits, MAX_YEN_AMOUNT, parseYenAmount } from "@/lib/domain/yen-amount";

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
