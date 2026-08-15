/**
 * lib/env.ts の環境変数ヘルパの単体テスト。
 *
 * - `getGeminiModel` は営業資産生成のモデルを解決する。既定値は `gemini-3.6-flash`
 *   (旧既定 `gemini-2.5-flash` は 2026-10-16 シャットダウン)。`GEMINI_MODEL` による
 *   上書きは **切り戻し経路そのもの**なので、失われないようテストで固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGeminiModel,
  getResearchMaxOutputTokens,
  getResearchRunExpiresMarginMinutes,
} from "../env";
import { MIN_SAFE_EXPIRES_MARGIN_MINUTES } from "@/lib/ai/research/run-timing";

const KEYS = [
  "GEMINI_MODEL",
  "RESEARCH_MAX_OUTPUT_TOKENS",
  "RESEARCH_RUN_EXPIRES_MARGIN_MINUTES",
] as const;

/**
 * `readPositiveInt` が既定へフォールバックすべき不正値
 * (fix: PR #180 review Finding 6)。仕様上 `Number.parseInt` を使うため、
 * 「数値として解釈できない」「0以下」がフォールバック条件。
 */
const INVALID_POSITIVE_INT_VALUES = ["", "   ", "0", "-1", "-100", "abc", "NaN", "null"] as const;

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
  it("未設定なら24576 (feat/ai-research-quality-ux-hardening: 16384では成功Runが既に上限の81.7%を消費していた実測に基づく引き上げ)", () => {
    expect(getResearchMaxOutputTokens()).toBe(24576);
  });

  it("gemini-3.6-flash の output token limit (65,536) を超えない", () => {
    expect(getResearchMaxOutputTokens()).toBeLessThanOrEqual(65536);
  });

  it("RESEARCH_MAX_OUTPUT_TOKENS設定時はその値を返す", () => {
    process.env.RESEARCH_MAX_OUTPUT_TOKENS = "32768";
    expect(getResearchMaxOutputTokens()).toBe(32768);
  });

  it.each(INVALID_POSITIVE_INT_VALUES)(
    "不正値 %o は既定24576へフォールバックする(readPositiveInt仕様)",
    (raw) => {
      process.env.RESEARCH_MAX_OUTPUT_TOKENS = raw;
      expect(getResearchMaxOutputTokens()).toBe(24576);
    },
  );

  it("前後の空白付きの正の整数はtrimして解釈する(readEnv仕様)", () => {
    process.env.RESEARCH_MAX_OUTPUT_TOKENS = "  8192  ";
    expect(getResearchMaxOutputTokens()).toBe(8192);
  });
});

/**
 * fix: PR #180 review Finding 3 / Finding 6。
 * 旧実装は既定10分固定で、`readPositiveInt` の不正値フォールバックを検証する
 * テストが1件も無かった。加えて現在は安全下限への clamp が入る。
 */
describe("getResearchRunExpiresMarginMinutes", () => {
  it("未設定なら安全下限(Workflowのtimeout/retry構成から導出)を返す", () => {
    expect(getResearchRunExpiresMarginMinutes()).toBe(MIN_SAFE_EXPIRES_MARGIN_MINUTES);
  });

  it.each(INVALID_POSITIVE_INT_VALUES)(
    "不正値 %o は既定(=安全下限)へフォールバックする",
    (raw) => {
      process.env.RESEARCH_RUN_EXPIRES_MARGIN_MINUTES = raw;
      expect(getResearchRunExpiresMarginMinutes()).toBe(MIN_SAFE_EXPIRES_MARGIN_MINUTES);
    },
  );

  it("安全下限より長い値はそのまま尊重する(延長方向のoverrideは有効)", () => {
    const longer = MIN_SAFE_EXPIRES_MARGIN_MINUTES + 30;
    process.env.RESEARCH_RUN_EXPIRES_MARGIN_MINUTES = String(longer);
    expect(getResearchRunExpiresMarginMinutes()).toBe(longer);
  });

  it("安全下限未満の正の整数は下限へclampされ、警告ログを残す", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.RESEARCH_RUN_EXPIRES_MARGIN_MINUTES = String(MIN_SAFE_EXPIRES_MARGIN_MINUTES - 1);

    expect(getResearchRunExpiresMarginMinutes()).toBe(MIN_SAFE_EXPIRES_MARGIN_MINUTES);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[research.expiresMargin]"),
      expect.objectContaining({
        configured: MIN_SAFE_EXPIRES_MARGIN_MINUTES - 1,
        safeMinimum: MIN_SAFE_EXPIRES_MARGIN_MINUTES,
      }),
    );
    spy.mockRestore();
  });

  it("ちょうど安全下限の値はclampせずそのまま返す(警告も出さない)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.RESEARCH_RUN_EXPIRES_MARGIN_MINUTES = String(MIN_SAFE_EXPIRES_MARGIN_MINUTES);

    expect(getResearchRunExpiresMarginMinutes()).toBe(MIN_SAFE_EXPIRES_MARGIN_MINUTES);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
