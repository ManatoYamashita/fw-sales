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
  buildCanonicalFallbackItems,
  buildDeterministicItems,
  deriveCanonicalFallbackConfirmedKeys,
  deriveDeterministicPlacesConfirmedKeys,
  applyUrlContextStatus,
  applySourceIdentityVerification,
  appendConfirmedMediaContext,
  upgradeMediaCoverageFromRegistry,
  finalizeResearchItems,
  buildStage2RequestShape,
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

  // PR #180 final smoke hardening、BLOCKER 1 observability。
  // client 側で boolean 化された `tabelogSearchAttempted` を Stage1Outcome まで
  // そのまま伝播させる(raw query は client 側で既に破棄されている)。
  it.each([true, false])(
    "tabelogSearchAttempted=%s を Stage1Outcome へ伝播する",
    async (attempted) => {
      mockRunSourceDiscovery.mockResolvedValue({
        text: "見つかりませんでした",
        groundingMetadata: null,
        usageMetadata: null,
        searchCallCount: 3,
        searchQueryCount: 12,
        tabelogSearchAttempted: attempted,
      });

      const result = await runStage1(STORE, AbortSignal.timeout(1000));
      expect(result.tabelogSearchAttempted).toBe(attempted);
      // 既存 diagnostics の挙動は不変。
      expect(result.searchCallCount).toBe(3);
      expect(result.searchQueryCount).toBe(12);
    },
  );

  it("tabelogSearchAttempted=false でも run は継続する(failedにしない)", async () => {
    mockRunSourceDiscovery.mockResolvedValue({
      text: `[SOURCE]\nurl: https://vertexaisearch.cloud.google.com/grounding-api-redirect/x\ntitle: Retty\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]`,
      groundingMetadata: null,
      usageMetadata: null,
      searchCallCount: 3,
      searchQueryCount: 12,
      tabelogSearchAttempted: false,
    });

    const result = await runStage1(STORE, AbortSignal.timeout(1000));
    expect(result.tabelogSearchAttempted).toBe(false);
    expect(result.sourceRegistry).toHaveLength(1);
  });

  /**
   * Tabelog source の Stage1 observability(PR #180、read-only audit の follow-up)。
   *
   * `tabelog_search_attempted`(検索を実行したか)だけでは、
   * 「検索結果に食べログが出なかった」のか「モデルが [SOURCE] として出さなかった」のかを
   * 区別できない。Stage1 応答テキストから boolean 2つを導出して次回 smoke で分離する。
   * production behavior(registry 選択 / prompt / Gemini call 数)は一切変えない。
   */
  describe("tabelog source diagnostics", () => {
    const stage1 = (text: string) => ({
      text,
      groundingMetadata: null,
      usageMetadata: null,
      searchCallCount: 3,
      searchQueryCount: 12,
      tabelogSearchAttempted: true,
    });
    const RETTY_BLOCK =
      "[SOURCE]\nurl: https://retty.me/area/PRE14/ARE57/100001730030/\ntitle: Retty\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]";

    it("正常な Tabelog SOURCE → emitted=true / mentionsDomain=true", async () => {
      mockRunSourceDiscovery.mockResolvedValue(
        stage1(
          "[SOURCE]\nurl: https://tabelog.com/kanagawa/A1401/A140104/14099999/\ntitle: 食べログ\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]",
        ),
      );
      const result = await runStage1(STORE, AbortSignal.timeout(1000));
      expect(result.tabelogSourceEmitted).toBe(true);
      expect(result.tabelogSourceBlockMentionsDomain).toBe(true);
    });

    it("SOURCE block内にURLはあるが parser 形式不正 → emitted=false / mentionsDomain=true", async () => {
      mockRunSourceDiscovery.mockResolvedValue(
        stage1("[SOURCE]\nhttps://tabelog.com/kanagawa/A1401/A140104/14099999/\n[/SOURCE]"),
      );
      const result = await runStage1(STORE, AbortSignal.timeout(1000));
      expect(result.tabelogSourceEmitted).toBe(false);
      expect(result.tabelogSourceBlockMentionsDomain).toBe(true);
    });

    it("[QUERY]の自己申告だけ(SOURCEはRettyのみ)→ 両方 false / 既存diagnosticsは不変", async () => {
      mockRunSourceDiscovery.mockResolvedValue(
        stage1(`[QUERY]site:tabelog.com 関内 なむら[/QUERY]\n${RETTY_BLOCK}`),
      );
      const result = await runStage1(STORE, AbortSignal.timeout(1000));
      expect(result.tabelogSourceEmitted).toBe(false);
      expect(result.tabelogSourceBlockMentionsDomain).toBe(false);
      expect(result.tabelogSearchAttempted).toBe(true);
      expect(result.searchCallCount).toBe(3);
      expect(result.searchQueryCount).toBe(12);
    });

    it("12. tabelogSourceEmitted=false でも run を失敗させず Source Registry を通常どおり構築する", async () => {
      mockRunSourceDiscovery.mockResolvedValue(stage1(RETTY_BLOCK));
      const result = await runStage1(STORE, AbortSignal.timeout(1000));
      expect(result.tabelogSourceEmitted).toBe(false);
      expect(result.sourceRegistry).toHaveLength(1);
      expect(result.sourceRegistry[0]!.source_type).toBe("gourmet_site");
    });

    it("11. 永続化される stage1_diagnostics に raw text / raw URL / raw query が含まれない", async () => {
      const rawUrl = "https://tabelog.com/kanagawa/A1401/A140104/14099999/";
      mockRunSourceDiscovery.mockResolvedValue(
        stage1(
          `[QUERY]site:tabelog.com 関内 なむら[/QUERY]\n[SOURCE]\nurl: ${rawUrl}\ntitle: 食べログ 関内 なむら\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]`,
        ),
      );
      const result = await runStage1(STORE, AbortSignal.timeout(1000));

      // `workflows/store-research.ts:persistSucceededStep` が保存する形をそのまま組み立てる。
      const persisted = {
        search_call_count: result.searchCallCount,
        search_query_count: result.searchQueryCount,
        tabelog_search_attempted: result.tabelogSearchAttempted,
        tabelog_source_emitted: result.tabelogSourceEmitted,
        tabelog_source_block_mentions_domain: result.tabelogSourceBlockMentionsDomain,
      };
      expect(typeof persisted.tabelog_source_emitted).toBe("boolean");
      expect(typeof persisted.tabelog_source_block_mentions_domain).toBe("boolean");

      const serialized = JSON.stringify(persisted);
      expect(serialized).not.toContain(rawUrl);
      expect(serialized).not.toContain("tabelog.com");
      expect(serialized).not.toContain("なむら");
      expect(serialized).not.toContain("[SOURCE]");
      expect(serialized).not.toContain("site:");
    });
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

/**
 * fresh Places / canonical fallback の分離
 * (feat/ai-research-quality-ux-hardening、Plan §6 / §7)。
 */
describe("buildDeterministicPlacesItems — fresh起点 (Plan §6.1)", () => {
  const freshField = (value: string | null) => ({
    value,
    tier: "A" as const,
    filled_by: "places" as const,
    updated_at: "2026-08-12T00:00:00.000Z",
  });
  const manualField = (value: string | null, updatedAt = "2026-08-04T09:00:00.000Z") => ({
    value,
    tier: "A" as const,
    filled_by: "manual" as const,
    updated_at: updatedAt,
  });

  it("Q1回帰: canonicalがmanualでも、fresh Placesがあればconfirmedを合成する", () => {
    // 実機事象(炉端ジュン): canonical review_avg が filled_by="manual" のため
    // deterministic item が1件も作られず、Gemini担当 → not_found に退化していた。
    const fresh = { review_avg: freshField("4.4") };
    const canonical = { review_avg: manualField("4.2") };
    const items = buildDeterministicPlacesItems(fresh, new Set(["review_avg"]), canonical);
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("confirmed");
    expect(items[0]!.value).toBe("4.4");
    expect(items[0]!.evidence_basis).toBe("places");
  });

  it("freshとcanonicalが異なる場合はfreshを採用し、warningに両方の値を出す", () => {
    const fresh = { review_avg: freshField("4.4") };
    const canonical = { review_avg: manualField("4.2") };
    const items = buildDeterministicPlacesItems(fresh, new Set(["review_avg"]), canonical);
    expect(items[0]!.value).toBe("4.4");
    expect(items[0]!.warning).toContain("4.2");
    expect(items[0]!.warning).toContain("4.4");
  });

  it("freshとcanonicalが同じ値ならwarningを付けない", () => {
    const fresh = { review_avg: freshField("4.2") };
    const canonical = { review_avg: manualField("4.2") };
    const items = buildDeterministicPlacesItems(fresh, new Set(["review_avg"]), canonical);
    expect(items[0]!.warning).toBeUndefined();
  });

  it("canonicalを渡さない場合もfresh単独で合成できる", () => {
    const fresh = { review_count: freshField("51") };
    const items = buildDeterministicPlacesItems(fresh, new Set(["review_count"]));
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("51");
  });

  it("evidenceは『今回の調査時点』であることを明示する", () => {
    const items = buildDeterministicPlacesItems(
      { review_avg: freshField("4.4") },
      new Set(["review_avg"]),
    );
    expect(items[0]!.evidence).toContain("今回");
    expect(items[0]!.evidence).toContain("Google Places");
  });
});

describe("buildCanonicalFallbackItems (Plan §7)", () => {
  const manualField = (value: string | null, updatedAt = "2026-08-04T09:00:00.000Z") => ({
    value,
    tier: "A" as const,
    filled_by: "manual" as const,
    updated_at: updatedAt,
  });
  const placesField = (value: string | null) => ({
    value,
    tier: "A" as const,
    filled_by: "places" as const,
    updated_at: "2026-07-01T00:00:00.000Z",
  });

  it("human-reviewedなofficial_siteをexisting_canonicalとして合成する", () => {
    const items = buildCanonicalFallbackItems(
      { official_site: manualField("あり (https://robata-jun.com/)") },
      new Set(),
    );
    const official = items.find((i) => i.key === "official_site");
    expect(official?.status).toBe("confirmed");
    expect(official?.value).toBe("あり (https://robata-jun.com/)");
    expect(official?.evidence_basis).toBe("existing_canonical");
    expect(official?.source_ids).toEqual([]);
    expect(official?.confidence).toBeNull();
  });

  it("承認レビュー指摘1: official_site が filled_by=places なら fallback しない", () => {
    const items = buildCanonicalFallbackItems(
      { official_site: placesField("あり (https://example.test/)") },
      new Set(),
    );
    expect(items.find((i) => i.key === "official_site")).toBeUndefined();
  });

  it("review_avgはfilled_byがplacesでもfallbackする(過去に機械確認された値)", () => {
    const items = buildCanonicalFallbackItems({ review_avg: placesField("4.2") }, new Set());
    expect(items.find((i) => i.key === "review_avg")?.value).toBe("4.2");
  });

  it("evidenceに『今回のWeb再確認はできていません』と最終更新日を含める(freshと偽装しない)", () => {
    const items = buildCanonicalFallbackItems(
      { review_avg: manualField("4.2", "2026-08-04T09:00:00.000Z") },
      new Set(),
    );
    expect(items[0]!.evidence).toContain("2026-08-04");
    expect(items[0]!.evidence).toContain("今回のWeb再確認はできていません");
  });

  it("既にfreshで生成済みのkeyは重複合成しない", () => {
    const items = buildCanonicalFallbackItems(
      { review_avg: manualField("4.2"), review_count: manualField("45") },
      new Set(["review_avg"]),
    );
    expect(items.map((i) => i.key)).toEqual(["review_count"]);
  });

  it("allowlist外のkeyは合成しない(調査結果が既存値のエコーにならないこと)", () => {
    const items = buildCanonicalFallbackItems(
      { concept: manualField("東北の郷土料理"), store_name: manualField("炉端ジュン") },
      new Set(),
    );
    expect(items).toEqual([]);
  });

  it("canonicalが空なら何も合成しない(退化ではなく現状維持)", () => {
    expect(buildCanonicalFallbackItems({}, new Set())).toEqual([]);
  });
});

describe("deriveCanonicalFallbackConfirmedKeys (Plan §7.1.1)", () => {
  it("実際に合成したitemのkeyだけを返す", () => {
    const items = buildCanonicalFallbackItems(
      {
        review_avg: {
          value: "4.2",
          tier: "A" as const,
          filled_by: "manual" as const,
          updated_at: "2026-08-04T00:00:00.000Z",
        },
      },
      new Set(),
    );
    expect(deriveCanonicalFallbackConfirmedKeys(items)).toEqual(new Set(["review_avg"]));
  });

  it("合成itemが0件なら空集合", () => {
    expect(deriveCanonicalFallbackConfirmedKeys([])).toEqual(new Set());
  });
});

/**
 * Stage0 → deterministic items のデータフロー統合検証
 * (feat/ai-research-quality-ux-hardening、Plan §15 横断 / Q18)。
 *
 * 実機バグ(Q1)の発生地点は `workflows/store-research.ts` の
 * 「`mergeBasicInfo` した結果から Places 検証済みkeyを導く」という**2行の相互作用**
 * だった。Workflow 本体は統合テストで丸ごと mock されるため、この相互作用には
 * 単体テストが存在しなかった(`deriveDeterministicPlacesConfirmedKeys` の JSDoc が
 * 同じ理由で純関数化された前例)。
 *
 * 本 describe は、その相互作用を純関数 `buildDeterministicItems` として切り出し、
 * 「canonical が manual でも fresh があれば confirmed になる」ことを固定する。
 */
describe("buildDeterministicItems — Stage0とcanonicalの相互作用 (Q18)", () => {
  const fresh = (value: string) => ({
    value,
    tier: "A" as const,
    filled_by: "places" as const,
    updated_at: "2026-08-12T00:00:00.000Z",
  });
  const manual = (value: string, updatedAt = "2026-08-04T09:00:00.000Z") => ({
    value,
    tier: "A" as const,
    filled_by: "manual" as const,
    updated_at: updatedAt,
  });

  it("実機ケース: canonical manual 4.2 + fresh Places 4.4 → fresh を confirmed で採用する", () => {
    const result = buildDeterministicItems({
      freshPlacesBasicInfo: { review_avg: fresh("4.4"), review_count: fresh("51") },
      canonicalBasicInfo: {
        review_avg: manual("4.2"),
        review_count: manual("45"),
        official_site: manual("あり (https://robata-jun.com/)"),
      },
    });

    const reviewAvg = result.items.find((i) => i.key === "review_avg");
    expect(reviewAvg?.status).toBe("confirmed");
    expect(reviewAvg?.value).toBe("4.4");
    expect(reviewAvg?.evidence_basis).toBe("places");
    expect(result.placesConfirmedKeys).toEqual(new Set(["review_avg", "review_count"]));
  });

  it("実機ケース: fresh が取れない場合は canonical を existing_canonical で提示する", () => {
    const result = buildDeterministicItems({
      freshPlacesBasicInfo: {},
      canonicalBasicInfo: {
        review_avg: manual("4.2"),
        review_count: manual("45"),
        official_site: manual("あり (https://robata-jun.com/)"),
      },
    });

    expect(result.deterministicKeys.sort()).toEqual(
      ["official_site", "review_avg", "review_count"].sort(),
    );
    for (const item of result.items) {
      expect(item.status).toBe("confirmed");
      expect(item.evidence_basis).toBe("existing_canonical");
      expect(item.confidence).toBeNull();
      expect(item.source_ids).toEqual([]);
      expect(item.evidence).toContain("今回のWeb再確認はできていません");
    }
    expect(result.placesConfirmedKeys.size).toBe(0);
    expect(result.canonicalConfirmedKeys).toEqual(
      new Set(["review_avg", "review_count", "official_site"]),
    );
  });

  it("fresh と canonical が混在する場合、key単位で正しく振り分ける", () => {
    const result = buildDeterministicItems({
      freshPlacesBasicInfo: { review_avg: fresh("4.4") },
      canonicalBasicInfo: {
        review_avg: manual("4.2"),
        review_count: manual("45"),
        official_site: manual("あり (https://robata-jun.com/)"),
      },
    });
    expect(result.placesConfirmedKeys).toEqual(new Set(["review_avg"]));
    expect(result.canonicalConfirmedKeys).toEqual(new Set(["review_count", "official_site"]));
    // 同じ key が両方に入ることはない(重複itemを作らない)
    expect(result.deterministicKeys.length).toBe(new Set(result.deterministicKeys).size);
  });

  it("canonicalもfreshも無ければ何も合成しない(従来どおりGemini担当・退化ではない)", () => {
    const result = buildDeterministicItems({
      freshPlacesBasicInfo: {},
      canonicalBasicInfo: {},
    });
    expect(result.items).toEqual([]);
    expect(result.deterministicKeys).toEqual([]);
  });

  it("BLOCKER2防御: fresh が6key返しても trust boundary へ渡すのは review_avg/review_count のみ", () => {
    const result = buildDeterministicItems({
      freshPlacesBasicInfo: {
        store_name: fresh("炉端ジュン"),
        address: fresh("東京都渋谷区1-2-3"),
        cuisine_genre: fresh("居酒屋"),
        phone: fresh("03-1234-5678"),
        review_avg: fresh("4.4"),
        review_count: fresh("51"),
      },
      canonicalBasicInfo: {},
    });
    expect(result.placesConfirmedKeys).toEqual(new Set(["review_avg", "review_count"]));
    expect(result.deterministicKeys.sort()).toEqual(["review_avg", "review_count"]);
  });

  it("承認レビュー指摘1: canonical official_site が places 由来なら fallback しない", () => {
    const result = buildDeterministicItems({
      freshPlacesBasicInfo: {},
      canonicalBasicInfo: {
        official_site: {
          value: "あり (https://example.test/)",
          tier: "A" as const,
          filled_by: "places" as const,
          updated_at: "2026-07-01T00:00:00.000Z",
        },
      },
    });
    expect(result.items).toEqual([]);
  });

  it("合成した全itemがfinalizeResearchItemsを通過してconfirmedを維持する(end-to-end)", () => {
    const derived = buildDeterministicItems({
      freshPlacesBasicInfo: { review_avg: fresh("4.4") },
      canonicalBasicInfo: { official_site: manual("あり (https://robata-jun.com/)") },
    });
    const finalized = finalizeResearchItems({
      aiItems: derived.items,
      nonAiItems: [],
      sourceRegistry: [],
      placesVerifiedKeys: derived.placesConfirmedKeys,
      canonicalVerifiedKeys: derived.canonicalConfirmedKeys,
    });
    expect(finalized.find((i) => i.key === "review_avg")?.status).toBe("confirmed");
    expect(finalized.find((i) => i.key === "official_site")?.status).toBe("confirmed");
    expect(finalized.find((i) => i.key === "official_site")?.value).toBe(
      "あり (https://robata-jun.com/)",
    );
  });

  it("同じkeyのAI生成item(evidence_basisなし)は canonicalVerifiedKeys があっても降格する", () => {
    // excludeKeys の regression で AI 生成 item が混入した場合の二重防御。
    const derived = buildDeterministicItems({
      freshPlacesBasicInfo: {},
      canonicalBasicInfo: { official_site: manual("あり (https://robata-jun.com/)") },
    });
    const aiItem = {
      key: "official_site",
      research_policy: "FACT" as const,
      status: "confirmed" as const,
      value: "あり (https://偽サイト.example/)",
      evidence: "AIが自力で発見したと主張",
      source_ids: [],
    };
    const finalized = finalizeResearchItems({
      aiItems: [aiItem],
      nonAiItems: [],
      sourceRegistry: [],
      canonicalVerifiedKeys: derived.canonicalConfirmedKeys,
    });
    expect(finalized[0]!.status).toBe("not_found");
    expect(finalized[0]!.value).toBeNull();
  });
});

/**
 * applyUrlContextStatus の URL 正規化(Q6、Plan §8.2 B1)。
 *
 * 従来は `retrievedUrl` と `grounding_redirect_url` の**文字列完全一致**のみで
 * 突合しており、末尾スラッシュ差等で url_context 成功を取りこぼしていた。
 * 既存の完全一致ケースは正規化後も一致するため、既存テストはそのまま通る。
 */
describe("applyUrlContextStatus — URL正規化 (Q6)", () => {
  const entry = (url: string): SourceRegistryEntry => ({
    id: "S01",
    title: "公式サイト(登録情報)",
    grounding_redirect_url: url,
    resolved_url: null,
    resolve_status: "skipped",
    source_type: "official_site",
    discovery_provenance: "known_store_data",
    url_context_status: "not_attempted",
    identity_status: "target_match",
  });

  it("末尾スラッシュ差を吸収してsuccessを反映する", () => {
    const result = applyUrlContextStatus(
      [entry("https://robata-jun.com/")],
      [{ urlMetadata: [{ retrievedUrl: "https://robata-jun.com", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] }],
    );
    expect(result[0]!.url_context_status).toBe("success");
  });

  it("scheme/hostnameのcase差を吸収する", () => {
    const result = applyUrlContextStatus(
      [entry("https://robata-jun.com/")],
      [{ urlMetadata: [{ retrievedUrl: "HTTPS://Robata-Jun.COM/", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] }],
    );
    expect(result[0]!.url_context_status).toBe("success");
  });

  it("fragment差を吸収する", () => {
    const result = applyUrlContextStatus(
      [entry("https://robata-jun.com/")],
      [{ urlMetadata: [{ retrievedUrl: "https://robata-jun.com/#menu", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] }],
    );
    expect(result[0]!.url_context_status).toBe("success");
  });

  it("www.の有無は吸収しない(別ホストの可能性、false negativeを優先)", () => {
    const result = applyUrlContextStatus(
      [entry("https://robata-jun.com/")],
      [{ urlMetadata: [{ retrievedUrl: "https://www.robata-jun.com/", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] }],
    );
    expect(result[0]!.url_context_status).toBe("not_attempted");
  });

  it("pathが違えば反映しない(origin-only matchをしない)", () => {
    const result = applyUrlContextStatus(
      [entry("https://robata-jun.com/")],
      [{ urlMetadata: [{ retrievedUrl: "https://robata-jun.com/menu", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] }],
    );
    expect(result[0]!.url_context_status).toBe("not_attempted");
  });

  it("パース不能なretrievedUrlは無視する(例外を投げない)", () => {
    const result = applyUrlContextStatus(
      [entry("https://robata-jun.com/")],
      [{ urlMetadata: [{ retrievedUrl: "not a url", status: "URL_RETRIEVAL_STATUS_SUCCESS" }] }],
    );
    expect(result[0]!.url_context_status).toBe("not_attempted");
  });

  it("grounding redirect URL(パース可能)も従来どおり一致する", () => {
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const result = applyUrlContextStatus(
      [entry(redirect)],
      [{ urlMetadata: [{ retrievedUrl: redirect, status: "URL_RETRIEVAL_STATUS_SUCCESS" }] }],
    );
    expect(result[0]!.url_context_status).toBe("success");
  });
});

/**
 * phone の複数番号保持 — finalizeResearchItems 経由の統合検証
 * (PR #180 final smoke hardening、Issue B)。
 */
describe("finalizeResearchItems — phone の複数番号 (Issue B)", () => {
  const TABELOG: SourceRegistryEntry = {
    id: "S01",
    title: "tabelog.com",
    grounding_redirect_url: "https://tabelog.com/kanagawa/A1401/A140104/14099999/",
    resolved_url: null,
    resolve_status: "skipped",
    source_type: "gourmet_site",
    discovery_provenance: "gemini_search_candidate",
    url_context_status: "success",
    identity_status: "target_match",
  };

  const phoneItem = (value: string, evidence: string, sourceIds = ["S01"]) => ({
    key: "phone",
    research_policy: "FACT" as const,
    status: "confirmed" as const,
    value,
    evidence,
    source_ids: sourceIds,
  });

  function finalizePhone(item: ReturnType<typeof phoneItem>, registry = [TABELOG]) {
    return finalizeResearchItems({ aiItems: [item], nonAiItems: [], sourceRegistry: registry })[0]!;
  }

  it("店舗直通のみ: confirmed(単一番号でも evidence に番号が必要、Issue B-3)", () => {
    const result = finalizePhone(
      phoneItem("045-305-6536", "食べログの店舗ページに電話番号 045-305-6536 と記載。"),
    );
    expect(result.status).toBe("confirmed");
    expect(result.value).toBe("045-305-6536");
  });

  it("予約用050のみ: confirmed(045が無くても捨てない)", () => {
    const result = finalizePhone(
      phoneItem(
        "予約・問い合わせ(食べログ): 050-5869-4190",
        "食べログに予約・お問い合わせ 050-5869-4190 と記載。",
      ),
    );
    expect(result.status).toBe("confirmed");
    expect(result.value).toContain("050-5869-4190");
  });

  it("実機ケース: 店舗直通 + 予約用050 の両方を役割ラベル付きで保持する", () => {
    const result = finalizePhone(
      phoneItem(
        "店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190",
        "食べログに電話番号 045-305-6536、予約・お問い合わせ 050-5869-4190 と記載。",
      ),
    );
    expect(result.status).toBe("confirmed");
    expect(result.value).toContain("045-305-6536");
    expect(result.value).toContain("050-5869-4190");
    expect(result.value).toContain("店舗直通");
    expect(result.value).toContain("予約");
  });

  it("同一番号の表記違いは重複扱いしない(降格させない)", () => {
    const result = finalizePhone(
      phoneItem("045-305-6536 / 0453056536", "掲載番号は 045-305-6536。"),
    );
    expect(result.status).toBe("confirmed");
  });

  it("evidence に無い050(モデル生成)は confirmed にしない", () => {
    const result = finalizePhone(
      phoneItem(
        "店舗直通: 045-305-6536 / 予約: 050-0000-0000",
        "食べログに電話番号 045-305-6536 と記載。",
      ),
    );
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
  });

  it("url_context 未取得の source しか無ければ、番号が揃っていても confirmed にしない", () => {
    const notFetched: SourceRegistryEntry = { ...TABELOG, url_context_status: "not_attempted" };
    const result = finalizePhone(
      phoneItem(
        "店舗直通: 045-305-6536 / 予約: 050-5869-4190",
        "電話番号 045-305-6536 と 050-5869-4190。",
      ),
      [notFetched],
    );
    expect(result.status).toBe("not_found");
  });

  it("identity が target_match でない source は根拠にできない(第三者店舗の050を採用しない)", () => {
    const otherStore: SourceRegistryEntry = { ...TABELOG, identity_status: "unrelated" };
    const result = finalizePhone(
      phoneItem(
        "店舗直通: 045-305-6536 / 予約: 050-5869-4190",
        "電話番号 045-305-6536 と 050-5869-4190。",
      ),
      [otherStore],
    );
    expect(result.status).toBe("not_found");
  });

  it("source_ids が registry に存在しなければ confirmed にしない", () => {
    const result = finalizePhone(
      phoneItem(
        "店舗直通: 045-305-6536 / 予約: 050-5869-4190",
        "電話番号 045-305-6536 と 050-5869-4190。",
        ["S99"],
      ),
    );
    expect(result.status).toBe("not_found");
  });
});

/**
 * evidence_basis 別経路の非退化(PR #180 final smoke hardening、Issue B-3)。
 *
 * AI 生成 phone には「value の番号が evidence にもある」ことを要求するが、
 * コード側が合成した deterministic / canonical fallback item にはこの要件を課さない。
 */
describe("finalizeResearchItems — phone の evidence_basis 別経路 (Issue B-3)", () => {
  it("単一番号のAI生成phoneでもevidenceに番号が無ければ降格する", () => {
    const registry: SourceRegistryEntry[] = [
      {
        id: "S01",
        title: "tabelog.com",
        grounding_redirect_url: "https://tabelog.com/x/",
        resolved_url: null,
        resolve_status: "skipped",
        source_type: "gourmet_site",
        discovery_provenance: "gemini_search_candidate",
        url_context_status: "success",
        identity_status: "target_match",
      },
    ];
    const result = finalizeResearchItems({
      aiItems: [
        {
          key: "phone",
          research_policy: "FACT",
          status: "confirmed",
          value: "045-305-6536",
          evidence: "公式サイトに店舗の電話番号として明記されています。",
          source_ids: ["S01"],
        },
      ],
      nonAiItems: [],
      sourceRegistry: registry,
    });
    expect(result[0]!.status).toBe("not_found");
  });

  it("deterministic Places item(evidence_basis=places)は evidence 要件で壊れない", () => {
    const placesPhone = {
      key: "phone",
      research_policy: "FACT" as const,
      status: "confirmed" as const,
      value: "045-305-6536",
      evidence: "今回の調査時点のGoogle Placesで確認した値です。",
      source_ids: [],
      confidence: 100,
      evidence_basis: "places" as const,
    };
    const result = finalizeResearchItems({
      aiItems: [placesPhone],
      nonAiItems: [],
      sourceRegistry: [],
      placesVerifiedKeys: new Set(["phone"]),
    });
    expect(result[0]!.status).toBe("confirmed");
    expect(result[0]!.value).toBe("045-305-6536");
  });

  it("canonical fallback item(evidence_basis=existing_canonical)は evidence 要件で壊れない", () => {
    const canonicalPhone = {
      key: "phone",
      research_policy: "FACT" as const,
      status: "confirmed" as const,
      value: "店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190",
      evidence:
        "登録済みの基本情報として保持されている値です(最終更新 2026-08-04)。今回のWeb再確認はできていません。",
      source_ids: [],
      confidence: null,
      evidence_basis: "existing_canonical" as const,
    };
    const result = finalizeResearchItems({
      aiItems: [canonicalPhone],
      nonAiItems: [],
      sourceRegistry: [],
      canonicalVerifiedKeys: new Set(["phone"]),
    });
    expect(result[0]!.status).toBe("confirmed");
    // 役割ラベルが維持されること
    expect(result[0]!.value).toContain("店舗直通");
    expect(result[0]!.value).toContain("予約・問い合わせ");
  });
});

/**
 * Stage2 request の sanitized な形状診断(PR #180、Stage2 400 observability)。
 *
 * count のみを構造化入力から導く純関数。URL・prompt・schema 本文・店舗情報を
 * 1つも保持しないことを固定する。
 */
describe("buildStage2RequestShape", () => {
  const entry = (id: string, url: string) =>
    ({
      id,
      grounding_redirect_url: url,
      title: "食べログ - 関内 なむら",
      source_type: "gourmet_site",
      discovery_provenance: "gemini_search_candidate",
      url_context_status: "not_attempted",
      identity_status: "not_checked",
    }) as unknown as SourceRegistryEntry;

  const REGISTRY = [
    entry("S01", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA"),
    entry("S02", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB"),
    entry("S03", "https://tabelog.com/kanagawa/A1401/A140104/14012345/"),
  ];

  const SCHEMA = { type: "object", properties: { a: { type: "string" } } };

  it("構造化入力から count を導く", () => {
    const shape = buildStage2RequestShape({
      allowedKeys: ["store_name", "address", "phone"],
      sourceRegistry: REGISTRY,
      searchNotes: [],
      jsonSchema: SCHEMA,
    });
    expect(shape.stage2_item_count).toBe(3);
    expect(shape.source_registry_count).toBe(3);
    expect(shape.unique_url_count).toBe(3);
    expect(shape.invalid_url_count).toBe(0);
    expect(shape.search_note_count).toBe(0);
  });

  it("重複 URL は unique_url_count に数えない", () => {
    const dup = [...REGISTRY, entry("S04", REGISTRY[0]!.grounding_redirect_url)];
    const shape = buildStage2RequestShape({
      allowedKeys: [],
      sourceRegistry: dup,
      searchNotes: [],
      jsonSchema: SCHEMA,
    });
    expect(shape.source_registry_count).toBe(4);
    expect(shape.unique_url_count).toBe(3);
  });

  it("new URL() で解釈できない URL を invalid_url_count に数える", () => {
    const withInvalid = [...REGISTRY, entry("S04", "not a url"), entry("S05", "")];
    const shape = buildStage2RequestShape({
      allowedKeys: [],
      sourceRegistry: withInvalid,
      searchNotes: [],
      jsonSchema: SCHEMA,
    });
    expect(shape.invalid_url_count).toBe(2);
  });

  it("search_note_count は prompt へ実際に入る件数(registry と URL 一致したもの)だけを数える", () => {
    // `buildStage2Prompt` は registry の URL と一致した note のみを埋め込む。
    const notes = [
      { sourceUrl: REGISTRY[0]!.grounding_redirect_url, kind: "store_fact", summary: "s" },
      { sourceUrl: REGISTRY[1]!.grounding_redirect_url, kind: "review_signal", summary: "s" },
      { sourceUrl: "https://unmatched.example.com/x", kind: "store_fact", summary: "s" },
    ] as unknown as Parameters<typeof buildStage2RequestShape>[0]["searchNotes"];

    const shape = buildStage2RequestShape({
      allowedKeys: [],
      sourceRegistry: REGISTRY,
      searchNotes: notes,
      jsonSchema: SCHEMA,
    });
    expect(shape.search_note_count).toBe(2);
  });

  it("schema_utf8_byte_count は JSON.stringify 後の UTF-8 バイト長", () => {
    const shape = buildStage2RequestShape({
      allowedKeys: [],
      sourceRegistry: [],
      searchNotes: [],
      jsonSchema: SCHEMA,
    });
    expect(shape.schema_utf8_byte_count).toBe(
      new TextEncoder().encode(JSON.stringify(SCHEMA)).length,
    );
  });

  it("空の registry / allowedKeys でも例外を投げず 0 を返す", () => {
    const shape = buildStage2RequestShape({
      allowedKeys: [],
      sourceRegistry: [],
      searchNotes: [],
      jsonSchema: {},
    });
    expect(shape.stage2_item_count).toBe(0);
    expect(shape.source_registry_count).toBe(0);
    expect(shape.unique_url_count).toBe(0);
    expect(shape.invalid_url_count).toBe(0);
    expect(shape.search_note_count).toBe(0);
  });

  it("戻り値に URL / title / schema 本文 / 店舗情報を保持しない", () => {
    const shape = buildStage2RequestShape({
      allowedKeys: ["store_name"],
      sourceRegistry: REGISTRY,
      searchNotes: [],
      jsonSchema: SCHEMA,
    });
    const serialized = JSON.stringify(shape);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("vertexaisearch");
    expect(serialized).not.toContain("tabelog");
    expect(serialized).not.toContain("なむら");
    expect(serialized).not.toContain("食べログ");
    expect(serialized).not.toContain("properties");
  });

  it("戻り値のキー集合と型が固定である(すべて number)", () => {
    const shape = buildStage2RequestShape({
      allowedKeys: ["a"],
      sourceRegistry: REGISTRY,
      searchNotes: [],
      jsonSchema: SCHEMA,
    });
    expect(Object.keys(shape).sort()).toEqual([
      "invalid_url_count",
      "schema_utf8_byte_count",
      "search_note_count",
      "source_registry_count",
      "stage2_item_count",
      "unique_url_count",
    ]);
    for (const value of Object.values(shape)) {
      expect(typeof value).toBe("number");
    }
  });

  it("入力を変更しない(純関数)", () => {
    const registry = [...REGISTRY];
    const before = JSON.stringify(registry);
    buildStage2RequestShape({
      allowedKeys: ["a"],
      sourceRegistry: registry,
      searchNotes: [],
      jsonSchema: SCHEMA,
    });
    expect(JSON.stringify(registry)).toBe(before);
  });
});
