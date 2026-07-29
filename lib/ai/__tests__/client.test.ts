/**
 * `lib/ai/client.ts` のユニットテスト (Gemini 3.6 Flash 移行)。
 *
 * テスト方針:
 * - `@google/genai` を class mock で差し替え、**実 API を一切呼ばない**
 *   (`.kiro/specs/ai-store-analysis/tasks.md` の Implementation Note どおり、
 *    `vi.fn().mockImplementation()` ではなく class 形式で mock する)
 * - 検証の主眼は「Gemini 3 系で deprecated な sampling parameter を送っていないこと」と
 *   「構造化出力まわりの config が据置であること」
 * - エラー正規化は kind だけを見る。SDK 生メッセージが上位へ漏れないことも併せて確認する
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Part } from "@google/genai";

vi.mock("server-only", () => ({}));

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/genai", () => {
  class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
    constructor(_opts: unknown) {
      void _opts;
    }
  }
  return {
    GoogleGenAI: MockGoogleGenAI,
    // 実装は enum 値で比較するため、mock 側でも同じ文字列値を提供する。
    FinishReason: { STOP: "STOP", MAX_TOKENS: "MAX_TOKENS" },
  };
});

const { createGeminiClient, isAiClientError } = await import("../client");

const USER_PARTS: Part[] = [{ text: "## 店舗基本情報\n- 屋号: 導楽" }];
const JSON_SCHEMA = { type: "object", properties: {} } as Record<string, unknown>;
const SYSTEM_PROMPT = "あなたは営業支援 AI です";

const ENV_KEYS = ["GEMINI_API_KEY", "GEMINI_MODEL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GEMINI_API_KEY = "test-key";
  mockGenerateContent.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function okResponse(payload: unknown) {
  return {
    text: JSON.stringify(payload),
    candidates: [{ finishReason: "STOP" }],
  };
}

async function callClient(signal = AbortSignal.timeout(1_000)) {
  return createGeminiClient().generateAnalysis(
    { systemPrompt: SYSTEM_PROMPT, userParts: USER_PARTS, jsonSchema: JSON_SCHEMA },
    signal,
  );
}

/** 直近の `generateContent` 呼出に渡された引数。未呼出なら明示的に失敗させる。 */
function lastCallArgs(): {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
} {
  const call = mockGenerateContent.mock.calls.at(-1);
  if (!call) throw new Error("generateContent が呼ばれていない");
  return call[0];
}

describe("createGeminiClient — リクエスト構築", () => {
  it("env 未設定なら既定モデル gemini-3.6-flash で呼ぶ", async () => {
    mockGenerateContent.mockResolvedValue(okResponse({ ok: true }));
    await callClient();
    expect(lastCallArgs().model).toBe("gemini-3.6-flash");
  });

  it("GEMINI_MODEL 設定時はその値で呼ぶ (切り戻し経路の担保)", async () => {
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    mockGenerateContent.mockResolvedValue(okResponse({ ok: true }));
    await callClient();
    expect(lastCallArgs().model).toBe("gemini-3.5-flash");
  });

  // Gemini 3 系で deprecated。公式は「既定値から変えるな」としており、
  // 送ってしまうと loop や性能劣化を招きうる。本 PR の中核となる回帰防止テスト。
  it.each(["temperature", "topP", "topK"])(
    "config に deprecated な %s を含めない",
    async (key) => {
      mockGenerateContent.mockResolvedValue(okResponse({ ok: true }));
      await callClient();
      expect(lastCallArgs().config).not.toHaveProperty(key);
    },
  );

  it("構造化出力の config を据置で渡す", async () => {
    mockGenerateContent.mockResolvedValue(okResponse({ ok: true }));
    await callClient();
    const { config } = lastCallArgs();

    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toBe(JSON_SCHEMA);
    expect(config.systemInstruction).toBe(SYSTEM_PROMPT);
    expect(config.maxOutputTokens).toBe(4096);
  });

  it("user parts と AbortSignal を据置で渡す", async () => {
    const signal = AbortSignal.timeout(1_000);
    mockGenerateContent.mockResolvedValue(okResponse({ ok: true }));
    await callClient(signal);
    const { contents, config } = lastCallArgs();

    expect(contents).toEqual([{ role: "user", parts: USER_PARTS }]);
    expect(config.abortSignal).toBe(signal);
  });

  it("正常な JSON をパースして返す", async () => {
    mockGenerateContent.mockResolvedValue(okResponse({ call_script: "こんにちは" }));
    await expect(callClient()).resolves.toEqual({ call_script: "こんにちは" });
  });
});

describe("createGeminiClient — エラー正規化", () => {
  async function expectKind(kind: string) {
    await expect(callClient()).rejects.toMatchObject({ kind });
  }

  it("API キー未設定は missing_api_key (SDK を呼ばない)", async () => {
    delete process.env.GEMINI_API_KEY;
    await expectKind("missing_api_key");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  // finishReason は「本文の有無」より先に見る。本文が空でも、途中まで生成された
  // 不完全な JSON が入っていても、MAX_TOKENS なら必ず max_tokens に落とす。
  it.each([
    ["本文が空", ""],
    ["途中で切れた JSON 本文あり", '{"call_script":"途中で'],
    ["完全な JSON に見える本文あり", '{"call_script":"完結して見える"}'],
  ])("finishReason=MAX_TOKENS は %s でも max_tokens", async (_label, text) => {
    mockGenerateContent.mockResolvedValue({
      text,
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });
    await expectKind("max_tokens");
  });

  it("STOP + 正常な JSON は成功する (MAX_TOKENS 判定が正常系を巻き込まない)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"call_script":"正常"}',
      candidates: [{ finishReason: "STOP" }],
    });
    await expect(callClient()).resolves.toEqual({ call_script: "正常" });
  });

  it("STOP + 不正 JSON は unknown (応答本文もパーサ生メッセージも漏らさない)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"secret_leak":"漏れてはいけない本文',
      candidates: [{ finishReason: "STOP" }],
    });
    const err = await callClient().catch((e: unknown) => e);
    expect(err).toMatchObject({
      kind: "unknown",
      message: "AI 分析の応答を JSON として解釈できませんでした",
    });
    expect(JSON.stringify(err)).not.toContain("漏れてはいけない本文");
  });

  // JSON.parse の SyntaxError は位置番号を含む
  // (例: "Unterminated string in JSON at position 466")。これを SDK エラーの
  // ステータス抽出ヒューリスティック (\b[45]\d\d\b) に流すと api_error(466) に
  // 誤分類されるため、parse は独立した経路で処理する。
  it("パース位置が 4xx/5xx でも api_error に誤分類しない", async () => {
    mockGenerateContent.mockResolvedValue({
      text: `{"a":"${"x".repeat(460)}`,
      candidates: [{ finishReason: "STOP" }],
    });
    await expect(callClient()).rejects.toMatchObject({ kind: "unknown" });
  });

  it("finishReason なしの空応答は unknown", async () => {
    mockGenerateContent.mockResolvedValue({ text: "", candidates: [] });
    await expect(callClient()).rejects.toMatchObject({
      kind: "unknown",
      message: "AI 分析の応答が空でした",
    });
  });

  it("AbortError は timeout", async () => {
    mockGenerateContent.mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );
    await expectKind("timeout");
  });

  it("fetch failed の TypeError は network_error", async () => {
    mockGenerateContent.mockRejectedValue(new TypeError("fetch failed"));
    await expectKind("network_error");
  });

  it.each([
    ["401 Unauthorized", "auth_error"],
    ["Invalid API key provided", "auth_error"],
    ["429 rate limit exceeded", "rate_limit"],
    ["quota exceeded for this project", "rate_limit"],
    ["500 Internal Server Error", "api_error"],
    ["503 Service Unavailable", "api_error"],
  ])("SDK エラー %s は %s に分類する", async (message, kind) => {
    mockGenerateContent.mockRejectedValue(new Error(message));
    await expectKind(kind);
  });

  // 404 を専用 kind にはしない (「404 = モデル不存在」と断定できる構造化シグナルを
  // SDK の型から確認できなかったため)。api_error として status を UI に出し、
  // 切り分けは runbook の手順に委ねる。
  it("メッセージに 404 を含むエラーは api_error(404) に分類する", async () => {
    mockGenerateContent.mockRejectedValue(new Error("404 Not Found"));
    await expect(callClient()).rejects.toMatchObject({
      kind: "api_error",
      status: 404,
    });
  });

  it("api_error は status を保持する", async () => {
    mockGenerateContent.mockRejectedValue(new Error("500 Internal Server Error"));
    await expect(callClient()).rejects.toMatchObject({
      kind: "api_error",
      status: 500,
    });
  });
});

// SDK の `ApiError` は `status: number` を持つ。文字列マッチより信頼でき、
// 数字を含まない文面 (NOT_FOUND 等) でもステータスを失わない。
describe("createGeminiClient — 構造化ステータスによる分類", () => {
  /** SDK の ApiError 相当 (status を持つ Error)。 */
  function apiError(status: number, message: string): Error & { status: number } {
    return Object.assign(new Error(message), { status });
  }

  it("メッセージに数字が無い NOT_FOUND でも status から api_error(404) にできる", async () => {
    mockGenerateContent.mockRejectedValue(
      apiError(
        404,
        "models/gemini-typo is NOT_FOUND for API version v1beta, or is not supported",
      ),
    );
    await expect(callClient()).rejects.toMatchObject({
      kind: "api_error",
      status: 404,
    });
  });

  it.each([
    [401, "auth_error"],
    [403, "auth_error"],
    [429, "rate_limit"],
    [500, "api_error"],
    [503, "api_error"],
  ])("status=%s は %s に分類する", async (status, kind) => {
    mockGenerateContent.mockRejectedValue(apiError(status, "opaque message"));
    await expect(callClient()).rejects.toMatchObject({ kind });
  });

  it.each([
    ["範囲外 (200)", 200],
    ["範囲外 (600)", 600],
  ])("%s は構造化ステータスとして採用しない", async (_label, status) => {
    mockGenerateContent.mockRejectedValue(apiError(status, "opaque message"));
    await expect(callClient()).rejects.toMatchObject({ kind: "unknown" });
  });

  it("status が数値でない場合はメッセージ判定へフォールバックする", async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error("503 Service Unavailable"), { status: "503" }),
    );
    await expect(callClient()).rejects.toMatchObject({
      kind: "api_error",
      status: 503,
    });
  });

  it("SDK 生メッセージ (API キー混入を含む) を上位へ渡さない", async () => {
    mockGenerateContent.mockRejectedValue(
      new Error("request failed with key AIzaSyFAKEKEY123 requestId=abc-123"),
    );
    const err = await callClient().catch((e) => e);
    const serialized = JSON.stringify(err);
    expect(serialized).not.toContain("AIzaSyFAKEKEY123");
    expect(serialized).not.toContain("abc-123");
  });
});

describe("isAiClientError", () => {
  it.each([
    "missing_api_key",
    "timeout",
    "rate_limit",
    "auth_error",
    "max_tokens",
    "api_error",
    "network_error",
    "unknown",
  ])("kind=%s を AiClientError と判定する", (kind) => {
    expect(isAiClientError({ kind })).toBe(true);
  });

  it.each([
    ["null", null],
    ["文字列", "timeout"],
    ["kind なし", { message: "boom" }],
    ["未知の kind", { kind: "teapot" }],
    ["通常の Error", new Error("boom")],
  ])("%s は AiClientError と判定しない", (_label, value) => {
    expect(isAiClientError(value)).toBe(false);
  });
});
