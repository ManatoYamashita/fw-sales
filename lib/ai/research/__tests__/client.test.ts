/**
 * `lib/ai/research/client.ts` のユニットテスト(AI 店舗調査再設計 Plan v3.2 §8, PR2)。
 *
 * `lib/ai/__tests__/client.test.ts` と同じ class mock パターンを踏襲する。
 * **実 API を一切呼ばない。**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  return { GoogleGenAI: MockGoogleGenAI, FinishReason: { STOP: "STOP", MAX_TOKENS: "MAX_TOKENS" } };
});

const { createResearchGeminiClient } = await import("../client");
const { isAiClientError } = await import("@/lib/ai/client");

const ENV_KEYS = ["GEMINI_API_KEY", "RESEARCH_GEMINI_MODEL", "GEMINI_MODEL"] as const;
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

function lastCallArgs(): { model: string; config: Record<string, unknown> } {
  const call = mockGenerateContent.mock.calls.at(-1);
  if (!call) throw new Error("generateContent が呼ばれていない");
  return call[0];
}

describe("runSourceDiscovery (Stage1)", () => {
  it("googleSearchツールのみを設定する(Structured Outputは使わない)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "[QUERY]test[/QUERY]",
      candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 20 },
    });

    await createResearchGeminiClient().runSourceDiscovery(
      "テストプロンプト",
      AbortSignal.timeout(1000),
    );

    const { config } = lastCallArgs();
    expect(config.tools).toEqual([{ googleSearch: {} }]);
    expect(config.responseMimeType).toBeUndefined();
    expect(config.responseJsonSchema).toBeUndefined();
  });

  it("診断情報取得のためtoolConfig.includeServerSideToolInvocationsを有効化する(fix/ai-research-poc-like-retrieval)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "[QUERY]test[/QUERY]",
      candidates: [{}],
      usageMetadata: {},
    });

    await createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000));

    const { config } = lastCallArgs();
    expect(config.toolConfig).toEqual({ includeServerSideToolInvocations: true });
  });

  it("groundingMetadataとusageMetadataを抽出して返す", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "discovery text",
      candidates: [
        { groundingMetadata: { groundingChunks: [{ web: { uri: "https://x", title: "x" } }] } },
      ],
      usageMetadata: { promptTokenCount: 100, totalTokenCount: 200 },
    });

    const result = await createResearchGeminiClient().runSourceDiscovery(
      "p",
      AbortSignal.timeout(1000),
    );

    expect(result.text).toBe("discovery text");
    expect(result.groundingMetadata?.groundingChunks).toHaveLength(1);
    expect(result.usageMetadata?.promptTokenCount).toBe(100);
  });

  it("groundingMetadataが無い場合はnullを返す(Spike 0.2で実証済みの実機挙動、Stage1を失敗扱いにしない)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "discovery text",
      candidates: [{}],
      usageMetadata: null,
    });

    const result = await createResearchGeminiClient().runSourceDiscovery(
      "p",
      AbortSignal.timeout(1000),
    );

    expect(result.groundingMetadata).toBeNull();
    expect(result.usageMetadata).toBeNull();
  });

  it("server-side tool invocation partsからsearchCallCount/searchQueryCountを抽出する", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "discovery text",
      candidates: [
        {
          content: {
            parts: [
              { toolCall: { toolType: "GOOGLE_SEARCH_WEB", args: { queries: ["a", "b", "c"] } } },
              { toolResponse: {} },
              { toolCall: { toolType: "GOOGLE_SEARCH_WEB", args: { queries: ["d"] } } },
              { toolResponse: {} },
              { text: "自由記述テキスト" },
            ],
          },
        },
      ],
      usageMetadata: {},
    });

    const result = await createResearchGeminiClient().runSourceDiscovery(
      "p",
      AbortSignal.timeout(1000),
    );

    expect(result.searchCallCount).toBe(2);
    expect(result.searchQueryCount).toBe(4);
  });

  it("toolCallが無い場合はsearchCallCount/searchQueryCountとも0になる", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "discovery text",
      candidates: [{ content: { parts: [{ text: "自由記述のみ" }] } }],
      usageMetadata: {},
    });

    const result = await createResearchGeminiClient().runSourceDiscovery(
      "p",
      AbortSignal.timeout(1000),
    );

    expect(result.searchCallCount).toBe(0);
    expect(result.searchQueryCount).toBe(0);
  });

  /**
   * 食べログ検索の実行有無 observability(PR #180 final smoke hardening、BLOCKER 1)。
   *
   * ## 取得元(重要)
   *
   * Stage1 モデル出力の `[QUERY]` 自己申告**ではなく**、
   * `toolConfig.includeServerSideToolInvocations` により応答に含まれる
   * **実際の server-side tool invocation の `toolCall.args.queries`** から判定する。
   * `[QUERY]` はモデルが「実行したつもり」を書くだけで、実行の証拠にならない。
   *
   * ## privacy
   *
   * raw query 文字列は boolean 化した時点で破棄し、`Stage1CallResult` にも
   * DB diagnostics にも log にも残さない(既存の searchCallCount/searchQueryCount と同方針)。
   */
  describe("tabelogSearchAttempted (BLOCKER 1 observability)", () => {
    const withQueries = (...calls: string[][]) => ({
      text: "discovery text",
      candidates: [
        {
          content: {
            parts: calls.map((queries) => ({
              toolCall: { toolType: "GOOGLE_SEARCH_WEB", args: { queries } },
            })),
          },
        },
      ],
      usageMetadata: {},
    });

    const run = async () =>
      createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000));

    it("1. 実際の toolCall query に「食べログ」が含まれれば true", async () => {
      mockGenerateContent.mockResolvedValue(withQueries(["関内 なむら 食べログ"]));
      expect((await run()).tabelogSearchAttempted).toBe(true);
    });

    it("2. site:tabelog.com 形式でも true", async () => {
      mockGenerateContent.mockResolvedValue(withQueries(["site:tabelog.com 関内 なむら"]));
      expect((await run()).tabelogSearchAttempted).toBe(true);
    });

    it("大文字混じりのドメイン表記も正規化して true", async () => {
      mockGenerateContent.mockResolvedValue(withQueries(["site:Tabelog.COM 関内 なむら"]));
      expect((await run()).tabelogSearchAttempted).toBe(true);
    });

    it("3. Retty / 電話番号検索だけなら false", async () => {
      mockGenerateContent.mockResolvedValue(
        withQueries(["関内 なむら Retty", "関内 なむら 電話番号", "045-305-6536"]),
      );
      expect((await run()).tabelogSearchAttempted).toBe(false);
    });

    it("4. toolCall が無ければ false", async () => {
      mockGenerateContent.mockResolvedValue({
        text: "discovery text",
        candidates: [{ content: { parts: [{ text: "自由記述のみ" }] } }],
        usageMetadata: {},
      });
      expect((await run()).tabelogSearchAttempted).toBe(false);
    });

    it("[QUERY]自己申告だけでは true にしない(取得元は server-side tool invocation)", async () => {
      mockGenerateContent.mockResolvedValue({
        text: "[QUERY]関内 なむら 食べログ[/QUERY]",
        candidates: [{ content: { parts: [{ toolCall: { args: { queries: ["関内 なむら"] } } }] } }],
        usageMetadata: {},
      });
      expect((await run()).tabelogSearchAttempted).toBe(false);
    });

    it("5. 複数 tool call のうち1件だけ食べログでも true", async () => {
      mockGenerateContent.mockResolvedValue(
        withQueries(["関内 なむら 口コミ", "関内 なむら 席数"], ["関内 なむら 食べログ"]),
      );
      expect((await run()).tabelogSearchAttempted).toBe(true);
    });

    it("6. raw query 文字列を Stage1CallResult へ持ち出さない", async () => {
      const rawQuery = "関内 なむら 食べログ 予約";
      mockGenerateContent.mockResolvedValue(withQueries([rawQuery]));
      const result = await run();

      expect(result.tabelogSearchAttempted).toBe(true);
      expect(JSON.stringify(result)).not.toContain(rawQuery);
      expect(JSON.stringify(result)).not.toContain("食べログ");
    });

    it("6b. raw query を console へ出力しない", async () => {
      const rawQuery = "関内 なむら 食べログ 予約";
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        mockGenerateContent.mockResolvedValue(withQueries([rawQuery]));
        await run();
        for (const spy of [logSpy, infoSpy, warnSpy, errorSpy]) {
          const emitted = JSON.stringify(spy.mock.calls);
          expect(emitted).not.toContain(rawQuery);
          expect(emitted).not.toContain("食べログ");
        }
      } finally {
        for (const spy of [logSpy, infoSpy, warnSpy, errorSpy]) spy.mockRestore();
      }
    });

    it("7. searchCallCount / searchQueryCount の既存挙動を壊さない", async () => {
      mockGenerateContent.mockResolvedValue(
        withQueries(["関内 なむら 食べログ", "関内 なむら 口コミ"], ["関内 なむら 席数"]),
      );
      const result = await run();
      expect(result.searchCallCount).toBe(2);
      expect(result.searchQueryCount).toBe(3);
      expect(result.tabelogSearchAttempted).toBe(true);
    });

    it("queries が配列でない tool call を安全に無視する", async () => {
      mockGenerateContent.mockResolvedValue({
        text: "discovery text",
        candidates: [
          {
            content: {
              parts: [
                { toolCall: { args: { queries: "食べログ" } } },
                { toolCall: { args: { queries: [123, null, "関内 なむら 食べログ"] } } },
              ],
            },
          },
        ],
        usageMetadata: {},
      });
      const result = await run();
      expect(result.searchCallCount).toBe(2);
      // 文字列以外は数えず、文字列の中身だけで判定する。
      expect(result.searchQueryCount).toBe(3);
      expect(result.tabelogSearchAttempted).toBe(true);
    });
  });

  it("応答が空ならunknownエラーを投げる", async () => {
    mockGenerateContent.mockResolvedValue({ text: "", candidates: [{}] });

    await expect(
      createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("APIキー未設定ならmissing_api_keyを投げる(API呼出前に検知)", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: "missing_api_key" });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("SDKエラーはAiClientErrorへ正規化される(生メッセージを上位へ漏らさない)", async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error("some internal detail with api key abc123"), { status: 429 }),
    );

    try {
      await createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000));
      expect.fail("should have thrown");
    } catch (err) {
      expect(isAiClientError(err)).toBe(true);
      expect(JSON.stringify(err)).not.toContain("abc123");
    }
  });
});

/**
 * runtime reliability hardening (F3/F4)。
 *
 * 従来 `lib/ai/` と `workflows/` には `console.*` が 1 つも無く、Gemini 呼出が
 * どの HTTP status / provider reason で落ちたかは Vercel logs に一切残らなかった
 * (2026-08 の billing 障害では Supabase を直接開いて `store_research_runs` を
 * 見るしか診断手段がなかった)。
 *
 * ログへ出してよいのは sanitized scalar のみ。元 Error オブジェクト・raw message・
 * API key・request ID・レスポンス本文は渡さない。
 */
describe("Gemini呼出失敗のsanitized structured log", () => {
  const RESOURCE_EXHAUSTED_BODY = JSON.stringify({
    error: {
      code: 429,
      message: "Resource has been exhausted. key=AIzaSyFAKEKEY123 requestId=8f3c1d2e-aaaa",
      status: "RESOURCE_EXHAUSTED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" }],
    },
  });

  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("Stage1の失敗をstage/kind/http_status/provider_status/provider_reason付きで記録する", async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error(RESOURCE_EXHAUSTED_BODY), { status: 429 }),
    );

    await expect(
      createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: "rate_limit" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, fields] = errorSpy.mock.calls[0]!;
    expect(message).toBe("[research.gemini] call failed");
    expect(fields).toEqual({
      stage: "stage1",
      kind: "rate_limit",
      http_status: 429,
      provider_status: "RESOURCE_EXHAUSTED",
      provider_reason: "RATE_LIMIT_EXCEEDED",
    });
  });

  it("Stage2の失敗はstage=stage2として記録する", async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 503 }),
    );

    await expect(
      createResearchGeminiClient().runStructuredUrlContext(
        { prompt: "p", jsonSchema: { type: "object" } },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ kind: "api_error", status: 503 });

    const [, fields] = errorSpy.mock.calls[0]!;
    expect(fields).toMatchObject({ stage: "stage2", kind: "api_error", http_status: 503 });
  });

  it("元Errorオブジェクト・raw message・API key・request IDをログへ渡さない", async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error(RESOURCE_EXHAUSTED_BODY), { status: 429 }),
    );

    await createResearchGeminiClient()
      .runSourceDiscovery("p", AbortSignal.timeout(1000))
      .catch(() => {});

    // 引数は「文言」と「sanitized fieldsオブジェクト」の2つだけ。Errorを渡さない。
    expect(errorSpy.mock.calls[0]).toHaveLength(2);
    const serialized = JSON.stringify(errorSpy.mock.calls[0]);
    expect(serialized).not.toContain("AIzaSyFAKEKEY123");
    expect(serialized).not.toContain("8f3c1d2e");
    expect(serialized).not.toContain("Resource has been exhausted");
    for (const arg of errorSpy.mock.calls[0]!) {
      expect(arg).not.toBeInstanceOf(Error);
    }
  });

  it("ログ追加後もthrowされるAiClientErrorのkindは変わらない", async () => {
    mockGenerateContent.mockRejectedValue(
      Object.assign(new Error("unauthorized"), { status: 401 }),
    );

    await expect(
      createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: "auth_error" });
  });

  it("APIキー未設定(API呼出前の失敗)ではログを出さない", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      createResearchGeminiClient().runSourceDiscovery("p", AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: "missing_api_key" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("runStructuredUrlContext (Stage2)", () => {
  const JSON_SCHEMA = { type: "object", properties: {} };

  it("urlContextツールのみを設定する(Google Searchは使わない)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"items":[]}',
      candidates: [{ urlContextMetadata: { urlMetadata: [] } }],
      usageMetadata: {},
    });

    await createResearchGeminiClient().runStructuredUrlContext(
      { prompt: "p", jsonSchema: JSON_SCHEMA },
      AbortSignal.timeout(1000),
    );

    const { config } = lastCallArgs();
    expect(config.tools).toEqual([{ urlContext: {} }]);
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toBe(JSON_SCHEMA);
  });

  it("urlContextMetadataを抽出して返す", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"items":[]}',
      candidates: [
        {
          urlContextMetadata: {
            urlMetadata: [
              { retrievedUrl: "https://x", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
            ],
          },
        },
      ],
      usageMetadata: { totalTokenCount: 500 },
    });

    const result = await createResearchGeminiClient().runStructuredUrlContext(
      { prompt: "p", jsonSchema: JSON_SCHEMA },
      AbortSignal.timeout(1000),
    );

    expect(result.rawText).toBe('{"items":[]}');
    expect(result.urlContextMetadata?.urlMetadata[0]).toEqual({
      retrievedUrl: "https://x",
      status: "URL_RETRIEVAL_STATUS_SUCCESS",
    });
    expect(result.usageMetadata?.totalTokenCount).toBe(500);
  });

  it("RESEARCH_GEMINI_MODELでモデルを上書きできる", async () => {
    process.env.RESEARCH_GEMINI_MODEL = "gemini-research-preview";
    mockGenerateContent.mockResolvedValue({
      text: "{}",
      candidates: [{}],
      usageMetadata: {},
    });

    await createResearchGeminiClient().runStructuredUrlContext(
      { prompt: "p", jsonSchema: JSON_SCHEMA },
      AbortSignal.timeout(1000),
    );

    expect(lastCallArgs().model).toBe("gemini-research-preview");
  });

  it("応答が空ならunknownエラーを投げる", async () => {
    mockGenerateContent.mockResolvedValue({ text: "", candidates: [{}] });

    await expect(
      createResearchGeminiClient().runStructuredUrlContext(
        { prompt: "p", jsonSchema: JSON_SCHEMA },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("finishReason=MAX_TOKENSならmax_tokensエラーを投げる(partial JSONをJSON.parseへ渡さない、fix/ai-research-stage2-max-tokens)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"items": [{"key": "business_hours_holidays", "status": "confirmed"', // 打ち切られた不完全なJSON
      candidates: [{ finishReason: "MAX_TOKENS", urlContextMetadata: { urlMetadata: [] } }],
      usageMetadata: { totalTokenCount: 16384, thoughtsTokenCount: 14000, candidatesTokenCount: 2000 },
    });

    await expect(
      createResearchGeminiClient().runStructuredUrlContext(
        { prompt: "p", jsonSchema: JSON_SCHEMA },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ kind: "max_tokens" });
  });

  it("finishReason=STOPなら通常どおり処理を続行する(MAX_TOKENS誤検出しない)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"items":[]}',
      candidates: [{ finishReason: "STOP", urlContextMetadata: { urlMetadata: [] } }],
      usageMetadata: {},
    });

    const result = await createResearchGeminiClient().runStructuredUrlContext(
      { prompt: "p", jsonSchema: JSON_SCHEMA },
      AbortSignal.timeout(1000),
    );

    expect(result.rawText).toBe('{"items":[]}');
  });

  it("既定のRESEARCH_MAX_OUTPUT_TOKENSは24576(feat/ai-research-quality-ux-hardening: 16384では成功runが上限の81.7%を消費していた実測に基づく引き上げ)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "{}",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {},
    });

    await createResearchGeminiClient().runStructuredUrlContext(
      { prompt: "p", jsonSchema: JSON_SCHEMA },
      AbortSignal.timeout(1000),
    );

    expect(lastCallArgs().config.maxOutputTokens).toBe(24576);
  });

  it("RESEARCH_MAX_OUTPUT_TOKENS環境変数で上書きできる", async () => {
    process.env.RESEARCH_MAX_OUTPUT_TOKENS = "20000";
    mockGenerateContent.mockResolvedValue({
      text: "{}",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {},
    });

    await createResearchGeminiClient().runStructuredUrlContext(
      { prompt: "p", jsonSchema: JSON_SCHEMA },
      AbortSignal.timeout(1000),
    );

    expect(lastCallArgs().config.maxOutputTokens).toBe(20000);
    delete process.env.RESEARCH_MAX_OUTPUT_TOKENS;
  });
});

/**
 * MAX_TOKENS observability(feat/ai-research-quality-ux-hardening、Plan §11 / Theme 5B)。
 *
 * 実機の MAX_TOKENS run では `token_usage = null` だった。原因は
 * `response.usageMetadata` を読まずに throw していたため。この時点では usage は
 * スコープ内に存在しており、**数値だけを** sanitized に取り出せる。
 */
describe("MAX_TOKENS時のusage observability (Theme 5B)", () => {
  const JSON_SCHEMA = { type: "object", properties: {} };
  const USAGE = {
    promptTokenCount: 5344,
    candidatesTokenCount: 6177,
    toolUsePromptTokenCount: 83456,
    thoughtsTokenCount: 18500,
    totalTokenCount: 113477,
  };

  function mockMaxTokens() {
    mockGenerateContent.mockResolvedValue({
      text: '{"items": [{"key": "business_hours_holidays"',
      candidates: [{ finishReason: "MAX_TOKENS", urlContextMetadata: { urlMetadata: [] } }],
      usageMetadata: USAGE,
    });
  }

  it("AiClientError(max_tokens)にusageを載せてworkflowまで運ぶ", async () => {
    mockMaxTokens();
    await expect(
      createResearchGeminiClient().runStructuredUrlContext(
        { prompt: "p", jsonSchema: JSON_SCHEMA },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({
      kind: "max_tokens",
      usage: {
        promptTokenCount: 5344,
        candidatesTokenCount: 6177,
        thoughtsTokenCount: 18500,
        toolUsePromptTokenCount: 83456,
        totalTokenCount: 113477,
      },
    });
  });

  it("configured_max_output_tokensを含むstructured logを出す", async () => {
    mockMaxTokens();
    process.env.RESEARCH_MAX_OUTPUT_TOKENS = "24576";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await createResearchGeminiClient()
        .runStructuredUrlContext({ prompt: "p", jsonSchema: JSON_SCHEMA }, AbortSignal.timeout(1000))
        .catch(() => {});
      const call = spy.mock.calls.find((c) => c[0] === "[research.gemini] max_tokens");
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        stage: "stage2",
        configured_max_output_tokens: 24576,
        thoughts_token_count: 18500,
        candidates_token_count: 6177,
        prompt_token_count: 5344,
        tool_use_prompt_token_count: 83456,
        total_token_count: 113477,
      });
    } finally {
      spy.mockRestore();
      delete process.env.RESEARCH_MAX_OUTPUT_TOKENS;
    }
  });

  it("ログに raw response / prompt / candidate text を一切含めない", async () => {
    mockMaxTokens();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await createResearchGeminiClient()
        .runStructuredUrlContext(
          { prompt: "SECRET_PROMPT_TEXT", jsonSchema: JSON_SCHEMA },
          AbortSignal.timeout(1000),
        )
        .catch(() => {});
      const serialized = JSON.stringify(spy.mock.calls);
      expect(serialized).not.toContain("SECRET_PROMPT_TEXT");
      expect(serialized).not.toContain("business_hours_holidays");
      expect(serialized).not.toContain("test-key");
    } finally {
      spy.mockRestore();
    }
  });

  it("usageMetadataが取得できない場合もthrow自体は従来どおり動く", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "{",
      candidates: [{ finishReason: "MAX_TOKENS", urlContextMetadata: { urlMetadata: [] } }],
      usageMetadata: undefined,
    });
    await expect(
      createResearchGeminiClient().runStructuredUrlContext(
        { prompt: "p", jsonSchema: JSON_SCHEMA },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ kind: "max_tokens" });
  });
});
