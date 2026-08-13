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
  enforceStatusValueInvariant,
  sanitizeSourceIds,
  validateConflictShape,
  validateConflictCandidateTrust,
  isVerifiedSourceForItem,
  validateResearchItemStatus,
  applyDeterministicValidation,
  pruneUnverifiedSourceIds,
  validateResearchItems,
  validateFinalResearchResultIntegrity,
  sortResearchItemsToCanonicalOrder,
  deriveTrustedSourceType,
  deriveDisplaySourceName,
  deriveDowngradeReason,
  isSourceLinkClickable,
  flagEvidenceSourceIdMismatch,
  type ResearchItem,
  type ResearchItemCandidate,
  type SourceRegistryEntry,
  type ReviewDecision,
} from "../research-result-schema";
import { RESEARCH_POLICY_ITEMS } from "@/lib/domain/research-policy";

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
    // fix/ai-research-source-identity-integrity: 既存テストの大半は
    // 「url_context成功=対象店舗のページ」という(修正前は正しかった)前提で書かれて
    // いるため、デフォルトをtarget_matchにして既存の意図を保つ。identity_status
    // ゲート自体を検証するテストは明示的にoverrideする。
    identity_status: "target_match",
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

  it("conflictでcandidatesが2件以上・異なる値なら維持する", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [
        makeCandidate({ candidate_id: "cand_a", value: "17:00-24:00" }),
        makeCandidate({ candidate_id: "cand_b", value: "18:00-23:00" }),
      ],
    });
    const result = validateConflictShape(item);
    expect(result.status).toBe("conflict");
    expect(result.candidates).toHaveLength(2);
  });

  it("candidatesが1件のみならconflict維持できずnot_foundへ降格する(feat/ai-research-pre-smoke-hardening、MAJOR4)", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [makeCandidate({ candidate_id: "cand_a" })],
    });
    const result = validateConflictShape(item);
    expect(result.status).toBe("not_found");
    expect(result.candidates).toBeUndefined();
  });

  it("candidatesが2件以上でも全て同一valueなら実質的な競合ではないためnot_foundへ降格する(MAJOR4)", () => {
    const item = makeItem({
      status: "conflict",
      candidates: [
        makeCandidate({ candidate_id: "cand_a", value: "17:00-24:00" }),
        makeCandidate({ candidate_id: "cand_b", value: "17:00-24:00" }),
      ],
    });
    const result = validateConflictShape(item);
    expect(result.status).toBe("not_found");
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

  describe("Tier B: reliable secondary evidence (feat/ai-research-quality-refinement、SearchFact必須へ厳格化。feat/ai-research-pre-smoke-hardeningでtrust origin(known_store_data/hostname classifierのみ)・value canonicalization・conflicting facts guardを追加)", () => {
    it("gourmet_siteのsourceは、key一致のSearchFactが無ければurl_context_status success無しではconfirmedを維持しない", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S01"] });
      const registry = [
        makeSource({
          id: "S01",
          source_type: "gourmet_site",
          discovery_provenance: "known_store_data",
          url_context_status: "error",
        }),
      ];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).not.toBe("confirmed");
    });

    it("known_store_data由来のgourmet_siteのsource + key一致のSearchFactがあればconfirmedを維持し、valueをSearchFact側へ寄せる(BLOCKER3)", () => {
      const item = makeItem({
        key: "business_hours_holidays",
        source_ids: ["S01"],
        value: "AIが誤って報告した値",
      });
      const registry = [
        makeSource({
          id: "S01",
          source_type: "gourmet_site",
          discovery_provenance: "known_store_data",
          url_context_status: "error",
        }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "business_hours_holidays", value: "17:00-24:00" }],
      });
      expect(result.status).toBe("confirmed");
      expect(result.evidence_basis).toBe("search_note");
      // AIの自由記述valueではなく、SearchFact側の値がcanonicalとして採用される。
      expect(result.value).toBe("17:00-24:00");
    });

    it("hostname classifierで既知ポータルと判定できるsource(例: tabelog.com)でも、discovery_provenanceがgemini_search_candidate(第三者・known_store_data以外)ならTier Bでconfirmedにしない(fix/ai-research-source-identity-integrity、FIX6で方針変更)", () => {
      // 実機smoke事故の教訓: hotpepper.jp等の信頼済みhostnameであっても、実際に
      // 指しているページが対象店舗のものである保証はURL Context本文取得+
      // source_verificationsによる識別確認を経なければ得られない。SearchFactのみ
      // (URL Context本文取得を経ていない)第三者sourceは、hostname trustがあっても
      // target項目のconfirmedの根拠として使わない方針へ変更した(旧MAJOR6のTier B
      // 許容は撤回、known_store_dataのみ引き続き許容)。
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01"] });
      const registry = [
        makeSource({
          id: "S01",
          grounding_redirect_url: "https://tabelog.com/kanagawa/A1401/A140103/14012345/",
          source_type: "gourmet_site",
          discovery_provenance: "gemini_search_candidate",
          url_context_status: "not_attempted",
        }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "seat_count", value: "40席" }],
      });
      expect(result.status).toBe("not_found");
    });

    it("既知hostnameでもknown_store_dataでもない自己申告sourceはTier B対象にならない(MAJOR6・追加修正B: google_groundingでもモデル自己申告typeのみでは信用しない)", () => {
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01"] });
      const registry = [
        makeSource({
          id: "S01",
          // vertexaisearch.cloud.google.com のgrounding-redirect URL(既知hostnameではない)。
          grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
          source_type: "gourmet_site", // モデルの自己申告
          discovery_provenance: "google_grounding",
          url_context_status: "not_attempted",
        }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "seat_count", value: "40席" }],
      });
      expect(result.status).not.toBe("confirmed");
    });

    it("同一keyについて信頼済みSearchFactの値が矛盾する場合はconfirmedにしない(追加修正C: false positiveよりfalse negativeを優先)", () => {
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01", "S02"] });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", discovery_provenance: "known_store_data" }),
        makeSource({ id: "S02", source_type: "reservation_site", discovery_provenance: "known_store_data" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [
          { sourceId: "S01", key: "seat_count", value: "40席" },
          { sourceId: "S02", key: "seat_count", value: "60席" },
        ],
      });
      expect(result.status).not.toBe("confirmed");
    });

    it("同一keyについて信頼済みSearchFactの値が一致していれば(複数sourceでも)confirmedを維持する", () => {
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01", "S02"] });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", discovery_provenance: "known_store_data" }),
        makeSource({ id: "S02", source_type: "reservation_site", discovery_provenance: "known_store_data" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [
          { sourceId: "S01", key: "seat_count", value: "40席" },
          { sourceId: "S02", key: "seat_count", value: "40席" },
        ],
      });
      expect(result.status).toBe("confirmed");
      expect(result.value).toBe("40席");
    });

    it("reservation_siteのsource + SearchFactも同様にconfirmedを維持する", () => {
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01"] });
      const registry = [
        makeSource({
          id: "S01",
          source_type: "reservation_site",
          discovery_provenance: "known_store_data",
          url_context_status: "not_attempted",
        }),
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
        makeSource({
          id: "S01",
          source_type: "reservation_site",
          discovery_provenance: "known_store_data",
          url_context_status: "not_attempted",
        }),
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
        makeSource({ id: "S01", source_type: "gourmet_site", discovery_provenance: "known_store_data" }),
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
        makeSource({ id: "S01", source_type: "gourmet_site", discovery_provenance: "known_store_data" }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "review_count", value: "120" }],
      });
      expect(result.status).not.toBe("confirmed");
    });

    it("average_spend_day_night(複合的なANALYSIS項目)はTier B対象から除外されている(追加修正C: 単一SearchFactでAIの複合valueを置き換えない)", () => {
      const item = makeItem({ key: "average_spend_day_night", research_policy: "ANALYSIS", source_ids: ["S01"] });
      const registry = [
        makeSource({ id: "S01", source_type: "gourmet_site", discovery_provenance: "known_store_data" }),
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
        makeSource({
          id: "S01",
          source_type: "article",
          discovery_provenance: "known_store_data",
          url_context_status: "not_attempted",
        }),
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
        makeSource({
          id: "S01",
          source_type: "article",
          discovery_provenance: "known_store_data",
          url_context_status: "not_attempted",
        }),
      ];
      const result = validateResearchItemStatus(item, {
        sourceRegistry: registry,
        searchFacts: [{ sourceId: "S01", key: "media_coverage", value: "柏つうしんに開店記事掲載" }],
      });
      expect(result.status).toBe("confirmed");
    });
  });

  describe("FACT_OR_HEARING primary-source enforcement (feat/ai-research-pre-smoke-hardening、MAJOR5・追加修正A)", () => {
    it("owner_profileは第三者gourmet_siteの本文取得成功だけではconfirmedを維持しない(本人発信ではないため)", () => {
      const item = makeItem({ key: "owner_profile", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
      const registry = [makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "success" })];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).not.toBe("confirmed");
    });

    it("owner_profileはarticleの本文取得成功だけでもconfirmedを維持しない(articleを本人発信とみなさない、追加修正A)", () => {
      const item = makeItem({ key: "owner_profile", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
      const registry = [makeSource({ id: "S01", source_type: "article", url_context_status: "success" })];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).not.toBe("confirmed");
    });

    it("owner_profileはknown_store_dataのofficial_siteの本文取得成功ならconfirmedを維持する", () => {
      // 信頼できる一次情報の唯一の経路。`buildKnownStoreDataUrls`が`stores.site_url`へ
      // app側で`official_site`を付与するため、`deriveTrustedSourceType`が信頼済みtypeを返す。
      const item = makeItem({ key: "owner_profile", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
      const registry = [
        makeSource({
          id: "S01",
          source_type: "official_site",
          discovery_provenance: "known_store_data",
          url_context_status: "success",
        }),
      ];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).toBe("confirmed");
    });

    it("owner_philosophy/owner_career/conceptも同様にofficial_sns等の一次情報以外では維持しない", () => {
      for (const key of ["owner_career", "owner_philosophy", "concept"]) {
        const item = makeItem({ key, research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
        const registry = [makeSource({ id: "S01", source_type: "gourmet_site", url_context_status: "success" })];
        const result = validateResearchItemStatus(item, { sourceRegistry: registry });
        expect(result.status).not.toBe("confirmed");
      }
    });

    describe("一次情報判定はモデル自己申告のsource_typeを信用しない(PR #180 review Finding 1)", () => {
      // `gemini_search_candidate`/`google_grounding`の`source_type`はStage1モデルが
      // `[SOURCE]`ブロックで自己申告した値。これを直接見ると、モデルが任意のURLに
      // `type: official_site`と付けるだけで「本人発信の一次情報」を偽装でき、
      // `deriveTrustedSourceType`が設けたtrust boundaryを迂回できてしまう。
      it("自己申告official_site(gemini_search_candidate)はurl_context成功+target_matchでも維持しない", () => {
        for (const key of ["owner_profile", "owner_career", "owner_philosophy", "concept"]) {
          const item = makeItem({ key, research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
          const registry = [
            makeSource({
              id: "S01",
              source_type: "official_site",
              discovery_provenance: "gemini_search_candidate",
              url_context_status: "success",
              identity_status: "target_match",
            }),
          ];
          const result = validateResearchItemStatus(item, { sourceRegistry: registry });
          expect(result.status).not.toBe("confirmed");
        }
      });

      it("自己申告official_sns(google_grounding)も同様に維持しない", () => {
        const item = makeItem({ key: "owner_philosophy", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
        const registry = [
          makeSource({
            id: "S01",
            source_type: "official_sns",
            discovery_provenance: "google_grounding",
            url_context_status: "success",
            identity_status: "target_match",
          }),
        ];
        expect(validateResearchItemStatus(item, { sourceRegistry: registry }).status).not.toBe("confirmed");
      });

      it("known_store_dataのofficial_snsは維持する(正当な一次情報経路を壊さない)", () => {
        const item = makeItem({ key: "concept", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
        const registry = [
          makeSource({
            id: "S01",
            source_type: "official_sns",
            discovery_provenance: "known_store_data",
            url_context_status: "success",
          }),
        ];
        expect(validateResearchItemStatus(item, { sourceRegistry: registry }).status).toBe("confirmed");
      });

      it("既知hostname(tabelog)は決定的に判定できてもgourmet_siteなので一次情報にはならない", () => {
        const item = makeItem({ key: "owner_career", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] });
        const registry = [
          makeSource({
            id: "S01",
            source_type: "official_site",
            grounding_redirect_url: "https://tabelog.com/chiba/A1203/A120302/12000000/",
            discovery_provenance: "gemini_search_candidate",
            url_context_status: "success",
          }),
        ];
        expect(validateResearchItemStatus(item, { sourceRegistry: registry }).status).not.toBe("confirmed");
      });

      it("一次情報必須でない項目は自己申告source_typeのままconfirmedを維持できる(通常URL Context経路の回帰防止)", () => {
        const item = makeItem({ key: "business_hours_holidays", source_ids: ["S01"] });
        const registry = [
          makeSource({
            id: "S01",
            source_type: "gourmet_site",
            discovery_provenance: "gemini_search_candidate",
            url_context_status: "success",
            identity_status: "target_match",
          }),
        ];
        expect(validateResearchItemStatus(item, { sourceRegistry: registry }).status).toBe("confirmed");
      });
    });
  });

  describe("competitor sourceの除外 (feat/ai-research-pre-smoke-hardening、MAJOR8)", () => {
    it("source_type=competitorの本文取得成功は自店FACT項目のconfirmed根拠にならない", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S01"] });
      const registry = [makeSource({ id: "S01", source_type: "competitor", url_context_status: "success" })];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).not.toBe("confirmed");
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
        makeSource({
          id: "S01",
          source_type: "gourmet_site",
          discovery_provenance: "known_store_data",
          url_context_status: "success",
        }),
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

  describe("identity_status gate (fix/ai-research-source-identity-integrity、実機smoke事故の修正)", () => {
    it("CASE A(実機smoke事故の再現): url_context成功済みでもidentity_status=unrelated(誤ったHotPepper URL)ならconfirmedを維持しない", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S04"] });
      const registry = [
        makeSource({
          id: "S04",
          title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ",
          grounding_redirect_url: "https://www.hotpepper.jp/strJ003828751/",
          source_type: "gourmet_site",
          url_context_status: "success",
          identity_status: "unrelated",
        }),
      ];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).toBe("not_found");
    });

    it("CASE B: url_context成功済み + identity_status=target_match(正しいHotPepper URL)ならconfirmedを維持する", () => {
      const item = makeItem({ key: "business_hours_holidays", source_ids: ["S04"] });
      const registry = [
        makeSource({
          id: "S04",
          grounding_redirect_url: "https://www.hotpepper.jp/strJ003807133/",
          source_type: "gourmet_site",
          url_context_status: "success",
          identity_status: "target_match",
        }),
      ];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).toBe("confirmed");
    });

    it("url_context成功済みでもidentity_status=uncertainならconfirmedを維持しない", () => {
      const item = makeItem({ source_ids: ["S01"] });
      const registry = [makeSource({ url_context_status: "success", identity_status: "uncertain" })];
      const result = validateResearchItemStatus(item, { sourceRegistry: registry });
      expect(result.status).toBe("not_found");
    });

    it("url_context成功済みでもidentity_statusが未設定(not_checked、既存runとの後方互換)ならconfirmedを維持しない", () => {
      const item = makeItem({ source_ids: ["S01"] });
      const entry = makeSource({ url_context_status: "success" });
      delete entry.identity_status;
      const result = validateResearchItemStatus(item, { sourceRegistry: [entry] });
      expect(result.status).toBe("not_found");
    });

    it("competitor調査項目(competitor_stores等)はidentity_status=target_matchではなくcompetitor_matchを要求する", () => {
      const item = makeItem({
        key: "competitor_stores",
        research_policy: "ANALYSIS",
        source_ids: ["S01"],
      });
      const targetMatchOnly = makeSource({ url_context_status: "success", identity_status: "target_match" });
      const targetMatchResult = validateResearchItemStatus(item, { sourceRegistry: [targetMatchOnly] });
      expect(targetMatchResult.status).not.toBe("confirmed"); // target_matchだけでは競合項目のconfirmed根拠にならない

      const competitorMatch = makeSource({ url_context_status: "success", identity_status: "competitor_match" });
      const competitorResult = validateResearchItemStatus(item, { sourceRegistry: [competitorMatch] });
      expect(competitorResult.status).toBe("confirmed");
    });

    it("商圏・市場等の文脈許容項目(trade_area等)はtarget_match/contextualいずれも根拠として認める", () => {
      const item = makeItem({ key: "trade_area", research_policy: "ANALYSIS", source_ids: ["S01"] });

      const contextual = makeSource({ url_context_status: "success", identity_status: "contextual" });
      expect(validateResearchItemStatus(item, { sourceRegistry: [contextual] }).status).toBe("confirmed");

      const targetMatch = makeSource({ url_context_status: "success", identity_status: "target_match" });
      expect(validateResearchItemStatus(item, { sourceRegistry: [targetMatch] }).status).toBe("confirmed");

      const competitorMatch = makeSource({ url_context_status: "success", identity_status: "competitor_match" });
      expect(validateResearchItemStatus(item, { sourceRegistry: [competitorMatch] }).status).not.toBe("confirmed");
    });

    it("第三者(known_store_data以外)のSearchFact-onlyはtarget FACTのconfirmedに使わない(FIX6、known_store_dataのみ引き続き許容)", () => {
      const item = makeItem({ key: "seat_count", research_policy: "FACT", source_ids: ["S01"] });

      const thirdParty = makeSource({
        id: "S01",
        grounding_redirect_url: "https://tabelog.com/x/y/z/",
        source_type: "gourmet_site",
        discovery_provenance: "gemini_search_candidate",
        url_context_status: "not_attempted",
      });
      const thirdPartyResult = validateResearchItemStatus(item, {
        sourceRegistry: [thirdParty],
        searchFacts: [{ sourceId: "S01", key: "seat_count", value: "40席" }],
      });
      expect(thirdPartyResult.status).toBe("not_found");

      const knownStoreData = makeSource({
        id: "S01",
        source_type: "gourmet_site",
        discovery_provenance: "known_store_data",
        url_context_status: "not_attempted",
      });
      const knownStoreDataResult = validateResearchItemStatus(item, {
        sourceRegistry: [knownStoreData],
        searchFacts: [{ sourceId: "S01", key: "seat_count", value: "40席" }],
      });
      expect(knownStoreDataResult.status).toBe("confirmed");
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

describe("enforceStatusValueInvariant (feat/ai-research-pre-smoke-hardening、MAJOR4)", () => {
  it("AIが最初からno-info statusにvalueを付けて返した場合もnull化する(遷移を経由しなくても正規化される)", () => {
    const item = makeItem({ status: "not_found", value: "17:00-24:00", confidence: 90 });
    const result = enforceStatusValueInvariant(item);
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("hearing_requiredに最初からvalueが付いていてもnull化する", () => {
    const item = makeItem({ status: "hearing_required", value: "推測値", research_policy: "FACT_OR_HEARING" });
    const result = enforceStatusValueInvariant(item);
    expect(result.value).toBeNull();
  });

  it("external_data_requiredに最初からvalueが付いていてもnull化する", () => {
    const item = makeItem({
      status: "external_data_required",
      value: "推測値",
      research_policy: "EXTERNAL_DATA_REQUIRED",
    });
    const result = enforceStatusValueInvariant(item);
    expect(result.value).toBeNull();
  });

  it("既にnull化済みのno-info statusは変更しない(参照同一性)", () => {
    const item = makeItem({ status: "not_found", value: null, confidence: null, candidates: undefined });
    const result = enforceStatusValueInvariant(item);
    expect(result).toBe(item);
  });

  it("confirmedなのにvalueが空文字ならpolicyごとの安全なno-infoステータスへ降格する", () => {
    const item = makeItem({ status: "confirmed", value: "   ", research_policy: "FACT" });
    const result = enforceStatusValueInvariant(item);
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
  });

  it("inferredなのにvalueがnullならANALYSISはnot_foundへ降格する", () => {
    const item = makeItem({ status: "inferred", value: null, research_policy: "ANALYSIS" });
    const result = enforceStatusValueInvariant(item);
    expect(result.status).toBe("not_found");
  });

  it("confirmed/inferredでvalueが正しく非空ならそのまま返す", () => {
    const item = makeItem({ status: "confirmed", value: "17:00-24:00" });
    const result = enforceStatusValueInvariant(item);
    expect(result).toBe(item);
  });

  it("conflictは変更しない(validateConflictShapeが別途形状を保証するため)", () => {
    const item = makeItem({
      status: "conflict",
      value: null,
      candidates: [makeCandidate({ candidate_id: "a" }), makeCandidate({ candidate_id: "b", value: "x" })],
    });
    const result = enforceStatusValueInvariant(item);
    expect(result).toBe(item);
  });
});

describe("deriveTrustedSourceType (feat/ai-research-pre-smoke-hardening、MAJOR6・追加修正B)", () => {
  it("known_store_data由来ならsource_typeをそのまま信頼する", () => {
    const entry = makeSource({ discovery_provenance: "known_store_data", source_type: "official_site" });
    expect(deriveTrustedSourceType(entry)).toBe("official_site");
  });

  it("既知hostname(tabelog.com)ならdiscovery_provenanceに関わらずhostname classifierの結果を信頼する", () => {
    const entry = makeSource({
      discovery_provenance: "gemini_search_candidate",
      grounding_redirect_url: "https://tabelog.com/x/y/z",
      source_type: "other", // 自己申告typeが違っていてもhostname classifierを優先
    });
    expect(deriveTrustedSourceType(entry)).toBe("gourmet_site");
  });

  it("google_grounding由来でも既知hostnameでなければ自己申告typeを信頼しない(undefined)", () => {
    const entry = makeSource({
      discovery_provenance: "google_grounding",
      grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
      source_type: "gourmet_site",
    });
    expect(deriveTrustedSourceType(entry)).toBeUndefined();
  });

  it("gemini_search_candidateで未知hostnameならundefined", () => {
    const entry = makeSource({
      discovery_provenance: "gemini_search_candidate",
      grounding_redirect_url: "https://unknown-blog.example.com/post/1",
      source_type: "gourmet_site",
    });
    expect(deriveTrustedSourceType(entry)).toBeUndefined();
  });
});

describe("deriveDisplaySourceName (fix/ai-research-source-identity-integrity、FIX9)", () => {
  it("known_store_dataはentry.title(アプリ自身が付けた固定文言)をそのまま使う", () => {
    const entry = makeSource({
      discovery_provenance: "known_store_data",
      title: "公式サイト(登録情報)",
      grounding_redirect_url: "https://example-store.example.com/",
    });
    expect(deriveDisplaySourceName(entry)).toBe("公式サイト(登録情報)");
  });

  it("既知hostname(hotpepper.jp)なら固定の表示名を返し、モデル自己申告titleは使わない(実機smoke事故の再発防止)", () => {
    const entry = makeSource({
      discovery_provenance: "gemini_search_candidate",
      title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ", // 実際には別店舗のtitleだった
      grounding_redirect_url: "https://www.hotpepper.jp/strJ003828751/",
    });
    expect(deriveDisplaySourceName(entry)).toBe("ホットペッパーグルメ");
  });

  it("未知hostnameならhostname文字列そのものを返す(モデル自己申告titleは使わない)", () => {
    const entry = makeSource({
      discovery_provenance: "gemini_search_candidate",
      title: "何らかのブログ記事",
      grounding_redirect_url: "https://unknown-blog.example.com/post/1",
    });
    expect(deriveDisplaySourceName(entry)).toBe("unknown-blog.example.com");
  });

  it("既知hostname(gnavi.co.jp)なら固定の表示名を返す", () => {
    const entry = makeSource({
      discovery_provenance: "gemini_search_candidate",
      title: "楽天ぐるなびの店舗ページ",
      grounding_redirect_url: "https://r.gnavi.co.jp/a740702/",
    });
    expect(deriveDisplaySourceName(entry)).toBe("楽天ぐるなび");
  });

  describe("grounding redirect transport host(実機Preview検証、2026-08-07で発見)", () => {
    // makeSource()のデフォルトgrounding_redirect_urlはvertexaisearch.cloud.google.comの
    // redirect URL(実際のStage1出力の大半がこの形式)。既存3テストは全てこのデフォルトを
    // 上書きしていたため、このバグはテストで検出されていなかった。
    it("target_matchで確認済み・titleが有効ならtitleへfallbackし、transport hostnameを返さない", () => {
      const entry = makeSource({
        title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ",
        identity_status: "target_match",
        // grounding_redirect_urlはmakeSource()のデフォルト(vertexaisearch redirect)のまま。
      });
      const result = deriveDisplaySourceName(entry);
      expect(result).toBe("東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ");
      expect(result).not.toContain("vertexaisearch.cloud.google.com");
    });

    it("competitor_matchで確認済みならtitleへfallbackする", () => {
      const entry = makeSource({
        title: "競合店の公式ページ",
        identity_status: "competitor_match",
      });
      expect(deriveDisplaySourceName(entry)).toBe("競合店の公式ページ");
    });

    it("contextualで確認済みならtitleへfallbackする", () => {
      const entry = makeSource({
        title: "エリア特集記事",
        identity_status: "contextual",
      });
      expect(deriveDisplaySourceName(entry)).toBe("エリア特集記事");
    });

    it.each(["uncertain", "unrelated", "not_checked"] as const)(
      "identity_status=%sの未確認sourceはtitleを無条件採用せず、transport hostnameも返さない",
      (identityStatus) => {
        const entry = makeSource({
          title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ",
          identity_status: identityStatus,
        });
        const result = deriveDisplaySourceName(entry);
        expect(result).not.toBe("vertexaisearch.cloud.google.com");
        expect(result).not.toContain("東北メシ");
      },
    );

    it("identity_status未設定(既存runとの後方互換)でもtitleを無条件採用しない", () => {
      const entry = makeSource({
        title: "東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ",
        identity_status: undefined,
      });
      const result = deriveDisplaySourceName(entry);
      expect(result).not.toBe("vertexaisearch.cloud.google.com");
      expect(result).not.toContain("東北メシ");
    });

    it("target_matchだがtitleが空文字の場合もtransport hostnameを返さない", () => {
      const entry = makeSource({ title: "", identity_status: "target_match" });
      const result = deriveDisplaySourceName(entry);
      expect(result).not.toBe("vertexaisearch.cloud.google.com");
    });

    it("resolved_urlがtransport hostでも同様にtitleへfallbackする(target_match時)", () => {
      const entry = makeSource({
        title: "本文中で確認できたページタイトル",
        identity_status: "target_match",
        resolved_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
        grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
      });
      expect(deriveDisplaySourceName(entry)).toBe("本文中で確認できたページタイトル");
    });
  });
});

describe("isSourceLinkClickable (fix/ai-research-source-identity-integrity、FIX8)", () => {
  it("known_store_dataは常にクリック可能", () => {
    const entry = makeSource({ discovery_provenance: "known_store_data" });
    expect(isSourceLinkClickable(entry)).toBe(true);
  });

  it("identity_status=target_match/competitor_match/contextualはクリック可能", () => {
    for (const status of ["target_match", "competitor_match", "contextual"] as const) {
      const entry = makeSource({ discovery_provenance: "gemini_search_candidate", identity_status: status });
      expect(isSourceLinkClickable(entry)).toBe(true);
    }
  });

  it("identity_status=unrelated/uncertain/未設定(not_checked)はクリック不可(実機smoke事故: 誤ったURLへユーザーを誘導しない)", () => {
    for (const status of ["unrelated", "uncertain", undefined] as const) {
      const entry = makeSource({ discovery_provenance: "gemini_search_candidate", identity_status: status });
      expect(isSourceLinkClickable(entry)).toBe(false);
    }
  });
});

describe("flagEvidenceSourceIdMismatch (fix/ai-research-source-identity-integrity、FIX11)", () => {
  it("evidence本文に含まれるsource ID表記がsource_idsに存在しなければwarningを付与する", () => {
    const item = makeItem({ evidence: "S05ぐるなびによると4,000円です", source_ids: ["S01"] });
    const result = flagEvidenceSourceIdMismatch(item);
    expect(result.warning).toContain("evidence内の出典表記");
  });

  it("evidence本文のsource ID表記がsource_idsに含まれていればwarningを付与しない", () => {
    const item = makeItem({ evidence: "S01ぐるなびによると4,000円です", source_ids: ["S01"] });
    const result = flagEvidenceSourceIdMismatch(item);
    expect(result.warning).toBeUndefined();
  });

  it("evidence本文にsource ID表記が無ければ何もしない(通常ケース)", () => {
    const item = makeItem({ evidence: "公式サイトに明記", source_ids: ["S01"] });
    const result = flagEvidenceSourceIdMismatch(item);
    expect(result).toBe(item);
  });
});

describe("validateFinalResearchResultIntegrity (feat/ai-research-pre-smoke-hardening、BLOCKER1)", () => {
  function fullValidItems(): ResearchItem[] {
    return RESEARCH_POLICY_ITEMS.map((p) => ({
      key: p.key,
      research_policy: p.research_policy,
      status: "not_found" as const,
      value: null,
      evidence: "e",
      source_ids: [],
    }));
  }

  it("RESEARCH_POLICY_ITEMSと件数・key集合が完全一致すれば違反なし(null)", () => {
    expect(validateFinalResearchResultIntegrity(fullValidItems())).toBeNull();
  });

  it("件数不足(1件欠落)はitem_count_mismatchまたはkey_set_mismatchを返す", () => {
    const items = fullValidItems().slice(1);
    const violation = validateFinalResearchResultIntegrity(items);
    expect(violation).not.toBeNull();
    expect(["item_count_mismatch", "key_set_mismatch"]).toContain(violation?.kind);
  });

  it("keyの重複はduplicate_keyを返す", () => {
    const items = fullValidItems();
    items.push({ ...items[0]! });
    const violation = validateFinalResearchResultIntegrity(items);
    expect(violation?.kind).toBe("duplicate_key");
  });

  it("未知keyが混入していればunknown_keyを返す", () => {
    const items = fullValidItems();
    items[0] = { ...items[0]!, key: "not_a_real_key" };
    const violation = validateFinalResearchResultIntegrity(items);
    expect(violation?.kind).toBe("unknown_key");
  });
});

describe("sortResearchItemsToCanonicalOrder (feat/ai-research-pre-smoke-hardening、BLOCKER1)", () => {
  it("RESEARCH_POLICY_ITEMSの並び順へソートする(モデル出力順に依存しない)", () => {
    const shuffled = [
      makeItem({ key: "phone" }), // category_1_basicの末尾付近
      makeItem({ key: "store_name" }), // category_1_basicの先頭
      makeItem({ key: "future_goals" }), // 最終カテゴリ
    ];
    const sorted = sortResearchItemsToCanonicalOrder(shuffled);
    const keys = sorted.map((i) => i.key);
    expect(keys).toEqual(["store_name", "phone", "future_goals"]);
  });

  it("未知keyは末尾へ回す(落ちない安全側の実装)", () => {
    const items = [makeItem({ key: "unknown_key" }), makeItem({ key: "store_name" })];
    const sorted = sortResearchItemsToCanonicalOrder(items);
    expect(sorted[0]!.key).toBe("store_name");
    expect(sorted[1]!.key).toBe("unknown_key");
  });
});

/**
 * canonical fallback bypass の trust boundary
 * (feat/ai-research-quality-ux-hardening、Plan §7.1.1 / 承認レビュー指摘1)。
 *
 * bypass の発火条件を「key ∈ canonicalVerifiedKeys」だけにすると、将来
 * `excludeKeys` に regression が起きて AI 生成 item が同じ key で混入した場合に
 * bypass を乗っ取られる。Stage2 Structured Output schema は `evidence_basis` を
 * モデルへ公開していない(`schema-builder.ts` の 9 フィールドに含まれない)ため、
 * `evidence_basis === "existing_canonical"` との **AND** を必須にすることで
 * 「コードが合成した item だけが bypass に乗る」ことを構造的に保証する。
 */
describe("canonicalVerifiedKeys bypass (承認レビュー指摘1)", () => {
  it("key一致 + evidence_basis=existing_canonical の両方が揃えば confirmed を維持する", () => {
    const item = makeItem({
      key: "official_site",
      research_policy: "FACT",
      status: "confirmed",
      value: "あり (https://robata-jun.com/)",
      source_ids: [],
      evidence_basis: "existing_canonical",
    });
    const result = validateResearchItemStatus(item, {
      sourceRegistry: [],
      canonicalVerifiedKeys: new Set(["official_site"]),
    });
    expect(result.status).toBe("confirmed");
    expect(result.value).toBe("あり (https://robata-jun.com/)");
    expect(result.evidence_basis).toBe("existing_canonical");
  });

  it("key一致でも evidence_basis が無い item は bypass できない(AI生成itemの混入防御)", () => {
    // Stage2 schema は evidence_basis を持たないため、AI が返す item は必ず undefined。
    const aiItem = makeItem({
      key: "official_site",
      research_policy: "FACT",
      status: "confirmed",
      value: "あり (https://例のサイト.example/)",
      source_ids: [],
      evidence_basis: undefined,
    });
    const result = validateResearchItemStatus(aiItem, {
      sourceRegistry: [],
      canonicalVerifiedKeys: new Set(["official_site"]),
    });
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
  });

  it("evidence_basis を自己申告しても key が canonicalVerifiedKeys に無ければ bypass できない", () => {
    const item = makeItem({
      key: "concept",
      research_policy: "FACT_OR_HEARING",
      status: "confirmed",
      source_ids: [],
      evidence_basis: "existing_canonical",
    });
    const result = validateResearchItemStatus(item, {
      sourceRegistry: [],
      canonicalVerifiedKeys: new Set(["official_site"]),
    });
    expect(result.status).toBe("hearing_required");
    expect(result.value).toBeNull();
  });

  it("canonicalVerifiedKeys 未指定なら従来どおり降格する", () => {
    const item = makeItem({
      key: "review_avg",
      research_policy: "FACT",
      status: "confirmed",
      source_ids: [],
      evidence_basis: "existing_canonical",
    });
    const result = validateResearchItemStatus(item, { sourceRegistry: [] });
    expect(result.status).toBe("not_found");
  });

  it("HEARING_ONLY / EXTERNAL_DATA_REQUIRED は canonical bypass よりも前段で無条件降格する", () => {
    const item = makeItem({
      key: "population_day_night",
      research_policy: "EXTERNAL_DATA_REQUIRED",
      status: "confirmed",
      value: "昼間 12000人",
      source_ids: [],
      evidence_basis: "existing_canonical",
    });
    const result = validateResearchItemStatus(item, {
      sourceRegistry: [],
      canonicalVerifiedKeys: new Set(["population_day_night"]),
    });
    expect(result.status).toBe("external_data_required");
    expect(result.value).toBeNull();
  });
});

/**
 * conflict candidate の trust boundary 検証(PR #180 final smoke hardening、BLOCKER 2)。
 *
 * ## 背景(実機: 関内 なむら / run research_run_msprr298_4sdc9t)
 *
 * `phone` が `status="conflict"` で返り、candidate B の唯一の出典 S01 は
 * `url_context_status="success"` だが `identity_status="uncertain"` だった。
 * つまり**対象店舗のページだとコード側で確認できていない情報源**を根拠にした候補が、
 * そのままユーザーへ「候補B」として提示されていた。
 *
 * ## root cause
 *
 * `validateResearchItemStatus` は先頭で `status !== "confirmed"` を early return する
 * ため conflict を一切検証しない。`validateConflictShape` も「candidate 2件以上 /
 * 異なる値2種類以上 / candidate_id 重複」という**形状**しか見ておらず、candidate 単位の
 * url_context / identity / competitor 適格性を検証していなかった。
 * これは phone 固有ではなく conflict 全般の trust boundary gap である。
 *
 * ## 固定する不変条件
 *
 * confirmed と conflict candidate で trust ルールを二重実装しない
 * (両者とも `isVerifiedSourceForItem` を経由する)。
 *
 * ## 意図的に採らないルール
 *
 * 「canonical(`stores.phone`)と異なる番号だから候補を削除」というルールにはしない。
 * 番号が正しく変更されたケースを壊すため。除外理由はあくまで identity / url_context の
 * trust boundary を満たさないことに限る。
 */
describe("validateConflictCandidateTrust (BLOCKER 2)", () => {
  const phoneItem = (candidates: ResearchItemCandidate[]): ResearchItem =>
    makeItem({
      key: "phone",
      research_policy: "FACT",
      status: "conflict",
      value: null,
      source_ids: [],
      candidates,
    });

  const verified = (id: string, overrides: Partial<SourceRegistryEntry> = {}) =>
    makeSource({
      id,
      url_context_status: "success",
      identity_status: "target_match",
      ...overrides,
    });

  const candA = (source_ids: string[], evidence = "045-305-6536 と記載。") => ({
    candidate_id: "a",
    label: "候補A",
    value: "045-305-6536",
    evidence,
    source_ids,
  });
  const candB = (source_ids: string[], evidence = "045-305-6539 と記載。") => ({
    candidate_id: "b",
    label: "候補B",
    value: "045-305-6539",
    evidence,
    source_ids,
  });

  it("1. url_context成功 + target_match の source を持つ candidate は残る", () => {
    const item = phoneItem([candA(["S02"]), candB(["S03"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [verified("S02"), verified("S03")],
    });
    expect(result.status).toBe("conflict");
    expect(result.candidates?.map((c) => c.candidate_id)).toEqual(["a", "b"]);
  });

  it("2. identity_status=uncertain の source しか持たない candidate は除外される(実機事象)", () => {
    const item = phoneItem([candA(["S02"]), candB(["S01"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [verified("S02"), verified("S01", { identity_status: "uncertain" })],
    });
    expect(result.candidates?.some((c) => c.candidate_id === "b")).not.toBe(true);
  });

  it("3. unrelated の source しか持たない candidate は除外される", () => {
    const item = phoneItem([candA(["S02"]), candB(["S01"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [verified("S02"), verified("S01", { identity_status: "unrelated" })],
    });
    expect(result.candidates?.some((c) => c.candidate_id === "b")).not.toBe(true);
  });

  it("4. competitor source を自店 phone の candidate 根拠に使うと除外される", () => {
    const item = phoneItem([candA(["S02"]), candB(["S01"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [
        verified("S02"),
        verified("S01", { source_type: "competitor", identity_status: "competitor_match" }),
      ],
    });
    expect(result.candidates?.some((c) => c.candidate_id === "b")).not.toBe(true);
  });

  it("url_context_status が success でない source しか持たない candidate は除外される", () => {
    const item = phoneItem([candA(["S02"]), candB(["S01"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [verified("S02"), verified("S01", { url_context_status: "error" })],
    });
    expect(result.candidates?.some((c) => c.candidate_id === "b")).not.toBe(true);
  });

  it("candidate.source_ids は不適格な id だけを刈り込み、適格な id が残れば candidate を維持する", () => {
    const item = phoneItem([candA(["S02", "S09"]), candB(["S03"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [
        verified("S02"),
        verified("S03"),
        verified("S09", { identity_status: "uncertain" }),
      ],
    });
    expect(result.status).toBe("conflict");
    expect(result.candidates?.find((c) => c.candidate_id === "a")?.source_ids).toEqual(["S02"]);
  });

  it("5. 2候補のうち1件だけ trusted なら confirmed へ縮約する", () => {
    const item = phoneItem([candA(["S02"]), candB(["S01"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [verified("S02"), verified("S01", { identity_status: "uncertain" })],
    });
    expect(result.status).toBe("confirmed");
    expect(result.value).toBe("045-305-6536");
    expect(result.evidence).toBe("045-305-6536 と記載。");
    expect(result.source_ids).toEqual(["S02"]);
    expect(result.candidates).toBeUndefined();
  });

  it("5b. 縮約後も通常の confirmed validation を通す(candidate trust だけで confirmed を確定させない)", () => {
    const item = phoneItem([candA(["S02"]), candB(["S01"])]);

    const kept = applyDeterministicValidation(item, {
      sourceRegistry: [verified("S02"), verified("S01", { identity_status: "uncertain" })],
    });
    expect(kept.status).toBe("confirmed");
    expect(kept.evidence_basis).toBe("url_context");

    // 縮約先 source 自体が identity 不適格になると、縮約しても confirmed は維持されない。
    const downgraded = applyDeterministicValidation(item, {
      sourceRegistry: [
        verified("S02", { identity_status: "uncertain" }),
        verified("S01", { identity_status: "uncertain" }),
      ],
    });
    expect(downgraded.status).toBe("not_found");
  });

  it("6. 2候補ともに trusted で値が異なるなら conflict を維持する", () => {
    const item = phoneItem([candA(["S02"]), candB(["S03"])]);
    const result = applyDeterministicValidation(item, {
      sourceRegistry: [verified("S02"), verified("S03")],
    });
    expect(result.status).toBe("conflict");
    expect(result.candidates).toHaveLength(2);
  });

  it("7. trusted candidate が0件なら FACT の phone は not_found へ safe downgrade する", () => {
    const item = phoneItem([candA(["S01"]), candB(["S04"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [
        verified("S01", { identity_status: "uncertain" }),
        verified("S04", { identity_status: "unrelated" }),
      ],
    });
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
    expect(result.candidates).toBeUndefined();
  });

  it("trusted candidate が0件の ANALYSIS 項目は inferred ではなく not_found へ倒す(AIのvalueを残さない)", () => {
    const item = makeItem({
      key: "market_demand",
      research_policy: "ANALYSIS",
      status: "conflict",
      value: "需要は非常に高い",
      source_ids: [],
      candidates: [
        { candidate_id: "a", label: "候補A", value: "高い", evidence: "e1", source_ids: ["S01"] },
        { candidate_id: "b", label: "候補B", value: "低い", evidence: "e2", source_ids: ["S04"] },
      ],
    });
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [
        verified("S01", { identity_status: "uncertain" }),
        verified("S04", { identity_status: "unrelated" }),
      ],
    });
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
  });

  it("trusted candidate が2件以上でも値が1種類なら実質的な競合ではないため confirmed へ縮約する", () => {
    const item = phoneItem([
      candA(["S02"]),
      candB(["S01"]),
      { candidate_id: "c", label: "候補C", value: "045-305-6536", evidence: "同番号。", source_ids: ["S03"] },
    ]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [
        verified("S02"),
        verified("S03"),
        verified("S01", { identity_status: "uncertain" }),
      ],
    });
    expect(result.status).toBe("confirmed");
    expect(result.value).toBe("045-305-6536");
    expect(result.source_ids).toEqual(["S02", "S03"]);
  });

  it("PRIMARY_SOURCE_REQUIRED_KEYS の項目は conflict candidate でも一次情報を要求する(既存 confirmed ルールを迂回させない)", () => {
    const item = makeItem({
      key: "concept",
      research_policy: "FACT_OR_HEARING",
      status: "conflict",
      value: null,
      source_ids: [],
      candidates: [
        { candidate_id: "a", label: "候補A", value: "郷土料理", evidence: "e1", source_ids: ["S05"] },
        { candidate_id: "b", label: "候補B", value: "創作和食", evidence: "e2", source_ids: ["S06"] },
      ],
    });
    // 両方とも url_context 成功 + target_match だが、自己申告 official_site の
    // gemini_search_candidate なので `deriveTrustedSourceType` は undefined を返す。
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [
        verified("S05", {
          discovery_provenance: "gemini_search_candidate",
          source_type: "official_site",
        }),
        verified("S06", {
          discovery_provenance: "gemini_search_candidate",
          source_type: "official_site",
        }),
      ],
    });
    expect(result.status).toBe("hearing_required");
    expect(result.candidates).toBeUndefined();
  });

  it("競合項目では competitor_match を根拠として許容する(既存 identity ルールの再利用)", () => {
    const item = makeItem({
      key: "competitor_stores",
      research_policy: "ANALYSIS",
      status: "conflict",
      value: null,
      source_ids: [],
      candidates: [
        { candidate_id: "a", label: "候補A", value: "A店", evidence: "e1", source_ids: ["S02"] },
        { candidate_id: "b", label: "候補B", value: "B店", evidence: "e2", source_ids: ["S03"] },
      ],
    });
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [
        verified("S02", { identity_status: "competitor_match", source_type: "gourmet_site" }),
        verified("S03", { identity_status: "competitor_match", source_type: "gourmet_site" }),
      ],
    });
    expect(result.status).toBe("conflict");
    expect(result.candidates).toHaveLength(2);
  });

  it("status !== conflict の項目は変更しない(参照同一性)", () => {
    const item = makeItem({ status: "confirmed", value: "17:00-24:00" });
    expect(validateConflictCandidateTrust(item, { sourceRegistry: [] })).toBe(item);
  });

  it("すべての candidate が適格なら変更せず返す(参照同一性)", () => {
    const item = phoneItem([candA(["S02"]), candB(["S03"])]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [verified("S02"), verified("S03")],
    });
    expect(result).toBe(item);
  });

  it("conflictCandidateEvidenceGuard が false を返した candidate は trusted として扱わない(key固有ルールの注入点)", () => {
    const item = phoneItem([candA(["S02"]), candB(["S03"], "根拠に番号が現れない文。")]);
    const result = validateConflictCandidateTrust(item, {
      sourceRegistry: [verified("S02"), verified("S03")],
      conflictCandidateEvidenceGuard: (_item, candidate) => candidate.candidate_id !== "b",
    });
    expect(result.status).toBe("confirmed");
    expect(result.value).toBe("045-305-6536");
  });
});

describe("isVerifiedSourceForItem (confirmed と conflict candidate で共通の source 適格判定)", () => {
  it("url_context 成功 + target_match なら適格", () => {
    const entry = makeSource({ url_context_status: "success", identity_status: "target_match" });
    expect(isVerifiedSourceForItem(entry, "phone")).toBe(true);
  });

  it("url_context が成功していなければ不適格", () => {
    const entry = makeSource({
      url_context_status: "not_attempted",
      identity_status: "target_match",
    });
    expect(isVerifiedSourceForItem(entry, "phone")).toBe(false);
  });

  it("identity_status が uncertain なら不適格", () => {
    const entry = makeSource({ url_context_status: "success", identity_status: "uncertain" });
    expect(isVerifiedSourceForItem(entry, "phone")).toBe(false);
  });

  it("source_type=competitor は自店項目で不適格", () => {
    const entry = makeSource({
      url_context_status: "success",
      identity_status: "target_match",
      source_type: "competitor",
    });
    expect(isVerifiedSourceForItem(entry, "phone")).toBe(false);
  });

  it("一次情報必須keyでは known_store_data の official_site のみ適格", () => {
    const known = makeSource({
      url_context_status: "success",
      identity_status: "target_match",
      discovery_provenance: "known_store_data",
      source_type: "official_site",
    });
    const selfReported = makeSource({
      url_context_status: "success",
      identity_status: "target_match",
      discovery_provenance: "gemini_search_candidate",
      source_type: "official_site",
    });
    expect(isVerifiedSourceForItem(known, "concept")).toBe(true);
    expect(isVerifiedSourceForItem(selfReported, "concept")).toBe(false);
    // 一次情報必須でないkeyでは、自己申告typeでも url_context + identity で適格。
    expect(isVerifiedSourceForItem(selfReported, "phone")).toBe(true);
  });
});

/**
 * confirmed 降格の理由文言(PR #180 Sparse Store Source Identity Recovery)。
 *
 * 実機 run(告膳)では引用元 10 source のうち 9 件が `url_context_status="success"` で
 * **本文取得には成功していた**のに、53 項目中 19 項目が
 * 「本文取得が確認できなかったため」という文言で降格していた。
 *
 * ただし `isVerifiedSourceForItem` の trust boundary は取得と identity 以外にも
 * competitor 除外・`PRIMARY_SOURCE_REQUIRED_KEYS` の一次情報要求を持つため、
 * 「取得成功 かつ target_match」でも confirmed になれないケースがある。
 * そこで identity 文言を出すと再び事実と異なるので、**3 分類**にする。
 *
 * 判定は既存 trust helper(`isIdentityAcceptableForItem` /
 * `getRequiredIdentityStatuses` / `isVerifiedSourceForItem` / `deriveTrustedSourceType`)を
 * そのまま再利用し、drift させない。
 */
describe("deriveDowngradeReason (PR #180、3分類)", () => {
  const ACQUISITION = "情報源の本文を取得できなかった";
  const IDENTITY = "対象店舗のページであることを確認できなかった";
  const ELIGIBILITY = "確認済みとして扱うために必要な情報源の条件を満たさなかった";
  const PRIMARY = "本人発信の一次情報として確認できなかった";

  const cite = (key: string, ids: string[]) => ({ key, source_ids: ids });

  describe("層1: acquisition failure(本文取得できた source が0件)", () => {
    it("A. url_context_status=error のみ → acquisition wording", () => {
      const registry = [makeSource({ id: "S01", url_context_status: "error" })];
      expect(deriveDowngradeReason(cite("seat_count", ["S01"]), registry)).toContain(ACQUISITION);
    });

    it("not_attempted のみ → acquisition wording", () => {
      const registry = [makeSource({ id: "S01", url_context_status: "not_attempted" })];
      expect(deriveDowngradeReason(cite("seat_count", ["S01"]), registry)).toContain(ACQUISITION);
    });

    it("source_ids が空 → acquisition wording", () => {
      const registry = [makeSource({ id: "S01", url_context_status: "success" })];
      expect(deriveDowngradeReason(cite("seat_count", []), registry)).toContain(ACQUISITION);
    });

    it("引用していない source が success でも acquisition wording", () => {
      const registry = [
        makeSource({ id: "S01", url_context_status: "error" }),
        makeSource({ id: "S02", url_context_status: "success" }),
      ];
      expect(deriveDowngradeReason(cite("seat_count", ["S01"]), registry)).toContain(ACQUISITION);
    });

    it("registry に存在しない source_id は無視する", () => {
      const registry = [makeSource({ id: "S01", url_context_status: "success" })];
      expect(deriveDowngradeReason(cite("seat_count", ["S99"]), registry)).toContain(ACQUISITION);
    });
  });

  describe("層2: identity failure(取得済みだが required identity を満たさない)", () => {
    it("B. success + uncertain → identity wording", () => {
      const registry = [
        makeSource({ id: "S01", url_context_status: "success", identity_status: "uncertain" }),
      ];
      expect(deriveDowngradeReason(cite("seat_count", ["S01"]), registry)).toContain(IDENTITY);
    });

    it("success と error が混在していても、success 側が uncertain なら identity wording", () => {
      const registry = [
        makeSource({ id: "S01", url_context_status: "error" }),
        makeSource({ id: "S02", url_context_status: "success", identity_status: "uncertain" }),
      ];
      expect(deriveDowngradeReason(cite("seat_count", ["S01", "S02"]), registry)).toContain(
        IDENTITY,
      );
    });

    it("F1. 競合項目は competitor_match が required(target_match では identity failure)", () => {
      // COMPETITOR_ITEM_KEYS は competitor_match のみを required identity とする。
      const registry = [
        makeSource({ id: "S01", url_context_status: "success", identity_status: "target_match" }),
      ];
      expect(deriveDowngradeReason(cite("competitor_stores", ["S01"]), registry)).toContain(
        IDENTITY,
      );
    });

    it("F2. 文脈項目は contextual も required identity に含まれる(identity failure にならない)", () => {
      // CONTEXTUAL_ITEM_KEYS は target_match / contextual の両方を許容する。
      // identity は満たすので、止まるのは層3(source_type=competitor 除外)側になる。
      const registry = [
        makeSource({
          id: "S01",
          url_context_status: "success",
          identity_status: "contextual",
          source_type: "competitor",
        }),
      ];
      const reason = deriveDowngradeReason(cite("trade_area", ["S01"]), registry);
      expect(reason).not.toContain(IDENTITY);
      expect(reason).toContain(ELIGIBILITY);
    });

    it("F3. 競合項目で competitor_match なら identity は満たす(層3以降へ進む)", () => {
      const registry = [
        makeSource({
          id: "S01",
          url_context_status: "success",
          identity_status: "competitor_match",
          source_type: "competitor",
        }),
      ];
      expect(deriveDowngradeReason(cite("competitor_stores", ["S01"]), registry)).not.toContain(
        IDENTITY,
      );
    });
  });

  describe("層3: source eligibility / trust failure", () => {
    it("D. 一次情報必須 key + success + target_match + gourmet_site → 一次情報 wording", () => {
      const registry = [
        makeSource({
          id: "S01",
          url_context_status: "success",
          identity_status: "target_match",
          source_type: "gourmet_site",
          discovery_provenance: "gemini_search_candidate",
          grounding_redirect_url: "https://tabelog.com/tokyo/A1301/",
        }),
      ];
      const reason = deriveDowngradeReason(cite("concept", ["S01"]), registry);
      expect(reason).toContain(PRIMARY);
      // identity は満たしているので identity wording にはならない。
      expect(reason).not.toContain(IDENTITY);
      expect(reason).not.toContain(ACQUISITION);
    });

    it.each(["owner_profile", "owner_career", "owner_philosophy", "concept"])(
      "一次情報必須 key(%s)はすべて一次情報 wording",
      (key) => {
        const registry = [
          makeSource({
            id: "S01",
            url_context_status: "success",
            identity_status: "target_match",
            source_type: "gourmet_site",
            discovery_provenance: "gemini_search_candidate",
            grounding_redirect_url: "https://tabelog.com/x/",
          }),
        ];
        expect(deriveDowngradeReason(cite(key, ["S01"]), registry)).toContain(PRIMARY);
      },
    );

    it("一次情報必須でない key が competitor source で止まる場合は汎用 eligibility wording", () => {
      const registry = [
        makeSource({
          id: "S01",
          url_context_status: "success",
          identity_status: "target_match",
          source_type: "competitor",
        }),
      ];
      const reason = deriveDowngradeReason(cite("seat_count", ["S01"]), registry);
      expect(reason).toContain(ELIGIBILITY);
      expect(reason).not.toContain(PRIMARY);
    });
  });

  it("G. 文言に URL / title / 店舗情報 / source id を含まない", () => {
    const registry = [
      makeSource({
        id: "S01",
        url_context_status: "success",
        identity_status: "uncertain",
        title: "告膳(所沢駅/和食) - ホットペッパーグルメ",
        grounding_redirect_url:
          "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
      }),
    ];
    for (const key of ["seat_count", "concept", "competitor_stores", "trade_area"]) {
      const reason = deriveDowngradeReason(cite(key, ["S01"]), registry);
      expect(reason).not.toContain("http");
      expect(reason).not.toContain("告膳");
      expect(reason).not.toContain("ホットペッパー");
      expect(reason).not.toContain("S01");
      expect(reason).not.toContain(key);
    }
  });

  it("戻り値は必ず4つの固定文言のいずれか", () => {
    const allowed = [ACQUISITION, IDENTITY, ELIGIBILITY, PRIMARY];
    const registries = [
      [makeSource({ id: "S01", url_context_status: "error" })],
      [makeSource({ id: "S01", url_context_status: "success", identity_status: "uncertain" })],
      [
        makeSource({
          id: "S01",
          url_context_status: "success",
          identity_status: "target_match",
          source_type: "competitor",
        }),
      ],
    ];
    for (const registry of registries) {
      for (const key of ["seat_count", "concept", "competitor_stores", "trade_area"]) {
        const reason = deriveDowngradeReason(cite(key, ["S01"]), registry);
        expect(allowed.some((w) => reason.includes(w))).toBe(true);
      }
    }
  });
});

describe("validateResearchItemStatus の降格文言が source 状態を反映する (PR #180)", () => {
  it("B. 本文取得成功 + 店舗同定失敗 → identity wording", () => {
    const registry = [
      makeSource({ id: "S01", url_context_status: "success", identity_status: "uncertain" }),
    ];
    const result = validateResearchItemStatus(makeItem({ source_ids: ["S01"] }), {
      sourceRegistry: registry,
    });
    expect(result.status).toBe("not_found");
    expect(result.warning).toContain("対象店舗のページであることを確認できなかった");
    expect(result.warning).not.toContain("本文を取得できなかった");
  });

  it("A. 本文取得失敗 → acquisition wording(従来の意味を維持)", () => {
    const registry = [
      makeSource({ id: "S01", url_context_status: "error", identity_status: "target_match" }),
    ];
    const result = validateResearchItemStatus(makeItem({ source_ids: ["S01"] }), {
      sourceRegistry: registry,
    });
    expect(result.status).toBe("not_found");
    expect(result.warning).toContain("本文を取得できなかった");
    expect(result.warning).not.toContain("対象店舗のページであることを確認できなかった");
  });

  it("C. 通常 FACT + success + target_match → 降格せず confirmed を維持する", () => {
    const registry = [
      makeSource({ id: "S01", url_context_status: "success", identity_status: "target_match" }),
    ];
    const result = validateResearchItemStatus(makeItem({ source_ids: ["S01"] }), {
      sourceRegistry: registry,
    });
    expect(result.status).toBe("confirmed");
    expect(result.warning ?? "").not.toContain("格下げ");
  });

  it("D. 一次情報必須 key + success + target_match + gourmet_site → 一次情報 wording", () => {
    const registry = [
      makeSource({
        id: "S01",
        url_context_status: "success",
        identity_status: "target_match",
        source_type: "gourmet_site",
        discovery_provenance: "gemini_search_candidate",
        grounding_redirect_url: "https://tabelog.com/tokyo/A1301/",
      }),
    ];
    const result = validateResearchItemStatus(
      makeItem({ key: "concept", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] }),
      { sourceRegistry: registry },
    );
    expect(result.status).toBe("hearing_required");
    expect(result.warning).toContain("本人発信の一次情報として確認できなかった");
    expect(result.warning).not.toContain("対象店舗のページであることを確認できなかった");
  });

  it("E. 一次情報必須 key + trusted official source → confirmed 維持", () => {
    const registry = [
      makeSource({
        id: "S01",
        url_context_status: "success",
        identity_status: "target_match",
        source_type: "official_site",
        discovery_provenance: "known_store_data",
      }),
    ];
    const result = validateResearchItemStatus(
      makeItem({ key: "concept", research_policy: "FACT_OR_HEARING", source_ids: ["S01"] }),
      { sourceRegistry: registry },
    );
    expect(result.status).toBe("confirmed");
    expect(result.warning ?? "").not.toContain("格下げ");
  });

  it("降格時の status / value / source_ids は従来と同一(文言のみ変更)", () => {
    const registry = [
      makeSource({ id: "S01", url_context_status: "success", identity_status: "uncertain" }),
    ];
    const item = makeItem({ source_ids: ["S01"], value: "17:00-24:00" });
    const result = validateResearchItemStatus(item, { sourceRegistry: registry });
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
    expect(result.source_ids).toEqual(["S01"]);
    expect(result.key).toBe(item.key);
    expect(result.research_policy).toBe(item.research_policy);
    expect(result.evidence_basis).toBeUndefined();
  });
});
