import { describe, expect, it } from "vitest";
import {
  buildAdoptedBasicInfoField,
  classifyResearchQueue,
  formatReviewProgressLabel,
  getReviewableItems,
  getUndecidedReviewableItems,
  isReviewableItem,
  isReviewFullyDecided,
  isRunStuck,
  resolveSourceUrls,
  selectPrimaryResearchRun,
} from "../research-review";
import type {
  ResearchItem,
  ReviewDecisions,
  SourceRegistryEntry,
  StoreResearchRun,
} from "@/types/research-run";
import type { Store } from "@/types/store";

function makeStore(overrides: Partial<Store>): Store {
  return {
    id: "id",
    name: "",
    prefecture: "",
    city: "",
    address: "",
    genre: "",
    priority: "中",
    stage: "未調査",
    channel: "未判定",
    has_contact_form: "未確認",
    map_url: "",
    site_url: "",
    instagram_url: "",
    phone: "",
    target_service: "",
    review_count: 0,
    review_avg: 0,
    memo: "",
    assigned_planner_user_id: null,
    assigned_sales_user_id: null,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: null,
    lng: null,
    google_place_id: null,
    appointment_acquired_date: null,
    next_action_date: null,
    next_action_note: null,
    basic_info: {},
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...overrides,
  };
}

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

describe("formatReviewProgressLabel", () => {
  it("not_foundが多いrunでも実際の除外件数を正しく表示する(バグ修正の回帰テスト、fix/ai-research-poc-like-retrieval)", () => {
    const label = formatReviewProgressLabel(53, 0, 0);
    expect(label).toContain("0 / 0 件");
    expect(label).toContain("計53件はレビュー対象外");
    expect(label).toContain("確認できず");
    expect(label).toContain("ヒアリング必要");
    expect(label).toContain("外部データ必要");
  });

  it("通常runの件数表示が正しい", () => {
    const label = formatReviewProgressLabel(53, 36, 10);
    expect(label).toContain("10 / 36 件");
    expect(label).toContain("計17件はレビュー対象外");
  });

  it("旧文言の誤り(ヒアリング必要・外部データ必要のみ列挙)を含まない", () => {
    const label = formatReviewProgressLabel(53, 0, 0);
    expect(label).not.toBe("レビュー進捗: 0 / 0 件 (ヒアリング必要・外部データ必要 計53件は対象外)");
  });
});

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

describe("isRunStuck", () => {
  it("running かつ expires_at を過ぎていれば stuck", () => {
    const run = makeRun({
      status: "running",
      expires_at: "2026-08-01T00:10:00.000Z",
    });
    expect(isRunStuck(run, "2026-08-01T00:10:00.001Z")).toBe(true);
  });

  it("running でも expires_at 未到達なら stuck でない", () => {
    const run = makeRun({
      status: "running",
      expires_at: "2026-08-01T00:10:00.000Z",
    });
    expect(isRunStuck(run, "2026-08-01T00:09:59.999Z")).toBe(false);
  });

  it("running でなければ expires_at を過ぎていても stuck でない", () => {
    const run = makeRun({
      status: "succeeded",
      expires_at: "2026-08-01T00:10:00.000Z",
    });
    expect(isRunStuck(run, "2026-09-01T00:00:00.000Z")).toBe(false);
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

  it("未レビューのsucceeded runがあっても、実行中(running)のrunを最優先する(それでも再調査する、Plan §5.9)", () => {
    const runs = [
      // 新: 「それでも再調査する」で開始した実行中run
      makeRun({ id: "r_running", status: "running", started_at: "2026-08-02T00:00:00.000Z" }),
      // 旧: まだレビューしていない過去の成功run
      makeRun({
        id: "r_old_unreviewed",
        status: "succeeded",
        review_completed_at: null,
        started_at: "2026-08-01T00:00:00.000Z",
      }),
    ];
    expect(selectPrimaryResearchRun(runs)?.id).toBe("r_running");
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

  it("editedValueが元の値と異なる場合、AIのconfidenceを引き継がずsource_quoteを編集済み文言へ置き換える(feat/research-review-write-integrity、追加修正F)", () => {
    const item = makeItem({ status: "confirmed", confidence: 90, evidence: "AIの根拠テキスト" });
    const field = buildAdoptedBasicInfoField(item, registry, now, {
      editedValue: "手動で修正した値",
    });
    expect(field.value).toBe("手動で修正した値");
    expect(field.confidence).toBeUndefined();
    expect(field.source_quote).not.toBe("AIの根拠テキスト");
    expect(field.source_quote).toContain("人間が編集した値");
  });

  it("editedValueが元の値と同一(実質未編集)ならAIのconfidence/evidenceをそのまま使う", () => {
    const item = makeItem({ status: "confirmed", value: "17:00〜24:00", confidence: 90, evidence: "AIの根拠テキスト" });
    const field = buildAdoptedBasicInfoField(item, registry, now, {
      editedValue: "17:00〜24:00",
    });
    expect(field.confidence).toBe(90);
    expect(field.source_quote).toBe("AIの根拠テキスト");
  });

  it("conflict候補選択+editedValueが候補値と異なる場合もconfidence/source_quoteを編集済み扱いにする", () => {
    const item = makeItem({
      status: "conflict",
      value: null,
      confidence: 80,
      candidates: [
        { candidate_id: "c1", label: "候補A", value: "候補A値", evidence: "候補A根拠", source_ids: ["S01"] },
      ],
    });
    const field = buildAdoptedBasicInfoField(item, registry, now, {
      selectedCandidateId: "c1",
      editedValue: "編集後の値",
    });
    expect(field.value).toBe("編集後の値");
    expect(field.confidence).toBeUndefined();
    expect(field.source_quote).toContain("人間が編集した値");
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

describe("classifyResearchQueue", () => {
  it("要確認 > 調査待ち > 調査済みの優先順位で相互排他に分類する", () => {
    const stores = [
      makeStore({ id: "a", stage: "未調査" }),
      makeStore({ id: "b", stage: "調査済み" }),
      makeStore({ id: "c", stage: "架電済み" }),
      // 要確認対象なのに未調査のまま(AI調査run成功直後、レビュー未完了)
      makeStore({ id: "d", stage: "未調査" }),
      // 要確認対象だが既に調査済み(再調査中の店舗)
      makeStore({ id: "e", stage: "調査済み" }),
    ];
    const needsReviewIds = new Set(["d", "e"]);

    const result = classifyResearchQueue(stores, needsReviewIds);

    expect(result.needsReview.map((s) => s.id)).toEqual(["d", "e"]);
    expect(result.waiting.map((s) => s.id)).toEqual(["a"]);
    expect(result.done.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("要確認idが空集合ならstageのみで分類する", () => {
    const stores = [
      makeStore({ id: "a", stage: "未調査" }),
      makeStore({ id: "b", stage: "調査済み" }),
    ];

    const result = classifyResearchQueue(stores, new Set());

    expect(result.needsReview).toEqual([]);
    expect(result.waiting.map((s) => s.id)).toEqual(["a"]);
    expect(result.done.map((s) => s.id)).toEqual(["b"]);
  });

  it("入力が空配列なら全バケット空", () => {
    const result = classifyResearchQueue([], new Set(["x"]));
    expect(result).toEqual({ needsReview: [], waiting: [], done: [] });
  });
});
