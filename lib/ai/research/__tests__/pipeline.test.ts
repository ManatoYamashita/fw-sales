/**
 * パイプラインオーケストレーションの単体検証(AI 店舗調査再設計 Plan v3.2 §8, PR2、
 * fix/ai-research-poc-like-retrieval で Stage2 統合に合わせ更新)。
 *
 * `./client` をモックし、実 API を一切呼ばない。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockRunSourceDiscovery, mockRunStructuredUrlContext } = vi.hoisted(() => ({
  mockRunSourceDiscovery: vi.fn(),
  mockRunStructuredUrlContext: vi.fn(),
}));

vi.mock("../client", () => ({
  createResearchGeminiClient: () => ({
    runSourceDiscovery: mockRunSourceDiscovery,
    runStructuredUrlContext: mockRunStructuredUrlContext,
  }),
}));

const {
  runStage1,
  runStage2,
  buildNonAiItems,
  applyUrlContextStatus,
  finalizeResearchItems,
} = await import("../pipeline");

const STORE = { name: "YELLOW PIZZA", address: "神奈川県横浜市港北区菊名1-7-2", phone: "045-642-7213", genre: "イタリアン" };

beforeEach(() => {
  mockRunSourceDiscovery.mockReset();
  mockRunStructuredUrlContext.mockReset();
});

describe("runStage1", () => {
  it("Source Discoveryを実行しSource Registryを構築する(diagnosticsも伝播)", async () => {
    mockRunSourceDiscovery.mockResolvedValue({
      text: `[SOURCE]\nurl: https://vertexaisearch.cloud.google.com/grounding-api-redirect/x\ntitle: 公式\ntype: official_site\nwhy_useful: y\n[/SOURCE]`,
      groundingMetadata: null,
      usageMetadata: { totalTokenCount: 100 },
      searchCallCount: 2,
      searchQueryCount: 5,
    });

    const result = await runStage1(STORE, AbortSignal.timeout(1000));

    // groundingMetadataがnullでも[SOURCE]候補からSource Registryが構築される(中核変更)。
    expect(result.sourceRegistry).toHaveLength(1);
    expect(result.sourceRegistry[0]!.id).toBe("S01");
    expect(result.sourceRegistry[0]!.discovery_provenance).toBe("gemini_search_candidate");
    expect(result.usageMetadata?.totalTokenCount).toBe(100);
    expect(result.searchCallCount).toBe(2);
    expect(result.searchQueryCount).toBe(5);
  });

  it("groundingMetadataも候補も無ければ空のSource Registryを返す(例外を投げない)", async () => {
    mockRunSourceDiscovery.mockResolvedValue({
      text: "何も見つかりませんでした",
      groundingMetadata: null,
      usageMetadata: null,
      searchCallCount: 1,
      searchQueryCount: 3,
    });

    const result = await runStage1(STORE, AbortSignal.timeout(1000));
    expect(result.sourceRegistry).toEqual([]);
    expect(result.searchCallCount).toBe(1);
  });
});

describe("runStage2 (統合、FACT+FACT_OR_HEARING+ANALYSISを1回で扱う)", () => {
  const REGISTRY = [
    {
      id: "S01",
      title: "x",
      grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "official_site" as const,
      discovery_provenance: "google_grounding" as const,
      url_context_status: "not_attempted" as const,
    },
  ];

  it("正常なJSON応答をパース・検証してitemsを返す", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
        items: [
          {
            key: "business_hours_holidays",
            research_policy: "FACT",
            status: "confirmed",
            value: "17:00-24:00",
            evidence: "e",
            source_ids: ["S01"],
          },
        ],
      }),
      urlContextMetadata: { urlMetadata: [] },
      usageMetadata: { totalTokenCount: 500 },
    });

    const result = await runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000));

    expect(result.parseWarning).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.key).toBe("business_hours_holidays");
  });

  it("1回のAPI呼出でFACT/FACT_OR_HEARING/ANALYSIS全キーを許可する", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
        items: [],
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000));

    expect(mockRunStructuredUrlContext).toHaveBeenCalledTimes(1);
  });

  it("不正なJSON文字列はparseWarningを返し、例外を投げない(partial failure耐性)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: "{ this is not valid json",
      urlContextMetadata: null,
      usageMetadata: null,
    });

    const result = await runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000));

    expect(result.parseWarning).toContain("JSON");
    expect(result.items).toEqual([]);
  });

  it("スキーマ不一致(不正なsource_id等)もparseWarningを返す", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
        items: [
          {
            key: "business_hours_holidays",
            research_policy: "FACT",
            status: "confirmed",
            value: "v",
            evidence: "e",
            source_ids: ["S99"], // registryに存在しない
          },
        ],
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    const result = await runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000));

    expect(result.parseWarning).not.toBeNull();
  });

  it("clientがmax_tokensエラーを投げた場合はparseWarningへ握りつぶさず、そのまま伝播する(fix/ai-research-stage2-max-tokens)", async () => {
    mockRunStructuredUrlContext.mockRejectedValue({ kind: "max_tokens" });

    await expect(
      runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: "max_tokens" });
  });

  it("sourceRegistryが空でもAPI呼出自体は行う(Source Registry空時の案内はprompts.tsが担当)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
        items: [],
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    const result = await runStage2({ store: STORE, sourceRegistry: [] }, AbortSignal.timeout(1000));

    expect(mockRunStructuredUrlContext).toHaveBeenCalled();
    expect(result.parseWarning).toBeNull();
    expect(result.items).toEqual([]);
  });
});

describe("buildNonAiItems", () => {
  it("HEARING_ONLY/EXTERNAL_DATA_REQUIRED項目をAPI呼出無しで生成する", () => {
    const items = buildNonAiItems();
    // Plan v3.2 §7 集計: HEARING_ONLY=10, EXTERNAL_DATA_REQUIRED=1
    expect(items).toHaveLength(11);
    for (const item of items) {
      expect(item.source_ids).toEqual([]);
      expect(["hearing_required", "external_data_required"]).toContain(item.status);
    }
  });

  it("search_volumeはexternal_data_requiredになる", () => {
    const items = buildNonAiItems();
    const searchVolume = items.find((i) => i.key === "search_volume");
    expect(searchVolume?.status).toBe("external_data_required");
  });

  it("revenueはhearing_requiredになる", () => {
    const items = buildNonAiItems();
    const revenue = items.find((i) => i.key === "revenue");
    expect(revenue?.status).toBe("hearing_required");
  });
});

describe("applyUrlContextStatus", () => {
  const baseRegistry = [
    {
      id: "S01",
      title: "x",
      grounding_redirect_url: "https://example.com/a",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "other" as const,
      discovery_provenance: "google_grounding" as const,
      url_context_status: "not_attempted" as const,
    },
  ];

  it("成功したURLのstatusをsuccessに更新する", () => {
    const result = applyUrlContextStatus(baseRegistry, [
      { urlMetadata: [{ retrievedUrl: "https://example.com/a", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] },
    ]);
    expect(result[0]!.url_context_status).toBe("success");
  });

  it("失敗したURLのstatusをerrorに更新する", () => {
    const result = applyUrlContextStatus(baseRegistry, [
      { urlMetadata: [{ retrievedUrl: "https://example.com/a", status: "URL_RETRIEVAL_STATUS_ERROR" }] },
    ]);
    expect(result[0]!.url_context_status).toBe("error");
  });

  it("複数stageのうち1つでも成功していればsuccessを優先する", () => {
    const result = applyUrlContextStatus(baseRegistry, [
      { urlMetadata: [{ retrievedUrl: "https://example.com/a", status: "URL_RETRIEVAL_STATUS_ERROR" }] },
      { urlMetadata: [{ retrievedUrl: "https://example.com/a", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] },
    ]);
    expect(result[0]!.url_context_status).toBe("success");
  });

  it("参照されなかったエントリはnot_attemptedのまま", () => {
    const result = applyUrlContextStatus(baseRegistry, [{ urlMetadata: [] }]);
    expect(result[0]!.url_context_status).toBe("not_attempted");
  });

  it("nullのurlContextMetadataは無視する", () => {
    const result = applyUrlContextStatus(baseRegistry, [null]);
    expect(result[0]!.url_context_status).toBe("not_attempted");
  });
});

describe("finalizeResearchItems", () => {
  it("AI項目(統合)/HEARING項目を統合しdeterministic validationを適用する", () => {
    const aiItems = [
      {
        key: "business_hours_holidays",
        research_policy: "FACT" as const,
        status: "confirmed" as const,
        value: "v",
        evidence: "e",
        source_ids: ["S01"],
      },
    ];
    const registry = [
      {
        id: "S01",
        title: "x",
        grounding_redirect_url: "https://example.com/a",
        resolved_url: null,
        resolve_status: "skipped" as const,
        source_type: "other" as const,
        discovery_provenance: "google_grounding" as const,
        url_context_status: "success" as const,
      },
    ];

    const result = finalizeResearchItems({
      aiItems,
      nonAiItems: buildNonAiItems(),
      sourceRegistry: registry,
    });

    // AI項目1件(検証済みsourceあり) + 11件のHEARING系
    expect(result).toHaveLength(12);
    const businessHours = result.find((i) => i.key === "business_hours_holidays");
    expect(businessHours?.status).toBe("confirmed");
  });

  it("url_context_status成功が無いconfirmed項目は既存ルールに従い降格する(gemini_search_candidateも同様)", () => {
    const aiItems = [
      {
        key: "market_demand",
        research_policy: "ANALYSIS" as const,
        status: "confirmed" as const,
        value: "v",
        evidence: "e",
        source_ids: ["S01"],
      },
    ];
    const registry = [
      {
        id: "S01",
        title: "x",
        grounding_redirect_url: "https://example.com/a",
        resolved_url: null,
        resolve_status: "skipped" as const,
        source_type: "other" as const,
        discovery_provenance: "gemini_search_candidate" as const,
        url_context_status: "not_attempted" as const, // 取得できていない
      },
    ];

    const result = finalizeResearchItems({
      aiItems,
      nonAiItems: [],
      sourceRegistry: registry,
    });

    const marketDemand = result.find((i) => i.key === "market_demand");
    expect(marketDemand?.status).toBe("inferred"); // ANALYSISの降格先
  });
});
