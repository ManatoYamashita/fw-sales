/**
 * lib/env.ts の環境変数ヘルパの単体テスト。
 *
 * - `getGeminiModel` は営業資産生成のモデルを解決する。既定値は `gemini-3.6-flash`
 *   (旧既定 `gemini-2.5-flash` は 2026-10-16 シャットダウン)。`GEMINI_MODEL` による
 *   上書きは **切り戻し経路そのもの**なので、失われないようテストで固定する。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGeminiModel, getResearchMaxOutputTokens } from "../env";

const KEYS = ["GEMINI_MODEL", "RESEARCH_MAX_OUTPUT_TOKENS"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getGeminiModel", () => {
  it("未設定なら gemini-3.6-flash (2026-10 の 2.5 系シャットダウン対応)", () => {
    expect(getGeminiModel()).toBe("gemini-3.6-flash");
  });

  it("GEMINI_MODEL 設定時はその値を返す (代替 GA モデルへの切り戻し経路)", () => {
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    expect(getGeminiModel()).toBe("gemini-3.5-flash");
  });

  it("空文字・空白のみは未設定扱いで既定へフォールバックする (readEnv 仕様)", () => {
    for (const blank of ["", "   "]) {
      process.env.GEMINI_MODEL = blank;
      expect(getGeminiModel()).toBe("gemini-3.6-flash");
    }
  });

  it("前後の空白は trim される (readEnv 仕様)", () => {
    process.env.GEMINI_MODEL = "  gemini-3.5-flash-lite  ";
    expect(getGeminiModel()).toBe("gemini-3.5-flash-lite");
  });
});

describe("getResearchMaxOutputTokens (fix/ai-research-stage2-max-tokens)", () => {
  it("未設定なら16384 (Stage2統合後の実機smoke testでthoughts+candidatesが8192上限に到達し失敗した実測に基づく引き上げ)", () => {
    expect(getResearchMaxOutputTokens()).toBe(16384);
  });

  it("RESEARCH_MAX_OUTPUT_TOKENS設定時はその値を返す", () => {
    process.env.RESEARCH_MAX_OUTPUT_TOKENS = "24576";
    expect(getResearchMaxOutputTokens()).toBe(24576);
  });
});
