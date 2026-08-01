/**
 * lib/env.ts の環境変数ヘルパの単体テスト。
 *
 * - `getGeminiModel` は営業資産生成のモデルを解決する。既定値は `gemini-3.6-flash`
 *   (旧既定 `gemini-2.5-flash` は 2026-10-16 シャットダウン)。`GEMINI_MODEL` による
 *   上書きは **切り戻し経路そのもの**なので、失われないようテストで固定する。
 * - `getStallThresholdMs` / `getStallGraceMs` は `readPositiveInt` (分) を読み、
 *   ミリ秒に変換して返す。未設定/不正値はデフォルトにフォールバックする。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGeminiModel,
  getStallThresholdMs,
  getStallGraceMs,
  getStructurerMaxOutputTokens,
} from "../env";

const KEYS = [
  "GEMINI_MODEL",
  "DEEP_RESEARCH_STALL_THRESHOLD_MIN",
  "DEEP_RESEARCH_STALL_GRACE_MIN",
  "DEEP_RESEARCH_STRUCTURER_MAX_TOKENS",
] as const;

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

describe("getStallThresholdMs", () => {
  it("未設定ならデフォルト 90 分 (= 5,400,000ms)", () => {
    expect(getStallThresholdMs()).toBe(90 * 60_000);
  });

  it("正常値は 分 * 60_000 で返る", () => {
    process.env.DEEP_RESEARCH_STALL_THRESHOLD_MIN = "120";
    expect(getStallThresholdMs()).toBe(120 * 60_000);
  });

  it("不正値 (0 / 負 / 非数値) はデフォルトにフォールバック", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      process.env.DEEP_RESEARCH_STALL_THRESHOLD_MIN = bad;
      expect(getStallThresholdMs()).toBe(90 * 60_000);
    }
  });
});

describe("getStallGraceMs", () => {
  it("未設定ならデフォルト 60 分 (= 3,600,000ms)", () => {
    expect(getStallGraceMs()).toBe(60 * 60_000);
  });

  it("正常値は 分 * 60_000 で返る", () => {
    process.env.DEEP_RESEARCH_STALL_GRACE_MIN = "45";
    expect(getStallGraceMs()).toBe(45 * 60_000);
  });

  it("不正値はデフォルトにフォールバック", () => {
    process.env.DEEP_RESEARCH_STALL_GRACE_MIN = "-1";
    expect(getStallGraceMs()).toBe(60 * 60_000);
  });
});

describe("getStructurerMaxOutputTokens", () => {
  it("未設定ならデフォルト 16384", () => {
    expect(getStructurerMaxOutputTokens()).toBe(16384);
  });

  it("正常値はそのまま返る", () => {
    process.env.DEEP_RESEARCH_STRUCTURER_MAX_TOKENS = "32768";
    expect(getStructurerMaxOutputTokens()).toBe(32768);
  });

  it("不正値 (0 / 負 / 非数値) はデフォルトにフォールバック", () => {
    for (const bad of ["0", "-1", "abc", ""]) {
      process.env.DEEP_RESEARCH_STRUCTURER_MAX_TOKENS = bad;
      expect(getStructurerMaxOutputTokens()).toBe(16384);
    }
  });
});
