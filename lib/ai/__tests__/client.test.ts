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

const {
  createGeminiClient,
  isAiClientError,
  extractProviderDiagnostics,
  classifyProviderMessage,
  hasControlChars,
  hasUnpairedSurrogate,
} = await import("../client");

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
    [400, "api_error"],
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

  // Gemini は無効な API キーに対して 401 ではなく 400 (INVALID_ARGUMENT /
  // reason=API_KEY_INVALID) を返す。構造化ステータスだけで分類すると api_error(400) に
  // 落ち、恒久的な設定不備に対して UI が「再度お試しください」と誤案内してしまう。
  // 一方で通常の 400 (malformed request) まで auth_error に巻き込んではいけない。
  describe("status=400 の切り分け", () => {
    /** Google が無効な API キーに返す 400 body。SDK は body 全体を stringify して message に入れる。 */
    const API_KEY_INVALID_BODY = JSON.stringify({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_INVALID",
            domain: "googleapis.com",
            metadata: { service: "generativelanguage.googleapis.com" },
          },
        ],
      },
    });

    /** API キーとは無関係な通常の 400。auth_error に巻き込んではいけない。 */
    const MALFORMED_REQUEST_BODY = JSON.stringify({
      error: {
        code: 400,
        message:
          'Invalid JSON payload received. Unknown name "foo" at \'generation_config\'.',
        status: "INVALID_ARGUMENT",
      },
    });

    it("reason=API_KEY_INVALID を含む 400 は auth_error", async () => {
      mockGenerateContent.mockRejectedValue(apiError(400, API_KEY_INVALID_BODY));
      await expect(callClient()).rejects.toMatchObject({ kind: "auth_error" });
    });

    // body 全体を stringify せず error.message だけを載せる形状でも拾えること。
    it("reason 無しでも公式文言 'API key not valid' を含む 400 は auth_error", async () => {
      mockGenerateContent.mockRejectedValue(
        apiError(400, "400 API key not valid. Please pass a valid API key."),
      );
      await expect(callClient()).rejects.toMatchObject({ kind: "auth_error" });
    });

    it("通常の INVALID_ARGUMENT な 400 は api_error(400) のまま", async () => {
      mockGenerateContent.mockRejectedValue(
        apiError(400, MALFORMED_REQUEST_BODY),
      );
      await expect(callClient()).rejects.toMatchObject({
        kind: "api_error",
        status: 400,
      });
    });

    it("marker を含まない 400 は api_error(400) のまま", async () => {
      mockGenerateContent.mockRejectedValue(apiError(400, "opaque message"));
      await expect(callClient()).rejects.toMatchObject({
        kind: "api_error",
        status: 400,
      });
    });

    // 判定にメッセージ文字列を使うようになっても、そのメッセージ自体は上位へ渡さない。
    it("API キー不正判定に使ったメッセージを上位へ渡さない", async () => {
      mockGenerateContent.mockRejectedValue(
        apiError(
          400,
          `${API_KEY_INVALID_BODY} key=AIzaSyFAKEKEY123 requestId=abc-123`,
        ),
      );
      const err = await callClient().catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: "auth_error" });
      const serialized = JSON.stringify(err);
      expect(serialized).not.toContain("AIzaSyFAKEKEY123");
      expect(serialized).not.toContain("abc-123");
      expect(serialized).not.toContain("API_KEY_INVALID");
    });
  });
});

/**
 * runtime reliability hardening (F4)。
 *
 * `@google/genai` 1.52.0 の `ApiError` は `{ message, status }` しか公開せず
 * (`genai.d.ts:332-354`)、HTTP headers は SDK が破棄する。`error.details[]` /
 * `error.status` は **`message` に `JSON.stringify` された文字列としてのみ**存在する
 * (`dist/index.mjs:8205-8224`)。
 *
 * billing 枯渇と一時的 rate limit はどちらも 429 として届き、現時点では安全に区別できない
 * (どの `reason` トークンが billing を示すかがコード・テスト・ドキュメントのいずれからも
 * 確認できない)。そのため**分類は増やさず**、次回インシデントで切り分けられるよう
 * provider 側の列挙トークンだけを sanitized に取り出してログへ出す。
 */
describe("extractProviderDiagnostics (sanitized provider診断、runtime reliability hardening)", () => {
  /** SDK の ApiError 相当 (status を持つ Error)。 */
  function apiError(status: number, message: string): Error & { status: number } {
    return Object.assign(new Error(message), { status });
  }

  const RESOURCE_EXHAUSTED_BODY = JSON.stringify({
    error: {
      code: 429,
      message: "Resource has been exhausted (e.g. check quota).",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "RATE_LIMIT_EXCEEDED",
          domain: "googleapis.com",
        },
      ],
    },
  });

  it("Google標準のerror bodyからhttp_status/provider_status/provider_reasonを取り出す", () => {
    // `provider_detail_types` は PR #180 で追加した項目(`@type` の末尾トークンのみ)。
    // このfixtureの details は `google.rpc.ErrorInfo` なので "ErrorInfo" が入る。
    // `provider_message_class` は PR #180 で追加(自由文を閉じた語彙へ分類したもの)。
    // このfixtureの message は既知 pattern のいずれにも当たらないので "unclassified"。
    expect(extractProviderDiagnostics(apiError(429, RESOURCE_EXHAUSTED_BODY))).toEqual({
      http_status: 429,
      provider_status: "RESOURCE_EXHAUSTED",
      provider_reason: "RATE_LIMIT_EXCEEDED",
      provider_detail_types: ["ErrorInfo"],
      provider_message_class: "unclassified",
    });
  });

  it("既存の400 fixture(API_KEY_INVALID)からも同じ形で取り出せる", () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_INVALID",
          },
        ],
      },
    });
    expect(extractProviderDiagnostics(apiError(400, body))).toEqual({
      http_status: 400,
      provider_status: "INVALID_ARGUMENT",
      provider_reason: "API_KEY_INVALID",
      provider_detail_types: ["ErrorInfo"],
      provider_message_class: "unclassified",
    });
  });

  it("API key / request ID / 自由文 message を抽出しない", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: "quota exceeded for key AIzaSyFAKEKEY123 (requestId 8f3c1d2e-aaaa-bbbb)",
        status: "RESOURCE_EXHAUSTED",
        details: [{ reason: "RATE_LIMIT_EXCEEDED", metadata: { key: "AIzaSyFAKEKEY123" } }],
      },
    });
    const diagnostics = extractProviderDiagnostics(apiError(429, body));
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("AIzaSyFAKEKEY123");
    expect(serialized).not.toContain("8f3c1d2e");
    expect(serialized).not.toContain("quota exceeded");
    expect(diagnostics.provider_status).toBe("RESOURCE_EXHAUSTED");
  });

  it.each([
    ['"status":"Resource_Exhausted"', "混在ケースは列挙トークンではない"],
    ['"status":"resource exhausted"', "空白を含む値は列挙トークンではない"],
    ['"status":"リソース枯渇"', "非ASCIIは抽出しない"],
    ['"status":"AB"', "短すぎる値は抽出しない"],
    [`"status":"${"A".repeat(80)}"`, "長すぎる値は抽出しない"],
  ])("%s は provider_status として抽出しない (%s)", (fragment) => {
    const diagnostics = extractProviderDiagnostics(apiError(429, `{"error":{${fragment}}}`));
    expect(diagnostics.provider_status).toBeUndefined();
  });

  it("status/reason キーが無いbodyではhttp_statusのみ返す", () => {
    expect(extractProviderDiagnostics(apiError(500, "opaque server error"))).toEqual({
      http_status: 500,
    });
  });

  it("非Error / null / 文字列でも throw せず空オブジェクトを返す", () => {
    expect(extractProviderDiagnostics(null)).toEqual({});
    expect(extractProviderDiagnostics("boom")).toEqual({});
    expect(extractProviderDiagnostics(undefined)).toEqual({});
    expect(extractProviderDiagnostics({ nope: true })).toEqual({});
  });

  it("statusを持たない通常のErrorでもmessage内のトークンは拾える", () => {
    const err = new Error('{"error":{"status":"UNAVAILABLE"}}');
    expect(extractProviderDiagnostics(err)).toEqual({ provider_status: "UNAVAILABLE" });
  });
});

/**
 * `google.rpc.BadRequest` の field violation 抽出(PR #180、Stage2 400 observability)。
 *
 * ## 背景
 *
 * 実機 Preview で Stage2 が `http_status=400 / provider_status=INVALID_ARGUMENT` で
 * 2回連続失敗した。現在のログはこの2値までしか出さないため、
 * 「request config(schema)側の問題」なのか「動的 prompt(contents)側の問題」なのか、
 * あるいは provider の一過性なのかを切り分ける情報が残っていなかった。
 *
 * `@google/genai` 1.52.0 は非2xx応答で **error body 全体を `JSON.stringify` して
 * `ApiError.message` へ入れる**(`dist/index.mjs` の `!response.ok` 分岐)。
 * したがって `error.details[].fieldViolations[].field`(= API のフィールドパス)は
 * message 内に存在する。これは値ではなく**フィールド名**なので、
 * 厳格な shape guard を通せば安全にログへ出せる。
 *
 * ## 絶対に出さないもの
 *
 * `fieldViolations[].description`(自由文。prompt 断片・店舗名を含みうる)、
 * `error.message`、raw body、API key、request ID。
 * shape guard を通らない値は**加工して残すのではなく完全に drop** する。
 */
describe("extractProviderDiagnostics — provider_field_violations / provider_detail_types", () => {
  function apiError(status: number, message: string): Error & { status: number } {
    return Object.assign(new Error(message), { status });
  }

  const badRequest = (fieldViolations: unknown[], extra: Record<string, unknown> = {}) =>
    apiError(
      400,
      JSON.stringify({
        error: {
          code: 400,
          message: "Request contains an invalid argument.",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations,
              ...extra,
            },
          ],
        },
      }),
    );

  it("1. BadRequest の fieldViolations[].field を抽出する", () => {
    const result = extractProviderDiagnostics(
      badRequest([{ field: "generation_config.response_json_schema" }]),
    );
    expect(result.provider_status).toBe("INVALID_ARGUMENT");
    expect(result.provider_field_violations).toEqual([
      "generation_config.response_json_schema",
    ]);
  });

  it("2. contents[0].parts[0].text 形式の index 付き path も受理する", () => {
    const result = extractProviderDiagnostics(
      badRequest([{ field: "contents" }, { field: "contents[0].parts[0].text" }]),
    );
    expect(result.provider_field_violations).toEqual(["contents", "contents[0].parts[0].text"]);
  });

  it("3. 重複する field は除去する", () => {
    const result = extractProviderDiagnostics(
      badRequest([{ field: "contents" }, { field: "contents" }, { field: "tools[0].url_context" }]),
    );
    expect(result.provider_field_violations).toEqual(["contents", "tools[0].url_context"]);
  });

  it("4. 安全な field が6件以上あっても5件で打ち切る", () => {
    const result = extractProviderDiagnostics(
      badRequest([1, 2, 3, 4, 5, 6, 7].map((i) => ({ field: `contents[${i}].parts` }))),
    );
    expect(result.provider_field_violations).toHaveLength(5);
    expect(result.provider_field_violations?.[0]).toBe("contents[1].parts");
  });

  it.each([
    ["空白を含む", "invalid argument here"],
    ["URLを含む", "https://tabelog.com/kanagawa/"],
    ["quoteを含む", 'contents"0"'],
    ["日本語を含む", "対象店舗 関内 なむら"],
    ["slashを含む", "type.googleapis.com/google.rpc.BadRequest"],
    ["colonを含む", "error:contents"],
    ["自由文メッセージ", "Invalid JSON payload received. Unknown name."],
    ["大文字を含む", "generationConfig.responseJsonSchema"],
    ["空文字", ""],
    ["長すぎる", `a${".b".repeat(120)}`],
  ])("5-8. 安全でない field(%s)は完全に drop する", (_label, field) => {
    const result = extractProviderDiagnostics(badRequest([{ field }]));
    expect(result.provider_field_violations).toBeUndefined();
    // 空文字は `toContain("")` が常に真になるため部分文字列チェックの対象外
    // (drop されていることは上の assertion で担保済み)。
    if (field !== "") {
      expect(JSON.stringify(result)).not.toContain(field.slice(0, 20));
    }
  });

  it("安全な field と安全でない field が混在する場合、安全なものだけを残す", () => {
    const result = extractProviderDiagnostics(
      badRequest([
        { field: "対象店舗 関内 なむら" },
        { field: "contents" },
        { field: "https://example.com/x" },
      ]),
    );
    expect(result.provider_field_violations).toEqual(["contents"]);
  });

  it("9. message が JSON として parse できなくても throw せず field violations を省略する", () => {
    const result = extractProviderDiagnostics(apiError(400, "not json at all"));
    expect(result).toEqual({ http_status: 400 });
  });

  it("9b. JSON だが期待 shape でない場合も安全に省略する", () => {
    for (const body of [
      "[]",
      '"string"',
      "null",
      '{"error":null}',
      '{"error":{"details":"nope"}}',
      '{"error":{"details":[null,42,"x"]}}',
      '{"error":{"details":[{"fieldViolations":"nope"}]}}',
      '{"error":{"details":[{"fieldViolations":[{"field":123}]}]}}',
    ]) {
      const result = extractProviderDiagnostics(apiError(400, body));
      expect(result.provider_field_violations).toBeUndefined();
    }
  });

  it("10. 既存の provider_status / provider_reason 抽出は変わらない", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: "quota",
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" },
        ],
      },
    });
    const result = extractProviderDiagnostics(apiError(429, body));
    expect(result.http_status).toBe(429);
    expect(result.provider_status).toBe("RESOURCE_EXHAUSTED");
    expect(result.provider_reason).toBe("RATE_LIMIT_EXCEEDED");
    expect(result.provider_field_violations).toBeUndefined();
  });

  it("11. fieldViolations[].description と error.message を戻り値へ含めない", () => {
    const description = "prompt に 関内 なむら の 045-305-6536 が含まれます";
    const err = apiError(
      400,
      JSON.stringify({
        error: {
          code: 400,
          message: "Invalid JSON payload received. Unknown name \"xyz\".",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [{ field: "contents", description }],
            },
          ],
        },
      }),
    );
    const serialized = JSON.stringify(extractProviderDiagnostics(err));
    expect(serialized).not.toContain(description);
    expect(serialized).not.toContain("Invalid JSON payload");
    expect(serialized).not.toContain("045-305-6536");
    expect(serialized).not.toContain("なむら");
    expect(serialized).toContain("contents");
  });

  it("12. @type の末尾トークンのみを provider_detail_types として抽出する", () => {
    const result = extractProviderDiagnostics(
      badRequest([{ field: "contents" }]),
    );
    expect(result.provider_detail_types).toEqual(["BadRequest"]);
    expect(JSON.stringify(result)).not.toContain("googleapis.com");
  });

  it("12b. 複数 detail type を dedupe し、安全でない @type は drop する", () => {
    const err = apiError(
      400,
      JSON.stringify({
        error: {
          status: "INVALID_ARGUMENT",
          details: [
            { "@type": "type.googleapis.com/google.rpc.BadRequest" },
            { "@type": "type.googleapis.com/google.rpc.BadRequest" },
            { "@type": "type.googleapis.com/google.rpc.ErrorInfo" },
            { "@type": "not a type name" },
            { "@type": 42 },
            {},
          ],
        },
      }),
    );
    expect(extractProviderDiagnostics(err).provider_detail_types).toEqual([
      "BadRequest",
      "ErrorInfo",
    ]);
  });
});

/**
 * Stage2 prompt の unpaired UTF-16 surrogate 検出(PR #180、Stage2 400 の候補B観測)。
 *
 * Stage2 prompt には Stage1 モデル生成テキスト(`[SOURCE] title:` / Search Note summary)が
 * そのまま入る。lone surrogate が含まれると `JSON.stringify` で `\udXXX` として送出され、
 * Google 側の JSON→proto transcode が invalid UTF-8 として `INVALID_ARGUMENT` を返しうる。
 *
 * **これは diagnostic 専用。** prompt の書き換え・sanitize・run の失敗化は一切行わない。
 */
describe("hasUnpairedSurrogate", () => {
  it("13. 通常のASCIIは false", () => {
    expect(hasUnpairedSurrogate("hello world 12345 https://example.com/a-b_c")).toBe(false);
  });

  it("14. 日本語は false", () => {
    expect(hasUnpairedSurrogate("関内 なむら 神奈川県横浜市中区 045-305-6536")).toBe(false);
  });

  it("15. 正常な emoji(surrogate pair)は false", () => {
    expect(hasUnpairedSurrogate("😀")).toBe(false);
    expect(hasUnpairedSurrogate("店舗 😀 レビュー 🍣")).toBe(false);
  });

  it("16. lone high surrogate は true", () => {
    expect(hasUnpairedSurrogate("\uD83D")).toBe(true);
    expect(hasUnpairedSurrogate("title: 食べログ\uD800")).toBe(true);
  });

  it("17. lone low surrogate は true", () => {
    expect(hasUnpairedSurrogate("\uDE00")).toBe(true);
    expect(hasUnpairedSurrogate("abc\uDC00def")).toBe(true);
  });

  it("18. high surrogate の直後が low surrogate でなければ true", () => {
    expect(hasUnpairedSurrogate("\uD83Dx")).toBe(true);
    expect(hasUnpairedSurrogate("\uD83D\uD83Dx")).toBe(true);
  });

  it("19. 正常なペアの直後にテキストが続いても false", () => {
    expect(hasUnpairedSurrogate("😀 と書かれていました")).toBe(false);
  });

  it("空文字は false / 巨大な正常文字列でも false", () => {
    expect(hasUnpairedSurrogate("")).toBe(false);
    expect(hasUnpairedSurrogate("あ".repeat(50_000))).toBe(false);
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

/**
 * `classifyProviderMessage` — provider の `error.message`(自由文)を
 * **閉じた語彙**へ分類する(PR #180、Stage2 400 INVALID_ARGUMENT の原因切り分け)。
 *
 * 監査で Gemini が Stage2 の 400 に `error.details[]` を返さないことが確定したため、
 * 原因を示す唯一の情報が自由文だけになった。自由文には prompt 断片・店舗名・住所・
 * URL・request ID が含まれうるので、**外へ出すのは固定トークンだけ**にする。
 */
describe("classifyProviderMessage (PR #180、閉じた語彙への分類)", () => {
  /** 実際の SDK と同じ形(`ApiError.message = JSON.stringify(errorBody)`)を作る。 */
  function providerError(message: string, status = 400): Error & { status: number } {
    return Object.assign(
      new Error(JSON.stringify({ error: { code: status, message, status: "INVALID_ARGUMENT" } })),
      { status },
    );
  }

  /** 実装が返しうる固定トークンの全集合。ここに無い値を返してはいけない。 */
  const ALLOWED_CLASSES = [
    "invalid_json_payload",
    "invalid_response_schema",
    "invalid_argument_generic",
    "url_context_error",
    "token_limit",
    "unsupported_combination",
    "unclassified",
  ] as const;

  describe("既知 pattern の分類", () => {
    it.each([
      [
        "invalid_json_payload",
        'Invalid JSON payload received. Unknown name "foo" at \'generation_config\'.',
      ],
      [
        "invalid_response_schema",
        "The provided response schema is invalid: expected object at root.",
      ],
      ["invalid_response_schema", "generation_config.response_json_schema is malformed."],
      ["invalid_response_schema", "Invalid value at 'generationConfig.responseJsonSchema'."],
      ["invalid_argument_generic", "Request contains an invalid argument."],
      ["url_context_error", "The url_context tool failed to process the supplied input."],
      ["url_context_error", "URL Context is not available for this request."],
      ["token_limit", "The input token count exceeds the maximum number of tokens allowed."],
      ["token_limit", "Request payload size exceeds the limit."],
      ["unsupported_combination", "Tool use with structured output is not supported."],
      ["unsupported_combination", "Google Search and grounding cannot be used together."],
    ])("%s に分類する", (expected, message) => {
      expect(classifyProviderMessage(providerError(message))).toBe(expected);
    });

    it("より具体的な対象(url_context / response schema)を汎用の外枠より優先する", () => {
      // Google の 400 は「汎用の外枠 + 具体的な対象」形になることがある。
      // 知りたいのは対象がどこかなので、具体的な側を採る。
      expect(
        classifyProviderMessage(
          providerError(
            'Invalid JSON payload received. Unknown name "x" at \'generation_config.response_json_schema\'.',
          ),
        ),
      ).toBe("invalid_response_schema");
    });
  });

  describe("未知 message は unclassified になる", () => {
    it.each([
      ["空文字", ""],
      ["未知の英文", "Something went terribly wrong on our side."],
      ["日本語", "予期しないエラーが発生しました。"],
      ["単に schema という語を含むだけの文", "The store schema drawing was rejected."],
    ])("%s → unclassified", (_label, message) => {
      expect(classifyProviderMessage(providerError(message))).toBe("unclassified");
    });
  });

  describe("到達できない場合は undefined(unclassified と区別する)", () => {
    it.each([
      ["Error でない(文字列)", "boom"],
      ["Error でない(null)", null],
      ["Error でない(object)", { message: "x" }],
    ])("%s → undefined", (_label, value) => {
      expect(classifyProviderMessage(value)).toBeUndefined();
    });

    it("message が JSON でない → undefined", () => {
      expect(classifyProviderMessage(new Error("not json at all"))).toBeUndefined();
    });

    it("JSON だが object でない → undefined", () => {
      expect(classifyProviderMessage(new Error('"just a string"'))).toBeUndefined();
      expect(classifyProviderMessage(new Error("123"))).toBeUndefined();
      expect(classifyProviderMessage(new Error("null"))).toBeUndefined();
    });

    it("error フィールドが無い / object でない → undefined", () => {
      expect(classifyProviderMessage(new Error(JSON.stringify({ code: 400 })))).toBeUndefined();
      expect(classifyProviderMessage(new Error(JSON.stringify({ error: "boom" })))).toBeUndefined();
      expect(classifyProviderMessage(new Error(JSON.stringify({ error: null })))).toBeUndefined();
    });

    it("error.message が string でない → undefined", () => {
      expect(
        classifyProviderMessage(new Error(JSON.stringify({ error: { message: 123 } }))),
      ).toBeUndefined();
      expect(
        classifyProviderMessage(new Error(JSON.stringify({ error: { code: 400 } }))),
      ).toBeUndefined();
    });
  });

  it("返り値は必ず固定トークン集合のいずれか", () => {
    const messages = [
      "Invalid JSON payload received.",
      "Request contains an invalid argument.",
      "url_context failed",
      "token count exceeded",
      "is not supported",
      "response schema invalid",
      "完全に未知のメッセージ",
    ];
    for (const m of messages) {
      expect(ALLOWED_CLASSES).toContain(classifyProviderMessage(providerError(m)));
    }
  });
});

/**
 * 漏洩テスト(PR #180)。provider の自由文に機微な値を意図的に混ぜても、
 * 返り値・`ProviderDiagnostics` を serialize したものに1文字も現れないことを固定する。
 */
describe("classifyProviderMessage / extractProviderDiagnostics の漏洩防止", () => {
  const SECRETS = [
    "https://example.com/secret/path?token=abc123",
    "炉端ジュン",
    "千葉県柏市旭町1-1-12",
    "04-7199-7985",
    "req-9f2c1d84-0000-4aaa-bbbb-1234567890ab",
    "AIzaSyD-fake-key-value-for-test-0000000",
  ] as const;

  const leakyMessage =
    `Invalid JSON payload received at ${SECRETS[0]} for store ${SECRETS[1]} ` +
    `(${SECRETS[2]}, tel ${SECRETS[3]}). request_id=${SECRETS[4]} key=${SECRETS[5]} ` +
    `prompt fragment: "あなたは店舗調査の専門アシスタントです"`;

  const leakyError = Object.assign(
    new Error(
      JSON.stringify({ error: { code: 400, message: leakyMessage, status: "INVALID_ARGUMENT" } }),
    ),
    { status: 400 },
  );

  it("classifyProviderMessage の返り値に機微な値が含まれない", () => {
    const result = classifyProviderMessage(leakyError);
    expect(result).toBe("invalid_json_payload");
    const serialized = JSON.stringify(result);
    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("ProviderDiagnostics を serialize しても機微な値が含まれない", () => {
    const diagnostics = extractProviderDiagnostics(leakyError);
    const serialized = JSON.stringify(diagnostics);
    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("あなたは店舗調査");
    expect(serialized).not.toContain("prompt fragment");
    // 出てよいのは既存の列挙トークンと固定分類のみ。
    expect(diagnostics.provider_status).toBe("INVALID_ARGUMENT");
    expect(diagnostics.provider_message_class).toBe("invalid_json_payload");
  });

  it("ProviderDiagnostics のキー集合が想定どおり(未知フィールドを増やしていない)", () => {
    const diagnostics = extractProviderDiagnostics(leakyError);
    for (const key of Object.keys(diagnostics)) {
      expect([
        "http_status",
        "provider_status",
        "provider_reason",
        "provider_field_violations",
        "provider_detail_types",
        "provider_message_class",
      ]).toContain(key);
    }
  });

  it("details が無くても provider_message_class だけは残る(実機 Stage2 400 の形)", () => {
    const diagnostics = extractProviderDiagnostics(leakyError);
    expect(diagnostics.provider_field_violations).toBeUndefined();
    expect(diagnostics.provider_detail_types).toBeUndefined();
    expect(diagnostics.provider_message_class).toBe("invalid_json_payload");
  });

  it("分類できない場合は provider_message_class をキーごと出さない", () => {
    const nonJson = Object.assign(new Error("plain text error"), { status: 400 });
    const diagnostics = extractProviderDiagnostics(nonJson);
    expect("provider_message_class" in diagnostics).toBe(false);
  });
});

/**
 * `hasControlChars` — C0 制御文字 / U+2028 / U+2029 の有無だけを boolean で返す
 * (PR #180)。`hasUnpairedSurrogate` と同じく診断専用で、入力を変更しない。
 */
describe("hasControlChars (PR #180、診断専用)", () => {
  it("通常の日本語・英数字・記号は false", () => {
    expect(hasControlChars("店舗名 ABC 123 -_/:?#[]@!$&'()*+,;=")).toBe(false);
  });

  it("tab / newline / carriage return は正当な整形文字なので false", () => {
    expect(hasControlChars("a\tb\nc\r\nd")).toBe(false);
  });

  it.each([
    ["NUL (U+0000)", "a\u0000b"],
    ["U+0001", "a\u0001b"],
    ["BS (U+0008)", "a\u0008b"],
    ["VT (U+000B)", "a\u000Bb"],
    ["FF (U+000C)", "a\u000Cb"],
    ["U+000E", "a\u000Eb"],
    ["US (U+001F)", "a\u001Fb"],
    ["LINE SEPARATOR (U+2028)", "a\u2028b"],
    ["PARAGRAPH SEPARATOR (U+2029)", "a\u2029b"],
  ])("%s は true", (_label, text) => {
    expect(hasControlChars(text)).toBe(true);
  });

  it("空文字は false", () => {
    expect(hasControlChars("")).toBe(false);
  });

  it("入力文字列を変更しない(純関数)", () => {
    const input = "a\u0000b";
    const before = input;
    hasControlChars(input);
    expect(input).toBe(before);
  });

  it("絵文字・サロゲートペアを制御文字と誤判定しない", () => {
    expect(hasControlChars("🍣寿司")).toBe(false);
  });
});
