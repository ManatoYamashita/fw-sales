import { describe, expect, it } from "vitest";
import {
  buildAdoptedBasicInfoField,
  getReviewableItems,
  getUndecidedReviewableItems,
  isReviewableItem,
  isReviewFullyDecided,
  resolveSourceUrls,
  selectPrimaryResearchRun,
} from "../research-review";
import type {
  ResearchItem,
  ReviewDecisions,
  SourceRegistryEntry,
  StoreResearchRun,
} from "@/types/research-run";

function makeItem(overrides: Partial<ResearchItem> = {}): ResearchItem {
  return {
    key: "business_hours_holidays",
    research_policy: "FACT",
    status: "confirmed",
    value: "17:00〜24:00",
    evidence: "公式サイトに明記",
    source_ids: ["S01"],
    confidence: null,
    warning: null,
    candidates: null,
    ...overrides,
  };
}

function makeSource(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    id: "S01",
    title: "公式サイト",
    grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    resolved_url: "https://example.com/official",
    resolve_status: "resolved",
    source_type: "official_site",
    discovery_provenance: "google_grounding",
    url_context_status: "success",
    ...overrides,
  };
}

function makeRun(overrides: Partial<StoreResearchRun> = {}): StoreResearchRun {
  return {
    id: "research_run_1",
    store_id: "store_1",
    requested_by_user_id: null,
    status: "succeeded",
    stage: "done",
    result: [],
    source_registry: [],
    review_decisions: {},
    review_completed_at: null,
    token_usage: null,
    warnings: [],
    error_kind: null,
    error_message: null,
    started_at: "2026-08-01T00:00:00.000Z",
    expires_at: "2026-08-01T00:10:00.000Z",
    finished_at: "2026-08-01T00:03:00.000Z",
    ...overrides,
  };
}

describe("isReviewableItem / getReviewableItems", () => {
  it.each(["confirmed", "inferred", "conflict"] as const)("%s は reviewable", (status) => {
    expect(isReviewableItem(makeItem({ status }))).toBe(true);
  });

  it.each(["not_found", "hearing_required", "external_data_required"] as const)(
    "%s は reviewable でない",
    (status) => {
      expect(isReviewableItem(makeItem({ status }))).toBe(false);
    },
  );

  it("getReviewableItems は reviewable な項目のみ返す", () => {
    const items = [
      makeItem({ key: "a", status: "confirmed" }),
      makeItem({ key: "b", status: "hearing_required" }),
      makeItem({ key: "c", status: "inferred" }),
    ];
    expect(getReviewableItems(items).map((i) => i.key)).toEqual(["a", "c"]);
  });
});

describe("getUndecidedReviewableItems / isReviewFullyDecided", () => {
  const items = [
    makeItem({ key: "a", status: "confirmed" }),
    makeItem({ key: "b", status: "inferred" }),
    makeItem({ key: "c", status: "hearing_required" }),
  ];

  it("決定していない reviewable item のみ返す", () => {
    const decisions: ReviewDecisions = { a: { decision: "adopted", decided_at: "now" } };
    expect(getUndecidedReviewableItems(items, decisions).map((i) => i.key)).toEqual(["b"]);
  });

  it("reviewable でない項目は決定有無に関わらず対象外", () => {
    expect(getUndecidedReviewableItems(items, {}).map((i) => i.key)).toEqual(["a", "b"]);
  });

  it("全件決定済みなら isReviewFullyDecided は true", () => {
    const decisions: ReviewDecisions = {
      a: { decision: "adopted", decided_at: "now" },
      b: { decision: "skipped", decided_at: "now" },
    };
    expect(isReviewFullyDecided(items, decisions)).toBe(true);
  });

  it("未決定が残っていれば false", () => {
    expect(isReviewFullyDecided(items, {})).toBe(false);
  });
});

describe("selectPrimaryResearchRun", () => {
  it("未レビューのsucceeded runがあればそれを優先する", () => {
    const runs = [
      makeRun({ id: "r_new_failed", status: "failed", started_at: "2026-08-02T00:00:00.000Z" }),
      makeRun({
        id: "r_old_unreviewed",
        status: "succeeded",
        review_completed_at: null,
        started_at: "2026-08-01T00:00:00.000Z",
      }),
    ];
    expect(selectPrimaryResearchRun(runs)?.id).toBe("r_old_unreviewed");
  });

  it("未レビューのsucceeded runが無ければ先頭(最新)を返す", () => {
    const runs = [
      makeRun({ id: "r1", status: "succeeded", review_completed_at: "2026-08-01T00:00:00.000Z" }),
      makeRun({ id: "r2", status: "failed" }),
    ];
    expect(selectPrimaryResearchRun(runs)?.id).toBe("r1");
  });

  it("空配列なら null", () => {
    expect(selectPrimaryResearchRun([])).toBeNull();
  });
});

describe("resolveSourceUrls", () => {
  const registry = [
    makeSource({ id: "S01", resolved_url: "https://resolved.example.com" }),
    makeSource({
      id: "S02",
      resolved_url: null,
      grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
    }),
  ];

  it("resolved_urlがあればそれを使う", () => {
    expect(resolveSourceUrls(["S01"], registry)).toEqual(["https://resolved.example.com"]);
  });

  it("resolved_urlが無ければgrounding_redirect_urlにfallbackする", () => {
    expect(resolveSourceUrls(["S02"], registry)).toEqual([
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
    ]);
  });

  it("registryに存在しないidは無視する", () => {
    expect(resolveSourceUrls(["S99"], registry)).toEqual([]);
  });
});

describe("buildAdoptedBasicInfoField", () => {
  const now = "2026-08-02T12:00:00.000Z";
  const registry = [makeSource({ id: "S01", resolved_url: "https://example.com/a" })];

  it("confirmed は tier A になる", () => {
    const field = buildAdoptedBasicInfoField(makeItem({ status: "confirmed" }), registry, now);
    expect(field.tier).toBe("A");
    expect(field.value).toBe("17:00〜24:00");
    expect(field.filled_by).toBe("manual");
    expect(field.updated_at).toBe(now);
    expect(field.source_urls).toEqual(["https://example.com/a"]);
  });

  it("inferred は tier B になる", () => {
    const field = buildAdoptedBasicInfoField(makeItem({ status: "inferred" }), registry, now);
    expect(field.tier).toBe("B");
  });

  it("editedValue指定時はそれを優先する", () => {
    const field = buildAdoptedBasicInfoField(makeItem({ status: "confirmed" }), registry, now, {
      editedValue: "手動で修正した値",
    });
    expect(field.value).toBe("手動で修正した値");
  });

  it("conflictで候補選択時はtier Aかつ候補のevidence/source_idsを使う", () => {
    const item = makeItem({
      status: "conflict",
      value: null,
      candidates: [
        { candidate_id: "c1", label: "候補A", value: "候補A値", evidence: "候補A根拠", source_ids: ["S01"] },
        { candidate_id: "c2", label: "候補B", value: "候補B値", evidence: "候補B根拠", source_ids: [] },
      ],
    });
    const field = buildAdoptedBasicInfoField(item, registry, now, { selectedCandidateId: "c1" });
    expect(field.tier).toBe("A");
    expect(field.value).toBe("候補A値");
    expect(field.source_quote).toBe("候補A根拠");
    expect(field.source_urls).toEqual(["https://example.com/a"]);
  });

  it("conflictで存在しないcandidate_idを指定すると例外を投げる", () => {
    const item = makeItem({ status: "conflict", candidates: [] });
    expect(() =>
      buildAdoptedBasicInfoField(item, registry, now, { selectedCandidateId: "missing" }),
    ).toThrow();
  });

  it("conflictでselectedCandidateId未指定だと例外を投げる(value:nullのmanual書込みを防ぐ)", () => {
    const item = makeItem({
      status: "conflict",
      value: null,
      candidates: [
        { candidate_id: "c1", label: "候補A", value: "v1", evidence: "e1", source_ids: [] },
      ],
    });
    expect(() => buildAdoptedBasicInfoField(item, registry, now)).toThrow();
  });
});
