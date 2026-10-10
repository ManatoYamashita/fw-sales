/**
 * AI 店舗調査の開始前チェック (#324)。
 *
 * 設定が足りない環境では run を作らずに理由を返す。返す文は利用者向けの固定文だけで、
 * 環境変数の値を含めない。
 */

import { describe, expect, it } from "vitest";
import { getResearchAvailability, RESEARCH_UNAVAILABLE_MESSAGES } from "../availability";

describe("getResearchAvailability", () => {
  it("API キーがあれば実行できる", () => {
    expect(getResearchAvailability({ GEMINI_API_KEY: "key", VERCEL: "1" })).toEqual({
      available: true,
    });
    expect(getResearchAvailability({ GEMINI_API_KEY: "key" })).toEqual({ available: true });
  });

  it.each([undefined, "", "   "])(
    "Vercel の外で API キーが無い (%j) なら、この環境では実行できないと伝える",
    (key) => {
      expect(getResearchAvailability({ GEMINI_API_KEY: key, VERCEL: "" })).toEqual({
        available: false,
        reason: "local_disabled",
        message: RESEARCH_UNAVAILABLE_MESSAGES.local_disabled,
      });
    },
  );

  it("Vercel 上で API キーが無ければ、管理者への設定依頼を伝える", () => {
    const result = getResearchAvailability({ GEMINI_API_KEY: "", VERCEL: "1" });
    expect(result).toEqual({
      available: false,
      reason: "missing_api_key",
      message: "AI調査を利用するための設定が完了していません。管理者に設定を依頼してください。",
    });
  });

  it("文言にキー名や値を含めない", () => {
    for (const message of Object.values(RESEARCH_UNAVAILABLE_MESSAGES)) {
      expect(message).not.toContain("GEMINI");
      expect(message).not.toContain("API_KEY");
    }
  });
});
