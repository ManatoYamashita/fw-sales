/**
 * パイプラインオーケストレーションの単体検証(AI 店舗調査再設計 Plan v3.2 §8, PR2、
 * fix/ai-research-poc-like-retrieval で Stage2 統合に合わせ更新)。
 *
 * `./client` をモックし、実 API を一切呼ばない。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SourceRegistryEntry } from "@/types/research-run";

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
  buildDeterministicPlacesItems,
  deriveDeterministicPlacesConfirmedKeys,
  applyUrlContextStatus,
  applySourceIdentityVerification,
  appendConfirmedMediaContext,
  upgradeMediaCoverageFromRegistry,
  finalizeResearchItems,
} = await import("../pipeline");
const { selectAiResearchItems } = await import("../prompts");
const { RESEARCH_POLICY_ITEMS } = await import("@/lib/domain/research-policy");

const STORE = { name: "YELLOW PIZZA", address: "神奈川県横浜市港北区菊名1-7-2", phone: "045-642-7213", genre: "イタリアン" };

/**
 * `runStage2`のcoverage検証(feat/ai-research-pre-smoke-hardening、BLOCKER1)は
 * items件数・key集合がそのrunのallowedKeysと厳密に一致することを要求する。
 * テストのモック応答を、実際に使われるallowedKeysに合わせて機械的に生成するヘルパー。
 */
function fullItemsForAllowedKeys(excludeKeys?: Set<string>) {
  return selectAiResearchItems(RESEARCH_POLICY_ITEMS, excludeKeys).map((i) => ({
    key: i.key,
    research_policy: "FACT",
    status: "not_found",
    value: null,
    evidence: "e",
    source_ids: [],
  }));
}

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

  it("[SEARCH_NOTE]ブロックをsearchNotesとして返す(feat/ai-research-source-diversity)", async () => {
    mockRunSourceDiscovery.mockResolvedValue({
      text: `[SOURCE]\nurl: https://vertexaisearch.cloud.google.com/grounding-api-redirect/x\ntitle: 食べログ\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]\n[SEARCH_NOTE]\nsource_url: https://vertexaisearch.cloud.google.com/grounding-api-redirect/x\nkind: review_signal\nsummary: 複数の口コミで鮮魚が評価されている\n[/SEARCH_NOTE]`,
      groundingMetadata: null,
      usageMetadata: null,
      searchCallCount: 1,
      searchQueryCount: 1,
    });

    const result = await runStage1(STORE, AbortSignal.timeout(1000));

    expect(result.searchNotes).toHaveLength(1);
    expect(result.searchNotes[0]!.kind).toBe("review_signal");
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

  // business_hours_holidays 以外のAI対象keyを全てexcludeKeysに含めることで、
  // allowedKeysを1件(business_hours_holidays)だけに絞り、coverage検証
  // (feat/ai-research-pre-smoke-hardening、BLOCKER1)を単純なモック応答でも満たせるようにする。
  const ALL_EXCEPT_HOURS = new Set(
    selectAiResearchItems(RESEARCH_POLICY_ITEMS)
      .map((i) => i.key)
      .filter((k) => k !== "business_hours_holidays"),
  );

  it("正常なJSON応答をパース・検証してitemsを返す", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
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

    const result = await runStage2(
      { store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS },
      AbortSignal.timeout(1000),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.key).toBe("business_hours_holidays");
  });

  it("1回のAPI呼出でFACT/FACT_OR_HEARING/ANALYSIS全キーを許可する", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
        items: fullItemsForAllowedKeys(),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000));

    expect(mockRunStructuredUrlContext).toHaveBeenCalledTimes(1);
  });

  it("不正なJSON文字列はStage2InvalidOutputErrorを投げる(feat/ai-research-pre-smoke-hardening、BLOCKER1: 部分成功をsucceededにしない)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: "{ this is not valid json",
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await expect(
      runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ name: "Stage2InvalidOutputError", kind: "json_parse" });
  });

  it("スキーマ不一致(不正なsource_id等)もStage2InvalidOutputErrorを投げる", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
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

    await expect(
      runStage2(
        { store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ name: "Stage2InvalidOutputError", kind: "schema" });
  });

  it("keyが不足している(coverage不一致)場合もStage2InvalidOutputErrorを投げる(BLOCKER1)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
        items: [], // business_hours_holidaysが欠落
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await expect(
      runStage2(
        { store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ name: "Stage2InvalidOutputError", kind: "coverage" });
  });

  it("同一keyが重複している場合もStage2InvalidOutputErrorを投げる(BLOCKER1)", async () => {
    const dup = {
      key: "business_hours_holidays",
      research_policy: "FACT",
      status: "not_found",
      value: null,
      evidence: "e",
      source_ids: [],
    };
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
        items: [dup, dup],
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await expect(
      runStage2(
        { store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ name: "Stage2InvalidOutputError", kind: "coverage" });
  });

  it("未知のkeyが混入している(allowedKeysに無い)場合もStage2InvalidOutputErrorを投げる(BLOCKER1)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
        items: [
          {
            key: "business_hours_holidays",
            research_policy: "FACT",
            status: "not_found",
            value: null,
            evidence: "e",
            source_ids: [],
          },
          {
            // allowedKeysに含めていない(excludeKeysで除外済みの)key
            key: "seat_count",
            research_policy: "FACT",
            status: "not_found",
            value: null,
            evidence: "e",
            source_ids: [],
          },
        ],
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await expect(
      runStage2(
        {
          store: STORE,
          sourceRegistry: REGISTRY,
          excludeKeys: new Set([...ALL_EXCEPT_HOURS, "seat_count"]),
        },
        AbortSignal.timeout(1000),
      ),
      // allowedKeysに無いkeyは`buildStage2ResponseZodSchema`のenum制約により
      // coverage検証より前のsafeParseで弾かれるため、kindは"coverage"ではなく"schema"になる
      // (実装を仮定せずvitest実行で確認した実際の挙動)。
    ).rejects.toMatchObject({ name: "Stage2InvalidOutputError", kind: "schema" });
  });

  it("searchNotesをStage2プロンプトへ渡す(feat/ai-research-source-diversity)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
        items: fullItemsForAllowedKeys(),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await runStage2(
      {
        store: STORE,
        sourceRegistry: REGISTRY,
        searchNotes: [
          {
            sourceUrl: REGISTRY[0]!.grounding_redirect_url,
            kind: "review_signal",
            summary: "複数の口コミで鮮魚が評価されている",
          },
        ],
      },
      AbortSignal.timeout(1000),
    );

    const promptArg = mockRunStructuredUrlContext.mock.calls.at(-1)![0].prompt as string;
    expect(promptArg).toContain("複数の口コミで鮮魚が評価されている");
  });

  it("clientがmax_tokensエラーを投げた場合はそのまま伝播する(fix/ai-research-stage2-max-tokens)", async () => {
    mockRunStructuredUrlContext.mockRejectedValue({ kind: "max_tokens" });

    await expect(
      runStage2({ store: STORE, sourceRegistry: REGISTRY }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: "max_tokens" });
  });

  it("sourceRegistryが空でもAPI呼出自体は行う(Source Registry空時の案内はprompts.tsが担当)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
        items: fullItemsForAllowedKeys(),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    const result = await runStage2({ store: STORE, sourceRegistry: [] }, AbortSignal.timeout(1000));

    expect(mockRunStructuredUrlContext).toHaveBeenCalled();
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe("buildNonAiItems", () => {
  it("HEARING_ONLY/EXTERNAL_DATA_REQUIRED項目をAPI呼出無しで生成する", () => {
    const items = buildNonAiItems();
    // feat/ai-research-quality-refinement: population_day_nightがANALYSIS→
    // EXTERNAL_DATA_REQUIRDへ変更されたため、HEARING_ONLY=10 / EXTERNAL_DATA_REQUIRED=2 = 12件
    expect(items).toHaveLength(12);
    for (const item of items) {
      expect(item.source_ids).toEqual([]);
      expect(["hearing_required", "external_data_required"]).toContain(item.status);
    }
  });

  it("population_day_nightはexternal_data_requiredになる(feat/ai-research-quality-refinement)", () => {
    const items = buildNonAiItems();
    const populationDayNight = items.find((i) => i.key === "population_day_night");
    expect(populationDayNight?.status).toBe("external_data_required");
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

describe("buildDeterministicPlacesItems (feat/ai-research-quality-refinement)", () => {
  const basicInfo = {
    review_avg: { value: "4.2", tier: "A" as const, filled_by: "places" as const, updated_at: "2026-08-03T00:00:00.000Z" },
    review_count: { value: "120", tier: "A" as const, filled_by: "places" as const, updated_at: "2026-08-03T00:00:00.000Z" },
    store_name: { value: "炉端ジュン", tier: "A" as const, filled_by: "places" as const, updated_at: "2026-08-03T00:00:00.000Z" },
  };

  it("placesVerifiedKeysに含まれるreview_avg/review_countのみconfirmedなItemを合成する", () => {
    const items = buildDeterministicPlacesItems(basicInfo, new Set(["review_avg", "review_count"]));
    expect(items).toHaveLength(2);
    const reviewAvg = items.find((i) => i.key === "review_avg");
    expect(reviewAvg?.status).toBe("confirmed");
    expect(reviewAvg?.value).toBe("4.2");
    expect(reviewAvg?.evidence_basis).toBe("places");
    expect(reviewAvg?.source_ids).toEqual([]);
  });

  it("store_nameのようなDETERMINISTIC_PLACES_KEYS対象外keyはplacesVerifiedKeysに含まれていても合成しない", () => {
    const items = buildDeterministicPlacesItems(basicInfo, new Set(["store_name", "review_avg", "review_count"]));
    expect(items.find((i) => i.key === "store_name")).toBeUndefined();
  });

  it("placesVerifiedKeysが空なら何も合成しない", () => {
    const items = buildDeterministicPlacesItems(basicInfo, new Set());
    expect(items).toEqual([]);
  });

  it("値が空のkeyは合成しない", () => {
    const items = buildDeterministicPlacesItems(
      { review_avg: { value: null, tier: "A" as const, filled_by: "places" as const, updated_at: "x" } },
      new Set(["review_avg"]),
    );
    expect(items).toEqual([]);
  });
});

describe("deriveDeterministicPlacesConfirmedKeys (feat/ai-research-final-audit-hardening、BLOCKER2保護のテストカバレッジ欠落を修正)", () => {
  it("derivePlacesVerifiedKeysが返しうる最大6keyのうち、review_avg/review_countのみを残す", () => {
    // このテストはBLOCKER2(store_name/address/cuisine_genre/phoneが値の中身を見ずに
    // key一致だけでconfirmedバイパスされてしまうバグ)の防御そのものを固定する回帰
    // テスト。以前はworkflows/store-research.ts内にインラインでしか存在せず、
    // Workflow全体がテストではmockされるため検知不能だった。
    const result = deriveDeterministicPlacesConfirmedKeys(
      new Set(["store_name", "address", "cuisine_genre", "phone", "review_avg", "review_count"]),
    );
    expect(result).toEqual(new Set(["review_avg", "review_count"]));
  });

  it("入力が空集合なら空集合を返す", () => {
    expect(deriveDeterministicPlacesConfirmedKeys(new Set())).toEqual(new Set());
  });

  it("DETERMINISTIC_PLACES_KEYS以外のkeyしか無ければ空集合を返す", () => {
    expect(deriveDeterministicPlacesConfirmedKeys(new Set(["store_name", "phone"]))).toEqual(new Set());
  });
});

describe("runStage2 store_identification coarse guard (fix/ai-research-source-identity-integrity、FIX12)", () => {
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
  const ALL_EXCEPT_HOURS = new Set(
    selectAiResearchItems(RESEARCH_POLICY_ITEMS)
      .map((i) => i.key)
      .filter((k) => k !== "business_hours_holidays"),
  );

  it("matched_name/matched_addressの両方が対象店舗と明確に不一致ならStage2InvalidOutputErrorを投げる(run全体が別店舗を調査した疑いが強い場合の粗いsafety net)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: {
          matched_name: "カフェ&民泊 三喜遊",
          matched_address: "香川県三豊市仁尾町仁尾丙795",
          identification_note: "",
        },
        source_verifications: [],
        items: fullItemsForAllowedKeys(ALL_EXCEPT_HOURS),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await expect(
      runStage2({ store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ name: "Stage2InvalidOutputError", kind: "identity" });
  });

  it("matched_nameのみ不一致(matched_addressが空)なら発火しない(片方だけの不一致でrunを無駄に失敗させない)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "カフェ&民泊 三喜遊", matched_address: "", identification_note: "" },
        source_verifications: [],
        items: fullItemsForAllowedKeys(ALL_EXCEPT_HOURS),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await expect(
      runStage2({ store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS }, AbortSignal.timeout(1000)),
    ).resolves.toBeDefined();
  });

  it("matched_name/matched_addressが対象店舗と一致すれば発火しない(正常系)", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: {
          matched_name: STORE.name,
          matched_address: STORE.address,
          identification_note: "",
        },
        source_verifications: [],
        items: fullItemsForAllowedKeys(ALL_EXCEPT_HOURS),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await expect(
      runStage2({ store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS }, AbortSignal.timeout(1000)),
    ).resolves.toBeDefined();
  });

  it("source_verificationsがそのままStage2Outcomeへ返る", async () => {
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "" },
        source_verifications: [
          {
            source_id: "S01",
            relation: "target_store",
            observed_title: "t",
            observed_name: "n",
            observed_address: "a",
            observed_phone: "p",
            note: "note",
          },
        ],
        items: fullItemsForAllowedKeys(ALL_EXCEPT_HOURS),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    const result = await runStage2(
      { store: STORE, sourceRegistry: REGISTRY, excludeKeys: ALL_EXCEPT_HOURS },
      AbortSignal.timeout(1000),
    );
    expect(result.sourceVerifications).toHaveLength(1);
    expect(result.sourceVerifications[0]!.source_id).toBe("S01");
  });
});

describe("runStage2 excludeKeys (feat/ai-research-quality-refinement)", () => {
  it("excludeKeysで指定したkeyはGeminiへの項目一覧・プロンプトから除外する", async () => {
    const excludeKeys = new Set(["review_avg", "review_count"]);
    mockRunStructuredUrlContext.mockResolvedValue({
      rawText: JSON.stringify({
        store_identification: { matched_name: "", matched_address: "", identification_note: "z" },
        source_verifications: [],
        items: fullItemsForAllowedKeys(excludeKeys),
      }),
      urlContextMetadata: null,
      usageMetadata: null,
    });

    await runStage2(
      { store: STORE, sourceRegistry: [], excludeKeys },
      AbortSignal.timeout(1000),
    );

    const promptArg = mockRunStructuredUrlContext.mock.calls.at(-1)![0].prompt as string;
    expect(promptArg).not.toContain("review_avg:");
    expect(promptArg).not.toContain("review_count:");
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

describe("applySourceIdentityVerification (fix/ai-research-source-identity-integrity)", () => {
  const targetStore = { name: "東北メシ 炉端ジュン", address: "千葉県柏市旭町1-1-12", phone: "04-7199-7985", genre: "居酒屋" };
  const baseEntry = {
    id: "S04",
    title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ",
    grounding_redirect_url: "https://www.hotpepper.jp/strJ003828751/",
    resolved_url: null,
    resolve_status: "skipped" as const,
    source_type: "gourmet_site" as const,
    discovery_provenance: "gemini_search_candidate" as const,
    url_context_status: "success" as const,
  };

  it("CASE A(実機smoke事故の再現): relation=target_storeと自己申告されても、observed_name/addressが全く別店舗ならidentity_status=uncertainになりtarget_matchにしない", () => {
    const result = applySourceIdentityVerification(
      [baseEntry],
      [
        {
          source_id: "S04",
          relation: "target_store",
          observed_title: "カフェ&民泊 三喜遊",
          observed_name: "カフェ&民泊 三喜遊",
          observed_address: "香川県三豊市仁尾町仁尾丙795",
          observed_phone: null,
          note: "実際には全く別店舗のページだった",
        },
      ],
      targetStore,
    );
    expect(result[0]!.identity_status).toBe("uncertain");
    expect(result[0]!.identity_note).toContain("別店舗");
  });

  it("CASE B: relation=target_storeかつobserved_name/addressが対象店舗と一致すればtarget_matchになる", () => {
    const result = applySourceIdentityVerification(
      [{ ...baseEntry, grounding_redirect_url: "https://www.hotpepper.jp/strJ003807133/" }],
      [
        {
          source_id: "S04",
          relation: "target_store",
          observed_title: "東北メシ 炉端ジュン",
          observed_name: "炉端ジュン",
          observed_address: "千葉県柏市旭町1-1-12",
          observed_phone: null,
          note: "正しい店舗ページ",
        },
      ],
      targetStore,
    );
    expect(result[0]!.identity_status).toBe("target_match");
  });

  it("wrong title + correct URL: titleが対象店舗と無関係でも、observed_name/addressが一致すればtarget_matchになる(titleを信用しない設計の裏返し)", () => {
    const result = applySourceIdentityVerification(
      [{ ...baseEntry, title: "全く関係ないtitle文字列" }],
      [
        {
          source_id: "S04",
          relation: "target_store",
          observed_title: null,
          observed_name: "炉端ジュン",
          observed_address: "千葉県柏市旭町1-1-12",
          observed_phone: null,
          note: "本文からは正しく確認できた",
        },
      ],
      targetStore,
    );
    expect(result[0]!.identity_status).toBe("target_match");
  });

  it("relation=competitorは自己申告のままcompetitor_matchにする(正解データが無いためコード側検証はしない、FIX3)", () => {
    const result = applySourceIdentityVerification(
      [baseEntry],
      [
        {
          source_id: "S04",
          relation: "competitor",
          observed_title: "競合店の紹介記事",
          observed_name: "競合店A",
          observed_address: null,
          observed_phone: null,
          note: "競合調査目的で発見",
        },
      ],
      targetStore,
    );
    expect(result[0]!.identity_status).toBe("competitor_match");
  });

  it("relation=contextualはcontextualに、relation=unrelatedはunrelatedに、relation=uncertainはuncertainにそのまま反映する", () => {
    const cases: Array<["contextual" | "unrelated" | "uncertain", string]> = [
      ["contextual", "contextual"],
      ["unrelated", "unrelated"],
      ["uncertain", "uncertain"],
    ];
    for (const [relation, expected] of cases) {
      const result = applySourceIdentityVerification(
        [baseEntry],
        [
          {
            source_id: "S04",
            relation,
            observed_title: null,
            observed_name: null,
            observed_address: null,
            observed_phone: null,
            note: "",
          },
        ],
        targetStore,
      );
      expect(result[0]!.identity_status).toBe(expected);
    }
  });

  it("source_verificationsに言及の無いentryはidentity_status未設定(not_checked)のまま", () => {
    const result = applySourceIdentityVerification([baseEntry], [], targetStore);
    expect(result[0]!.identity_status).toBeUndefined();
  });

  it("identity_noteは長すぎる場合切り詰める", () => {
    const longNote = "あ".repeat(300);
    const result = applySourceIdentityVerification(
      [baseEntry],
      [
        {
          source_id: "S04",
          relation: "unrelated",
          observed_title: null,
          observed_name: null,
          observed_address: null,
          observed_phone: null,
          note: longNote,
        },
      ],
      targetStore,
    );
    expect(result[0]!.identity_note!.length).toBeLessThan(longNote.length);
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
        identity_status: "target_match" as const,
      },
    ];

    const result = finalizeResearchItems({
      aiItems,
      nonAiItems: buildNonAiItems(),
      sourceRegistry: registry,
    });

    // AI項目1件(検証済みsourceあり) + 12件のHEARING/EXTERNAL_DATA_REQUIRED系
    // (feat/ai-research-quality-refinement: population_day_night分の+1を含む)
    expect(result).toHaveLength(13);
    const businessHours = result.find((i) => i.key === "business_hours_holidays");
    expect(businessHours?.status).toBe("confirmed");
  });

  it("identity_statusがtarget_matchでなければurl_context成功済みでもconfirmedを維持しない(fix/ai-research-source-identity-integrity)", () => {
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
        identity_status: "unrelated" as const,
      },
    ];

    const result = finalizeResearchItems({
      aiItems,
      nonAiItems: [],
      sourceRegistry: registry,
    });

    const businessHours = result.find((i) => i.key === "business_hours_holidays");
    expect(businessHours?.status).toBe("not_found");
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

describe("appendConfirmedMediaContext (feat/ai-research-final-quality、Observed Web Presence時系列バグの修正)", () => {
  const makeItem = (key: string, evidence = "e") => ({
    key,
    research_policy: "ANALYSIS" as const,
    status: "confirmed" as const,
    value: "v",
    evidence,
    source_ids: [] as string[],
  });

  const registryWithSuccess = [
    {
      id: "S01",
      title: "自己申告のtitle(信用しない、FIX9)",
      grounding_redirect_url: "https://www.hotpepper.jp/strJ003807133/",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "gourmet_site" as const,
      discovery_provenance: "gemini_search_candidate" as const,
      url_context_status: "success" as const,
      identity_status: "target_match" as const,
    },
  ];

  it("own_net_exposure/exposure_gapのevidenceへ、実際に成功したsourceの一覧を追記する(表示名はhostnameからdeterministicに導出、entry.titleは使わない)", () => {
    const items = [makeItem("own_net_exposure"), makeItem("exposure_gap")];
    const result = appendConfirmedMediaContext(items, registryWithSuccess);
    expect(result[0]!.evidence).toContain("ホットペッパーグルメ");
    expect(result[1]!.evidence).toContain("ホットペッパーグルメ");
    expect(result[0]!.evidence).not.toContain("自己申告のtitle");
  });

  it("valueの先頭にdeterministicなFACT部分(確認できた掲載媒体)を付加する(feat/ai-research-final-trust-boundary、value/verified sourceのズレ修正)", () => {
    const items = [makeItem("own_net_exposure", "e")];
    const result = appendConfirmedMediaContext(items, registryWithSuccess);
    expect(result[0]!.value).toBe("確認できた掲載媒体: ホットペッパーグルメ。 v");
  });

  it("実機Preview検証(2026-08-07)の再現: grounding redirectのtransport hostしか持たないsourceでも、own_net_exposure/exposure_gapへtransport hostnameを混入させない", () => {
    const transportOnlySource = {
      id: "S01",
      title: "【公式】東北メシ炉端ジュン | 伝統的な原始焼きをたのしむ",
      grounding_redirect_url:
        "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEQ3wveVOvo8uZ2UuajpEUwAxFbtdHrQqZk",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "official_site" as const,
      discovery_provenance: "gemini_search_candidate" as const,
      url_context_status: "success" as const,
      identity_status: "target_match" as const,
    };
    // official_siteはMEDIA_COVERAGE_SOURCE_TYPESに含まれないため、gourmet_siteへ変更して検証する。
    const source = { ...transportOnlySource, source_type: "gourmet_site" as const };
    const items = [makeItem("own_net_exposure"), makeItem("exposure_gap")];
    const result = appendConfirmedMediaContext(items, [source]);
    expect(result[0]!.value).not.toContain("vertexaisearch.cloud.google.com");
    expect(result[1]!.value).not.toContain("vertexaisearch.cloud.google.com");
    expect(result[0]!.value).toContain("東北メシ炉端ジュン");
  });

  it("url_context成功でもidentity_statusがtarget_matchでなければ「確認できた媒体」に混入しない(fix/ai-research-source-identity-integrity、FIX10)", () => {
    const wrongStoreSource = { ...registryWithSuccess[0]!, identity_status: "unrelated" as const };
    const items = [makeItem("own_net_exposure", "元のevidence")];
    const result = appendConfirmedMediaContext(items, [wrongStoreSource]);
    expect(result[0]!.evidence).toBe("元のevidence");
    expect(result[0]!.value).toBe("v");
  });

  it("対象外keyのevidence/valueは変更しない", () => {
    const items = [makeItem("market_demand", "元のevidence")];
    const result = appendConfirmedMediaContext(items, registryWithSuccess);
    expect(result[0]!.evidence).toBe("元のevidence");
    expect(result[0]!.value).toBe("v");
  });

  it("url_context成功のsourceが無い場合は何もしない", () => {
    const items = [makeItem("own_net_exposure", "元のevidence")];
    const result = appendConfirmedMediaContext(items, []);
    expect(result[0]!.evidence).toBe("元のevidence");
  });

  it("valueがnullの場合はプレフィックスを付加しない", () => {
    const items = [{ ...makeItem("own_net_exposure"), value: null }];
    const result = appendConfirmedMediaContext(items, registryWithSuccess);
    expect(result[0]!.value).toBeNull();
  });

  it("competitor/public_data等の自店と無関係なsourceは「確認できた掲載媒体」に混入しない(feat/ai-research-pre-smoke-hardening、MAJOR9)", () => {
    const competitorSuccess = {
      id: "S02",
      title: "競合店Xの紹介記事",
      grounding_redirect_url: "https://example.com/competitor",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "competitor" as const,
      discovery_provenance: "gemini_search_candidate" as const,
      url_context_status: "success" as const,
    };
    const items = [makeItem("own_net_exposure", "元のevidence")];
    const result = appendConfirmedMediaContext(items, [competitorSuccess]);
    expect(result[0]!.evidence).toBe("元のevidence");
    expect(result[0]!.value).toBe("v");
  });
});

describe("upgradeMediaCoverageFromRegistry (feat/ai-research-final-quality、fix/ai-research-source-identity-integrity でFIX10として再設計)", () => {
  const mediaItems = () => [
    {
      key: "media_coverage",
      research_policy: "FACT" as const,
      status: "not_found" as const,
      value: null,
      evidence: "見つからなかった",
      source_ids: [],
    },
  ];

  const tabelogTargetMatch = {
    id: "S01",
    title: "自己申告のtitle(信用しない)",
    grounding_redirect_url: "https://tabelog.com/kanagawa/A1234/A123456/12345678/",
    resolved_url: null,
    resolve_status: "skipped" as const,
    source_type: "gourmet_site" as const,
    discovery_provenance: "gemini_search_candidate" as const,
    url_context_status: "success" as const,
    identity_status: "target_match" as const,
  };

  it("url_context成功 + identity_status=target_matchの第三者媒体があればconfirmedへ補正し、valueはhostnameからdeterministicに導出する(entry.titleは使わない、FIX9)", () => {
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [tabelogTargetMatch]);
    expect(result[0]!.status).toBe("confirmed");
    expect(result[0]!.value).toBe("食べログ");
    expect(result[0]!.value).not.toContain("自己申告のtitle");
    expect(result[0]!.source_ids).toEqual(["S01"]);
    expect(result[0]!.evidence_basis).toBe("url_context");
  });

  it("AIが既にconfirmedと判定済みでも、検証済み媒体があればvalue/source_idsをdeterministicに再構築する(feat/ai-research-final-trust-boundary、value/source_ids不整合の実バグ再発防止)", () => {
    const items = [
      {
        key: "media_coverage",
        research_policy: "FACT" as const,
        status: "confirmed" as const,
        value: "AIが自称する未検証の5媒体名",
        evidence: "AIのevidence",
        source_ids: ["S99"], // 未検証の捏造id
      },
    ];
    const result = upgradeMediaCoverageFromRegistry(items, [tabelogTargetMatch]);
    expect(result[0]!.value).toBe("食べログ");
    expect(result[0]!.source_ids).toEqual(["S01"]);
  });

  it("複数のtarget_match媒体があれば集約する", () => {
    const jalanTargetMatch = {
      ...tabelogTargetMatch,
      id: "S02",
      source_type: "reservation_site" as const,
      grounding_redirect_url: "https://www.jalan.net/kankou/spt_guide000000.html",
    };
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [tabelogTargetMatch, jalanTargetMatch]);
    expect(result[0]!.status).toBe("confirmed");
    expect(result[0]!.value).toBe("食べログ、じゃらんnet");
    expect(result[0]!.source_ids.sort()).toEqual(["S01", "S02"]);
  });

  it("実機Preview検証(2026-08-07)の再現: grounding redirectのtransport hostしか持たないsourceでも、target_matchならtitleへfallackしtransport hostnameをvalueへ混入させない", () => {
    // 炉端ジュン成功run(research_run_msitguoh_iw4n9v)で実際に発生した形。
    // Stage1.5撤去によりresolved_urlは常にnullで、grounding_redirect_urlは
    // vertexaisearch.cloud.google.comのredirect URLしか持たない。
    const transportOnlySource = {
      id: "S04",
      title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ",
      grounding_redirect_url:
        "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHyIW3XC4lzLZF6T5vL0pxlqA8kgkMRfzu_IA7g",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "gourmet_site" as const,
      discovery_provenance: "gemini_search_candidate" as const,
      url_context_status: "success" as const,
      identity_status: "target_match" as const,
    };
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [transportOnlySource]);
    expect(result[0]!.status).toBe("confirmed");
    expect(result[0]!.value).toBe("東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ");
    expect(result[0]!.value).not.toContain("vertexaisearch.cloud.google.com");
  });

  it("実機smoke事故の再現: url_context成功かつ信頼済みhostnameでも、identity_statusがunrelated(=別店舗のページ)なら媒体として列挙しない(CONFIRMED BUG修正の核心)", () => {
    // 東北メシ 炉端ジュンの調査で、実際には「カフェ&民泊 三喜遊」という完全な別店舗を
    // 指すHotPepper URLが、url_context取得に成功しモデルのtitleも「炉端ジュン」で
    // あったにもかかわらず「確認済み媒体」として扱われた実機事故のケース。
    const wrongStoreHotPepper = {
      id: "S04",
      title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ",
      grounding_redirect_url: "https://www.hotpepper.jp/strJ003828751/",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "gourmet_site" as const,
      discovery_provenance: "gemini_search_candidate" as const,
      url_context_status: "success" as const,
      identity_status: "unrelated" as const,
    };
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [wrongStoreHotPepper]);
    expect(result[0]!.status).toBe("not_found");
  });

  it("url_context成功だがidentity_status=uncertain(観測不足等)なら媒体として列挙しない", () => {
    const uncertainSource = { ...tabelogTargetMatch, identity_status: "uncertain" as const };
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [uncertainSource]);
    expect(result[0]!.status).toBe("not_found");
  });

  it("url_context成功だがidentity_statusが未設定(not_checked、既存runとの後方互換)なら媒体として列挙しない", () => {
    const notCheckedSource: SourceRegistryEntry = { ...tabelogTargetMatch };
    delete notCheckedSource.identity_status;
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [notCheckedSource]);
    expect(result[0]!.status).toBe("not_found");
  });

  it("identity_status=target_matchでもurl_context成功でなければ媒体として列挙しない(SearchFact-onlyの経路は廃止、FIX6)", () => {
    const notFetched = { ...tabelogTargetMatch, url_context_status: "error" as const };
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [notFetched]);
    expect(result[0]!.status).toBe("not_found");
  });

  it("成功済みの対象媒体が無ければ何もしない", () => {
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), []);
    expect(result[0]!.status).toBe("not_found");
  });

  it("official_siteのみが成功していてもmedia_coverageの対象媒体とはみなさない(自店発信のため)", () => {
    const officialOnly = { ...tabelogTargetMatch, source_type: "official_site" as const };
    const result = upgradeMediaCoverageFromRegistry(mediaItems(), [officialOnly]);
    expect(result[0]!.status).toBe("not_found");
  });

  it("url_context成功 + identity_status=target_matchの媒体は、finalizeResearchItemsを経由してもconfirmedのまま維持される(統合回帰テスト)", () => {
    const jalanTargetMatch = {
      ...tabelogTargetMatch,
      id: "S02",
      source_type: "reservation_site" as const,
      grounding_redirect_url: "https://www.jalan.net/kankou/spt_guide000000.html",
    };
    const registry = [tabelogTargetMatch, jalanTargetMatch];
    const upgraded = upgradeMediaCoverageFromRegistry(mediaItems(), registry);
    const finalItems = finalizeResearchItems({
      aiItems: upgraded,
      nonAiItems: [],
      sourceRegistry: registry,
    });

    const mediaCoverageItem = finalItems.find((i) => i.key === "media_coverage")!;
    expect(mediaCoverageItem.status).toBe("confirmed");
    expect(mediaCoverageItem.value).toBe("食べログ、じゃらんnet");
    expect(mediaCoverageItem.source_ids.sort()).toEqual(["S01", "S02"]);
  });
});
