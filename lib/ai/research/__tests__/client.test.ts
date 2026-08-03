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

  it("既定のRESEARCH_MAX_OUTPUT_TOKENSは16384(実機smoke testで8192上限到達を確認、fix/ai-research-stage2-max-tokens)", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "{}",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {},
    });

    await createResearchGeminiClient().runStructuredUrlContext(
      { prompt: "p", jsonSchema: JSON_SCHEMA },
      AbortSignal.timeout(1000),
    );

    expect(lastCallArgs().config.maxOutputTokens).toBe(16384);
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
