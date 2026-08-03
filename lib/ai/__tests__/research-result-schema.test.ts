/**
 * ResearchItem / SourceRegistryEntry スキーマと deterministic validation の
 * 単体検証 (AI 店舗調査再設計 Plan v3.2 §10, §13, PR1 fresh review A-E)。
 */

import { describe, it, expect } from "vitest";
import {
  ResearchItemSchema,
  SourceRegistryEntrySchema,
  ReviewDecisionSchema,
  isValidReviewDecisionForItem,
  enforceResearchPolicy,
  enforceStatusForPolicy,
  sanitizeSourceIds,
  validateConflictShape,
  validateResearchItemStatus,
  applyDeterministicValidation,
  pruneUnverifiedSourceIds,
  validateResearchItems,
  type ResearchItem,
  type ResearchItemCandidate,
  type SourceRegistryEntry,
  type ReviewDecision,
} from "../research-result-schema";

function makeSource(
  overrides: Partial<SourceRegistryEntry> = {},
): SourceRegistryEntry {
  return {
    id: "S01",
    title: "gnavi.co.jp",
    grounding_redirect_url:
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    resolved_url: null,
    resolve_status: "failed",
    source_type: "official_site",
    discovery_provenance: "google_grounding",
    url_context_status: "not_attempted",
    ...overrides,
  };
}

function makeItem(overrides: Partial<ResearchItem> = {}): ResearchItem {
  return {
    key: "business_hours_holidays",
    research_policy: "FACT",
    status: "confirmed",
    value: "17:00-24:00",
    evidence: "公式サイトに明記",
    source_ids: ["S01"],
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<ResearchItemCandidate> = {},
): ResearchItemCandidate {
  return {
    candidate_id: "cand_a",
    label: "候補A",
    value: "17:00-24:00",
    evidence: "公式",
    source_ids: ["S01"],
    ...overrides,
  };
}

describe("スキーマの基本的な妥当性検証", () => {
  it("正常な SourceRegistryEntry を受理する", () => {
    const result = SourceRegistryEntrySchema.safeParse(makeSource());
    expect(result.success).toBe(true);
  });

  it("discovery_provenance に定義されていない値は拒否する", () => {
    const result = SourceRegistryEntrySchema.safeParse(
      makeSource({ discovery_provenance: "model_generated" as never }),
    );
    expect(result.success).toBe(false);
  });

  it("discovery_provenance = gemini_search_candidate / known_store_data を受理する(fix/ai-research-poc-like-retrieval で追加)", () => {
    expect(
      SourceRegistryEntrySchema.safeParse(
        makeSource({ discovery_provenance: "gemini_search_candidate" }),
      ).success,
    ).toBe(true);
    expect(
      SourceRegistryEntrySchema.safeParse(
        makeSource({ discovery_provenance: "known_store_data" }),
      ).success,
    ).toBe(true);
  });

  it("正常な ResearchItem を受理する", () => {
    const result = ResearchItemSchema.safeParse(makeItem());
    expect(result.success).toBe(true);
  });

  it("conflict項目の candidates を受理する", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [
        makeCandidate({ candidate_id: "cand_a" }),
        makeCandidate({ candidate_id: "cand_b", value: "18:00-24:00" }),
      ],
    });
    const result = ResearchItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it("不正な status を拒否する", () => {
    const result = ResearchItemSchema.safeParse(
      makeItem({ status: "definitely_true" as never }),
    );
    expect(result.success).toBe(false);
  });
});

describe("ReviewDecisionSchema (discriminated union, PR1 fresh review E)", () => {
  it("adoptedはselected_candidate_id/edited_valueを持てる", () => {
    const result = ReviewDecisionSchema.safeParse({
      decision: "adopted",
      selected_candidate_id: "cand_a",
      edited_value: "手動編集値",
      decided_at: "2026-08-02T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejected/skippedはそれぞれ最小フィールドで受理される", () => {
    for (const decision of ["rejected", "skipped"] as const) {
      const result = ReviewDecisionSchema.safeParse({
        decision,
        decided_at: "2026-08-02T00:00:00.000Z",
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejectedにselected_candidate_idを付けると拒否される (不正な組み合わせ)", () => {
    const result = ReviewDecisionSchema.safeParse({
      decision: "rejected",
      selected_candidate_id: "cand_a",
      decided_at: "2026-08-02T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("skippedにedited_valueを付けると拒否される (不正な組み合わせ)", () => {
    const result = ReviewDecisionSchema.safeParse({
      decision: "skipped",
      edited_value: "何か",
      decided_at: "2026-08-02T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("isValidReviewDecisionForItem", () => {
  it("selected_candidate_id無しのadoptedは常に妥当", () => {
    const decision: ReviewDecision = {
      decision: "adopted",
      decided_at: "2026-08-02T00:00:00.000Z",
    };
    expect(isValidReviewDecisionForItem(decision, makeItem())).toBe(true);
  });

  it("rejected/skippedは常に妥当", () => {
    expect(
      isValidReviewDecisionForItem(
        { decision: "rejected", decided_at: "x" },
        makeItem(),
      ),
    ).toBe(true);
  });

  it("conflict項目で実在するcandidate_idを参照するadoptedは妥当", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [makeCandidate({ candidate_id: "cand_a" })],
    });
    const decision: ReviewDecision = {
      decision: "adopted",
      selected_candidate_id: "cand_a",
      decided_at: "x",
    };
    expect(isValidReviewDecisionForItem(decision, item)).toBe(true);
  });

  it("conflict項目で実在しないcandidate_idを参照するadoptedは不正", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [makeCandidate({ candidate_id: "cand_a" })],
    });
    const decision: ReviewDecision = {
      decision: "adopted",
      selected_candidate_id: "cand_zzz",
      decided_at: "x",
    };
    expect(isValidReviewDecisionForItem(decision, item)).toBe(false);
  });

  it("非conflict項目でselected_candidate_idを指定するadoptedは不正", () => {
    const item = makeItem({ status: "confirmed" });
    const decision: ReviewDecision = {
      decision: "adopted",
      selected_candidate_id: "cand_a",
      decided_at: "x",
    };
    expect(isValidReviewDecisionForItem(decision, item)).toBe(false);
  });
});

describe("enforceResearchPolicy (PR1 fresh review B: research_policy trust boundary)", () => {
  it("AIが返したresearch_policyが正しければそのまま返す", () => {
    const item = makeItem({ key: "business_hours_holidays", research_policy: "FACT" });
    const result = enforceResearchPolicy(item);
    expect(result.research_policy).toBe("FACT");
    expect(result.warning).toBeUndefined();
  });

  it("AIが誤ったresearch_policyを返した場合、Source of Truthへ強制的に補正する", () => {
    // market_demand の正しい policy は ANALYSIS
    const item = makeItem({ key: "market_demand", research_policy: "FACT" as never });
    const result = enforceResearchPolicy(item);
    expect(result.research_policy).toBe("ANALYSIS");
    expect(result.warning).toContain("補正");
  });

  it("未知のkeyは項目全体を無効化する (not_found)", () => {
    const item = makeItem({ key: "made_up_key_that_does_not_exist" });
    const result = enforceResearchPolicy(item);
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
    expect(result.source_ids).toEqual([]);
    expect(result.warning).toContain("未知のkey");
  });

  it("純関数であり入力を変更しない", () => {
    const item = makeItem({ key: "market_demand", research_policy: "FACT" as never });
    const original = { ...item };
    enforceResearchPolicy(item);
    expect(item).toEqual(original);
  });
});

describe("enforceStatusForPolicy (feat/ai-research-quality-refinement: policy/status整合性の強制)", () => {
  it("FACTの許容status(confirmed/conflict/not_found)ならそのまま返す", () => {
    for (const status of ["confirmed", "conflict", "not_found"] as const) {
      const item = makeItem({ research_policy: "FACT", status });
      expect(enforceStatusForPolicy(item).status).toBe(status);
    }
  });

  it("ANALYSISの許容status(confirmed/inferred/conflict/not_found)ならそのまま返す", () => {
    for (const status of ["confirmed", "inferred", "conflict", "not_found"] as const) {
      const item = makeItem({ research_policy: "ANALYSIS", status });
      expect(enforceStatusForPolicy(item).status).toBe(status);
    }
  });

  it("FACT_OR_HEARINGにinferredが混入した場合、hearing_requiredへ補正しvalue/confidence/candidatesをnull化する(owner_snsで発見された実バグの再発防止)", () => {
    const item = makeItem({
      research_policy: "FACT_OR_HEARING",
      status: "inferred" as never,
      confidence: 50,
      candidates: [makeCandidate()],
    });
    const result = enforceStatusForPolicy(item);
    expect(result.status).toBe("hearing_required");
    expect(result.value).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.candidates).toBeUndefined();
    expect(result.warning).toContain("補正");
    expect(result.evidence).toBe("Web上の本人発信で確認できないため、営業時のヒアリングが必要です。");
  });

  it("FACTにhearing_requiredが混入した場合、not_foundへ補正する(ANALYSISのinferredへは倒さない、より保守的なfallback)", () => {
    const item = makeItem({ research_policy: "FACT", status: "hearing_required" as never });
    const result = enforceStatusForPolicy(item);
    expect(result.status).toBe("not_found");
  });

  it("ANALYSISにhearing_requiredが混入した場合もnot_foundへ補正する(inferredへは倒さない)", () => {
    const item = makeItem({ research_policy: "ANALYSIS", status: "hearing_required" as never });
    const result = enforceStatusForPolicy(item);
    expect(result.status).toBe("not_found");
  });

  it("HEARING_ONLYの許容statusはhearing_requiredのみ", () => {
    const item = makeItem({ research_policy: "HEARING_ONLY", status: "confirmed" });
    const result = enforceStatusForPolicy(item);
    expect(result.status).toBe("hearing_required");
  });

  it("EXTERNAL_DATA_REQUIREDの許容statusはexternal_data_requiredのみ", () => {
    const item = makeItem({ research_policy: "EXTERNAL_DATA_REQUIRED", status: "confirmed" });
    const result = enforceStatusForPolicy(item);
    expect(result.status).toBe("external_data_required");
  });

  it("純関数であり入力を変更しない", () => {
    const item = makeItem({ research_policy: "FACT_OR_HEARING", status: "inferred" as never });
    const original = { ...item };
    enforceStatusForPolicy(item);
    expect(item).toEqual(original);
  });
});

describe("sanitizeSourceIds (PR1 fresh review C: source_ids防御)", () => {
  it("存在するsource_idはそのまま保持する", () => {
    const item = makeItem({ source_ids: ["S01"] });
    const registry = [makeSource({ id: "S01" })];
    const result = sanitizeSourceIds(item, registry);
    expect(result.source_ids).toEqual(["S01"]);
  });

  it("Source Registryに存在しないsource_idを除去する (捏造ID対策)", () => {
    const item = makeItem({ source_ids: ["S01", "S99"] });
    const registry = [makeSource({ id: "S01" })];
    const result = sanitizeSourceIds(item, registry);
    expect(result.source_ids).toEqual(["S01"]);
    expect(result.warning).toContain("除去");
  });

  it("candidates内のsource_idsも同様にサニタイズする", () => {
    const item = makeItem({
      status: "conflict",
      source_ids: [],
      candidates: [
        makeCandidate({ candidate_id: "cand_a", source_ids: ["S01", "S99"] }),
      ],
    });
    const registry = [makeSource({ id: "S01" })];
    const result = sanitizeSourceIds(item, registry);
    expect(result.candidates?.[0]?.source_ids).toEqual(["S01"]);
  });

  it("除去対象が無ければ変更せず返す", () => {
    const item = makeItem({ source_ids: ["S01"] });
    const registry = [makeSource({ id: "S01" })];
    const result = sanitizeSourceIds(item, registry);
    expect(result).toBe(item); // 参照同一性
  });
});

describe("validateConflictShape (PR1 fresh review D)", () => {
  it("非conflict項目はcandidatesを持たない", () => {
    const item = makeItem({
      status: "confirmed",
      candidates: [makeCandidate()],
    });
    const result = validateConflictShape(item);
    expect(result.candidates).toBeUndefined();
  });

  it("conflictでcandidatesが空/欠落ならnot_foundへ降格する", () => {
    const item = makeItem({ status: "conflict", candidates: [] });
    const result = validateConflictShape(item);
    expect(result.status).toBe("not_found");
    expect(result.warning).toContain("無効化");
  });

  it("conflictでcandidatesが正常なら維持する", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [makeCandidate({ candidate_id: "cand_a" })],
    });
    const result = validateConflictShape(item);
    expect(result.status).toBe("conflict");
    expect(result.candidates).toHaveLength(1);
  });

  it("重複したcandidate_idを排除する (先勝ち)", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [
        makeCandidate({ candidate_id: "cand_a", value: "first" }),
        makeCandidate({ candidate_id: "cand_a", value: "second" }),
        makeCandidate({ candidate_id: "cand_b", value: "third" }),
      ],
    });
    const result = validateConflictShape(item);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates?.[0]?.value).toBe("first");
    expect(result.warning).toContain("重複");
  });
});

describe("validateResearchItemStatus (confirmed の deterministic validation)", () => {
  it("status!=='confirmed' の項目はそのまま返す", () => {
    const item = makeItem({ status: "inferred" });
    const result = validateResearchItemStatus(item, { sourceRegistry: [] });
    expect(result).toBe(item);
  });

  it("source_idsがurl_context_status=successのsourceを含む場合はconfirmedを維持する", () => {
    const item = makeItem({ source_ids: ["S01"] });
    const registry = [makeSource({ id: "S01", url_context_status: "success" })];
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).toBe("confirmed");
    expect(result.warning).toBeUndefined();
  });

  it("FACT項目: 検証済みsourceが無ければ not_found へ降格し、value/confidence/candidatesをnull化する(feat/ai-research-quality-refinement)", () => {
    const item = makeItem({
      research_policy: "FACT",
      source_ids: ["S01"],
      confidence: 80,
      candidates: [makeCandidate()],
    });
    const registry = [makeSource({ id: "S01", url_context_status: "error" })];
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).toBe("not_found");
    expect(result.warning).toContain("格下げ");
    expect(result.value).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.candidates).toBeUndefined();
    expect(result.evidence).toBe("Web上で確認できませんでした。"); // feat/ai-research-final-quality: 元evidenceの矛盾表現を残さない
  });

  it("ANALYSIS項目: 検証済みsourceが無ければ inferred へ降格し、value/confidence/evidenceは維持する(唯一の例外)", () => {
    const item = makeItem({ research_policy: "ANALYSIS", source_ids: ["S01"], confidence: 60 });
    const registry = [makeSource({ id: "S01", url_context_status: "not_attempted" })];
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).toBe("inferred");
    expect(result.value).toBe(item.value);
    expect(result.confidence).toBe(60);
    expect(result.evidence).toBe(item.evidence);
  });

  it("FACT_OR_HEARING項目: 検証済みsourceが無ければ hearing_required へ降格し、value/confidenceをnull化・evidenceを整合させる", () => {
    const item = makeItem({ research_policy: "FACT_OR_HEARING", source_ids: ["S01"], confidence: 70 });
    const registry = [makeSource({ id: "S01", url_context_status: "error" })];
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).toBe("hearing_required");
    expect(result.value).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.evidence).toBe("Web上の本人発信で確認できないため、営業時のヒアリングが必要です。");
  });

  it("Google Searchのみで見つかりURL Context未取得のsourceは根拠として使わない", () => {
    const item = makeItem({ source_ids: ["S01"] });
    const registry = [makeSource({ id: "S01", url_context_status: "not_attempted" })];
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).not.toBe("confirmed");
  });

  it("HEARING_ONLY項目は検証済みsourceがあっても無条件でhearing_requiredへ降格する", () => {
    const item = makeItem({
      key: "top_priority_issue",
      research_policy: "HEARING_ONLY",
      status: "confirmed",
      source_ids: ["S01"],
    });
    const registry = [makeSource({ id: "S01", url_context_status: "success" })];
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).toBe("hearing_required");
  });

  it("EXTERNAL_DATA_REQUIRED項目は検証済みsourceがあっても無条件でexternal_data_requiredへ降格する", () => {
    const item = makeItem({
      key: "search_volume",
      research_policy: "EXTERNAL_DATA_REQUIRED",
      status: "confirmed",
      source_ids: ["S01"],
    });
    const registry = [makeSource({ id: "S01", url_context_status: "success" })];
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).toBe("external_data_required");
  });

  describe("Tier B: reliable secondary evidence (feat/ai-research-quality-refinement、SearchFact必須へ厳格化)", () => {
    it("gourmet_siteのsourceは、key一致のSearchFactが無ければurl_context_status success無しではconfirmedを維持しない", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "error" }),
      ];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).not.toBe("confirmed");
    });

    it("gourmet_siteのsource + key一致のSearchFactがあればconfirmedを維持する", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "error" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "business_hours_holidays", value: "17:00-24:00" }],
      });
      expect(result.status).toBe("confirmed");
      expect(result.evidence_basis).toBe("search_note");
    });

    it("reservation_siteのsource + SearchFactも同様にconfirmedを維持する", () => {
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "reservation_site", url_context_status: "not_attempted" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "seat_count", value: "40席" }],
      });
      expect(result.status).toBe("confirmed");
    });

    it("SearchFactのkeyが対象itemのkeyと不一致なら維持されない", () => {
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "reservation_site", url_context_status: "not_attempted" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "business_hours_holidays", value: "17:00-24:00" }],
      });
      expect(result.status).not.toBe("confirmed");
    });

    it("対象外key(review_avg)はSearchFactがあってもSOURCE_TRUST_MATRIX未登録のため維持されない(Google評価の他媒体代用防止)", () => {
      const item = makeItem({ key: "review_avg", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "error" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "review_avg", value: "3.8" }],
      });
      expect(result.status).not.toBe("confirmed");
    });

    it("対象外key(review_count)も同様に維持されない", () => {
      const item = makeItem({
        key: "review_count",
        research_policy: "FACT",
        source_ids: ["S01"],
      });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "error" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "review_count", value: "120" }],
      });
      expect(result.status).not.toBe("confirmed");
    });

    it("対象keyでもsource_typeがSOURCE_TRUST_MATRIX許可外(例: competitor)なら維持されない", () => {
      const item = makeItem({ key: "average_spend_day_night", research_policy: "ANALYSIS", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "competitor", url_context_status: "error" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "average_spend_day_night", value: "4000円" }],
      });
      expect(result.status).not.toBe("confirmed");
    });

    it("opening_date(FACT、feat/ai-research-quality-refinementでFACT_OR_HEARINGから変更)もTier B対象keyとして扱われ、articleも許可source_typeに含む", () => {
      const item = makeItem({
        key: "opening_date",
        research_policy: "FACT",
        source_ids: ["S01"],
      });
      const registry = [
        makeSource({ id: "S01", source_type: "article", url_context_status: "not_attempted" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "opening_date", value: "2024年6月21日" }],
      });
      expect(result.status).toBe("confirmed");
    });

    it("media_coverageも他keyと同様、単なるarticleの存在だけではconfirmedにならない(v3で特例撤廃)", () => {
      const item = makeItem({ key: "media_coverage", research_policy: "FACT", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "article", url_context_status: "not_attempted" }),
      ];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).not.toBe("confirmed");
    });

    it("media_coverageはkey一致のSearchFactがあればconfirmedになる", () => {
      const item = makeItem({ key: "media_coverage", research_policy: "FACT", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "article", url_context_status: "not_attempted" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "media_coverage", value: "柏つうしんに開店記事掲載" }],
      });
      expect(result.status).toBe("confirmed");
    });
  });

  describe("evidence_basis (feat/ai-research-quality-refinement)", () => {
    it("url_context成功のみで維持された場合はurl_contextになる", () => {
      const item = makeItem({ source_ids: ["S01"] });
      const registry = [makeSource({ id: "S01", url_context_status: "success" })];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.evidence_basis).toBe("url_context");
    });

    it("placesVerifiedKeysのみで維持された場合はplacesになる", () => {
      const item = makeItem({ key: "review_avg", source_ids: [] });
      const result = validateResearchItemStatus(item, {
        sourceRegistry: [],
        placesVerifiedKeys: new Set(["review_avg"]),
      });
      expect(result.evidence_basis).toBe("places");
    });

    it("url_context成功とSearchFact一致の両方が該当する場合はmixedになる", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "success" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "business_hours_holidays", value: "17:00-24:00" }],
      });
      expect(result.evidence_basis).toBe("mixed");
    });

    it("confirmed以外のstatusではevidence_basisを付与しない", () => {
      const item = makeItem({ status: "inferred" });
      const result = validateResearchItemStatus(item, { sourceRegistry: [] });
      expect(result.evidence_basis).toBeUndefined();
    });
  });

  describe("placesVerifiedKeys (PR1 fresh review A: Places confirmed validation)", () => {
    it("placesVerifiedKeysに含まれるkeyはSource Registryが空でもconfirmedを維持する", () => {
      const item = makeItem({ key: "review_avg", source_ids: [] });
      const result = validateResearchItemStatus(item, {
        sourceRegistry: [],
        placesVerifiedKeys: new Set(["review_avg"]),
      });
      expect(result.status).toBe("confirmed");
    });

    it("placesVerifiedKeysに含まれないkeyは通常どおりsource_ids検証にフォールバックする", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S01"] });
      const registry = [makeSource({ id: "S01", url_context_status: "error" })];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        placesVerifiedKeys: new Set(["review_avg"]),
      });
      expect(result.status).toBe("not_found");
    });
  });
});

describe("applyDeterministicValidation (パイプライン統合)", () => {
  it("enforceResearchPolicy → sanitizeSourceIds → validateConflictShape → validateResearchItemStatus の順で適用される", () => {
    // market_demand の正しいpolicyはANALYSIS。誤ったFACTを返し、かつ捏造source_idを含む。
    const item = makeItem({
      key: "market_demand",
      research_policy: "FACT" as never,
      status: "confirmed",
      source_ids: ["S99"], // 捏造ID、sanitizeで除去される
    });
    const result = applyDeterministicValidation(item, { sourceRegistry: [] });

    // policy補正: ANALYSISへ
    expect(result.research_policy).toBe("ANALYSIS");
    // sanitizeでsource_ids除去 → confirmedの根拠なし → ANALYSISはinferredへ降格
    expect(result.status).toBe("inferred");
    expect(result.source_ids).toEqual([]);
  });

  it("Places検証済みかつpolicy誤りの項目も正しく処理する", () => {
    const item = makeItem({
      key: "review_avg",
      research_policy: "ANALYSIS" as never, // 本来はFACT
      status: "confirmed",
      source_ids: [],
    });
    const result = applyDeterministicValidation(item, {
      sourceRegistry: [],
      placesVerifiedKeys: new Set(["review_avg"]),
    });

    expect(result.research_policy).toBe("FACT");
    expect(result.status).toBe("confirmed"); // Places検証済みのため維持
  });

  it("enforceStatusForPolicyがenforceResearchPolicyの直後に適用される(owner_snsで発見された実バグの再発防止、feat/ai-research-quality-refinement)", () => {
    // owner_sns の正しいpolicyはFACT。AIがFACT_OR_HEARINGだと誤判断しstatus=hearing_requiredを
    // 返した場合、policy補正(FACTへ)の後もstatusがFACTの許容外(hearing_requiredはFACT非対応)
    // のまま残ってはいけない。
    const item = makeItem({
      key: "owner_sns",
      research_policy: "FACT_OR_HEARING" as never,
      status: "hearing_required" as never,
      value: null,
      source_ids: [],
    });
    const result = applyDeterministicValidation(item, { sourceRegistry: [] });

    expect(result.research_policy).toBe("FACT");
    expect(result.status).toBe("not_found"); // FACTの許容外statusはnot_foundへ補正
    expect(result.evidence).toBe("Web上で確認できませんでした。"); // owner_snsのevidence不整合バグの再発防止
  });
});

describe("pruneUnverifiedSourceIds (feat/ai-research-final-quality、Source IDノイズ除去)", () => {
  it("url_context成功・SearchFact一致いずれでもないsource_idを除去する", () => {
    const item = makeItem({
      status: "confirmed",
      source_ids: ["S01", "S02"], // S01=success(正当), S02=error(ノイズ)
    });
    const registry = [
      makeSource({ id: "S01", url_context_status: "success" }),
      makeSource({ id: "S02", url_context_status: "error" }),
    ];
    const result = pruneUnverifiedSourceIds(item, { sourceRegistry: registry });
    expect(result.source_ids).toEqual(["S01"]);
  });

  it("key一致のSearchFactがあるsource_idは除去しない(Tier B根拠として正当)", () => {
    const item = makeItem({ key: "seat_count", status: "confirmed", source_ids: ["S01"] });
    const registry = [makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "error" })];
    const result = pruneUnverifiedSourceIds(item, {
      sourceRegistry: registry,
      searchFacts: [{ sourceId: "S01", key: "seat_count", value: "40席" }],
    });
    expect(result.source_ids).toEqual(["S01"]);
  });

  it("全件が未検証の場合は除去しない(根拠が丸ごと消えるほうが不自然なため)", () => {
    const item = makeItem({ status: "confirmed", source_ids: ["S01"] });
    const registry = [makeSource({ id: "S01", url_context_status: "error" })];
    const result = pruneUnverifiedSourceIds(item, { sourceRegistry: registry });
    expect(result.source_ids).toEqual(["S01"]);
  });

  it("candidates内のsource_idsも同様に刈り込む", () => {
    const item = makeItem({
      status: "conflict",
      source_ids: [],
      candidates: [makeCandidate({ source_ids: ["S01", "S02"] })],
    });
    const registry = [
      makeSource({ id: "S01", url_context_status: "success" }),
      makeSource({ id: "S02", url_context_status: "not_attempted" }),
    ];
    const result = pruneUnverifiedSourceIds(item, { sourceRegistry: registry });
    expect(result.candidates?.[0]?.source_ids).toEqual(["S01"]);
  });

  it("applyDeterministicValidationのパイプラインに組み込まれている(exterior_interiorでの実例再現)", () => {
    const item = makeItem({
      key: "exterior_interior",
      research_policy: "ANALYSIS",
      status: "confirmed",
      source_ids: ["S01", "S10"], // S10はurl_context失敗の無関係page(求人ページ等)
    });
    const registry = [
      makeSource({ id: "S01", url_context_status: "success" }),
      makeSource({ id: "S10", source_type: "other", url_context_status: "error" }),
    ];
    const result = applyDeterministicValidation(item, { sourceRegistry: registry });
    expect(result.status).toBe("confirmed");
    expect(result.source_ids).toEqual(["S01"]); // S10のノイズが除去される
  });
});

describe("validateResearchItems (一括適用)", () => {
  it("複数項目へ一括適用する", () => {
    const items = [
      makeItem({ key: "business_hours_holidays", research_policy: "FACT", source_ids: ["S01"] }),
      makeItem({ key: "market_demand", research_policy: "ANALYSIS", source_ids: ["S02"] }),
    ];
    const registry = [
      makeSource({ id: "S01", url_context_status: "success" }),
      makeSource({ id: "S02", url_context_status: "error" }),
    ];

    const result = validateResearchItems(items, { sourceRegistry: registry });

    expect(result[0]!.status).toBe("confirmed");
    expect(result[1]!.status).toBe("inferred");
  });
});

/* ------------------------------------------------------------------ */
/*  PoC で確認された4件の品質問題の回帰防止 (Plan v3.2 §2, PR1 fresh review) */
/* ------------------------------------------------------------------ */

describe("PoC品質問題の回帰防止テスト", () => {
  it("(1) 予約ページ存在だけの弱い根拠(URL Context未検証)ではcompetitor_paid_adsをconfirmedにしない", () => {
    const item = makeItem({
      key: "competitor_paid_ads",
      research_policy: "ANALYSIS" as never,
      status: "confirmed",
      value: "有料広告活用あり",
      source_ids: ["S01"],
    });
    // Stage1で発見されただけでURL Context未取得(弱い根拠)
    const registry = [makeSource({ id: "S01", url_context_status: "not_attempted" })];
    const result = applyDeterministicValidation(item, { sourceRegistry: registry });

    expect(result.status).not.toBe("confirmed");
    expect(result.status).toBe("inferred"); // ANALYSISの降格先
  });

  it("(2) 満席情報のみ(URL Context未検証)ではmarket_demandをconfirmedにしない", () => {
    const item = makeItem({
      key: "market_demand",
      research_policy: "ANALYSIS" as never,
      status: "confirmed",
      value: "非常に高い",
      source_ids: ["S01"],
    });
    const registry = [makeSource({ id: "S01", url_context_status: "not_attempted" })];
    const result = applyDeterministicValidation(item, { sourceRegistry: registry });

    expect(result.status).not.toBe("confirmed");
  });

  it("(3) review_avg/review_countはSource RegistryではなくPlaces検証経路でのみconfirmedになる", () => {
    // Web sourceのみでconfirmedを主張した場合(Rettyの評価点混入等)は、
    // placesVerifiedKeysに含まれない限りWeb由来のsource_idsで確認が必要。
    const item = makeItem({
      key: "review_avg",
      research_policy: "FACT",
      status: "confirmed",
      source_ids: ["S01"], // Web上の(信頼できない)出典のみ
    });
    const registry = [makeSource({ id: "S01", url_context_status: "not_attempted" })];
    const result = applyDeterministicValidation(item, {
      sourceRegistry: registry,
      // placesVerifiedKeysに review_avg が含まれていない = Places再同期未実施/未確認
      placesVerifiedKeys: new Set(),
    });

    expect(result.status).not.toBe("confirmed");
  });

  it("(4) 外部情報からのtop_priority_issue推定は正しいpolicy(HEARING_ONLY)へ強制され、confirmedにならない", () => {
    const item = makeItem({
      key: "top_priority_issue",
      research_policy: "ANALYSIS" as never, // AIが誤って自己申告
      status: "confirmed" as never, // AIが誤って断定
      value: "Web予約導入が必要",
      source_ids: ["S01"],
    });
    const registry = [makeSource({ id: "S01", url_context_status: "success" })];
    const result = applyDeterministicValidation(item, { sourceRegistry: registry });

    // research_policyがHEARING_ONLYへ強制される
    expect(result.research_policy).toBe("HEARING_ONLY");
    // HEARING_ONLYへ補正された時点でも status はまだ "confirmed" のままここに来るため、
    // validateResearchItemStatus の降格ロジック(HEARING_ONLY → hearing_required)が働く。
    expect(result.status).toBe("hearing_required");
  });
});
