import { describe, expect, it } from "vitest";
import {
  buildAdoptedBasicInfoField,
  classifyResearchQueue,
  formatReviewProgressLabel,
  getReviewableItems,
  getUndecidedReviewableItems,
  summarizeUndecided,
  isReviewableItem,
  isReviewFullyDecided,
  isRunStuck,
  resolveSafeSourceUrls,
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
    // PR #180 F2: 既存テストの大半は「採用すれば source_urls が付く」前提で書かれている。
    // `resolveSafeSourceUrls` が `isSourceLinkClickable` を通すようになったため、
    // 既定を識別確認済み(target_match)にして既存の意図を保つ
    // (`lib/ai/__tests__/research-result-schema.test.ts` の makeSource と同じ方針)。
    // link safety ゲート自体を検証するテストは明示的に override する。
    identity_status: "target_match",
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

  it("editedValueが元の値と異なる場合、AIのconfidence/source_urlsを引き継がずsource_quoteを編集済み文言へ置き換える(feat/research-review-write-integrity、追加修正F)", () => {
    const item = makeItem({ status: "confirmed", confidence: 90, evidence: "AIの根拠テキスト" });
    const field = buildAdoptedBasicInfoField(item, registry, now, {
      editedValue: "手動で修正した値",
    });
    expect(field.value).toBe("手動で修正した値");
    expect(field.confidence).toBeUndefined();
    expect(field.source_quote).not.toBe("AIの根拠テキスト");
    expect(field.source_quote).toContain("人間が編集した値");
  });

  it("editedValueが元の値と異なる場合、元の値の根拠だったsource_urlsを編集後の値に誤帰属させない(fix/ai-research-final-audit-hardening、CONFIRMED BUG修正)", () => {
    // AIのitemは「17:00〜24:00」の根拠としてS01(https://example.com/a)を持つ。
    // 人間がこれを「10:00〜18:00」へ編集した場合、S01は編集後の値の根拠ではないため
    // source_urlsへ残してはならない(残すと、UI/sales-asset生成プロンプトが
    // 「10:00〜18:00の出典はhttps://example.com/a」という誤った証跡を提示してしまう)。
    const item = makeItem({ status: "confirmed", source_ids: ["S01"] });
    const field = buildAdoptedBasicInfoField(item, registry, now, {
      editedValue: "10:00〜18:00",
    });
    expect(field.source_urls).toBeUndefined();
  });

  it("inferred項目をeditedValueで編集した場合もconfidence/source_urlsを引き継がない(欠落していたテストケース)", () => {
    const item = makeItem({
      status: "inferred",
      value: "4,000円",
      confidence: 60,
      evidence: "AIの推定根拠",
      source_ids: ["S01"],
    });
    const field = buildAdoptedBasicInfoField(item, registry, now, {
      editedValue: "5,000円",
    });
    expect(field.value).toBe("5,000円");
    expect(field.tier).toBe("B");
    expect(field.confidence).toBeUndefined();
    expect(field.source_urls).toBeUndefined();
    expect(field.source_quote).toContain("人間が編集した値");
  });

  it("editedValueが元の値と同一(実質未編集)ならAIのconfidence/evidence/source_urlsをそのまま使う", () => {
    const item = makeItem({ status: "confirmed", value: "17:00〜24:00", confidence: 90, evidence: "AIの根拠テキスト" });
    const field = buildAdoptedBasicInfoField(item, registry, now, {
      editedValue: "17:00〜24:00",
    });
    expect(field.confidence).toBe(90);
    expect(field.source_quote).toBe("AIの根拠テキスト");
    expect(field.source_urls).toEqual(["https://example.com/a"]);
  });

  it("conflict候補選択+editedValueが候補値と異なる場合もconfidence/source_quote/source_urlsを編集済み扱いにする", () => {
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
    expect(field.source_urls).toBeUndefined();
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

/**
 * Primary CTA の内訳表示(feat/ai-research-quality-ux-hardening、Plan §12.1.1)。
 *
 * 「残りを採用して調査完了」で**何が採用されるか**をユーザーが押す前に見えるようにする。
 * `conflict` は Primary の採用対象ではないため内訳に混ぜず、別枠で数える。
 */
describe("summarizeUndecided", () => {
  const item = (key: string, status: ResearchItem["status"]): ResearchItem => ({
    key,
    research_policy: "FACT",
    status,
    value: "v",
    evidence: "e",
    source_ids: [],
  });

  it("未判断のconfirmed / inferred / conflict を status別に数える", () => {
    const items = [
      item("a", "confirmed"),
      item("b", "confirmed"),
      item("c", "inferred"),
      item("d", "conflict"),
      item("e", "not_found"),
      item("f", "hearing_required"),
    ];
    expect(summarizeUndecided(items, {})).toEqual({
      confirmed: 2,
      inferred: 1,
      conflict: 1,
      adoptable: 3,
      total: 4,
    });
  });

  it("判断済みの項目は数えない", () => {
    const items = [item("a", "confirmed"), item("b", "inferred")];
    const decisions = { a: { decision: "adopted" as const, decided_at: "2026-08-12T00:00:00.000Z" } };
    expect(summarizeUndecided(items, decisions)).toEqual({
      confirmed: 0,
      inferred: 1,
      conflict: 0,
      adoptable: 1,
      total: 1,
    });
  });

  it("adoptableにconflictを含めない(Primaryで自動採用しないため)", () => {
    const items = [item("a", "conflict"), item("b", "conflict")];
    const summary = summarizeUndecided(items, {});
    expect(summary.adoptable).toBe(0);
    expect(summary.conflict).toBe(2);
    expect(summary.total).toBe(2);
  });

  it("reviewableでない項目(not_found等)は一切数えない", () => {
    const items = [
      item("a", "not_found"),
      item("b", "hearing_required"),
      item("c", "external_data_required"),
    ];
    expect(summarizeUndecided(items, {})).toEqual({
      confirmed: 0,
      inferred: 0,
      conflict: 0,
      adoptable: 0,
      total: 0,
    });
  });

  it("空配列でも安全に0を返す", () => {
    expect(summarizeUndecided([], {}).total).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  canonical source_urls の link safety                                */
/*  (PR #180 F2 Canonical Source URL Provenance Safety Fix)             */
/* ------------------------------------------------------------------ */

/**
 * `stores.basic_info[key].source_urls` は保存されるだけの値ではなく、
 *
 * - `basic-info-field-row.tsx` が**ゲート無しの `<a href>`** として描画する
 * - `basic-info-prompt.ts` が営業資産生成プロンプトへ「出典: …」として渡す
 *
 * という 2 経路で外部へ露出する。一方で調査レビュー UI には
 * `isSourceLinkClickable` という誘導防止ガードが既にあり、識別確認済み
 * (`target_match` / `competitor_match` / `contextual`)または `known_store_data`
 * のみをクリック可能としている。採用操作がそのガードを迂回して canonical へ
 * URL を運んでしまうのを塞ぐのが本 fix。
 *
 * **`isVerifiedSourceForItem`(confirmed の根拠判定)は使わない。** 意味が異なり、
 * `source_urls` が実際に露出する唯一の tier である B(= inferred)でほぼ常に
 * 空になってしまうため。
 */
describe("resolveSafeSourceUrls (PR #180 F2)", () => {
  const URL_SAFE = "https://example.com/safe";
  const URL_UNSAFE = "https://example.com/unsafe";

  const src = (
    id: string,
    identity_status: SourceRegistryEntry["identity_status"],
    resolved_url: string,
    overrides: Partial<SourceRegistryEntry> = {},
  ): SourceRegistryEntry =>
    makeSource({
      id,
      identity_status,
      resolved_url,
      discovery_provenance: "gemini_search_candidate",
      ...overrides,
    });

  /* --- 1 / 2 / 3: 未確認 identity は canonical 出典にしない ---------------- */

  it("1. uncertain の source のみなら source_urls は空", () => {
    const registry = [src("S01", "uncertain", URL_UNSAFE)];
    expect(resolveSafeSourceUrls(["S01"], registry)).toEqual([]);
  });

  it("2. unrelated の source のみなら source_urls は空", () => {
    const registry = [src("S01", "unrelated", URL_UNSAFE)];
    expect(resolveSafeSourceUrls(["S01"], registry)).toEqual([]);
  });

  it("3. not_checked / identity_status 未設定なら source_urls は空", () => {
    const explicit = [src("S01", "not_checked", URL_UNSAFE)];
    expect(resolveSafeSourceUrls(["S01"], explicit)).toEqual([]);

    const missing = [src("S01", undefined, URL_UNSAFE)];
    expect(resolveSafeSourceUrls(["S01"], missing)).toEqual([]);
  });

  /* --- 4 / 5 / 6 / 7: 確認済み identity は保持する ------------------------- */

  it("4. target_match は URL を保持する", () => {
    expect(resolveSafeSourceUrls(["S01"], [src("S01", "target_match", URL_SAFE)])).toEqual([
      URL_SAFE,
    ]);
  });

  it("5. competitor_match は URL を保持する", () => {
    expect(resolveSafeSourceUrls(["S01"], [src("S01", "competitor_match", URL_SAFE)])).toEqual([
      URL_SAFE,
    ]);
  });

  it("6. contextual は URL を保持する(告膳のランキングページ相当)", () => {
    expect(resolveSafeSourceUrls(["S01"], [src("S01", "contextual", URL_SAFE)])).toEqual([
      URL_SAFE,
    ]);
  });

  it("7. known_store_data は identity_status を問わず URL を保持する", () => {
    for (const status of ["not_checked", "uncertain", "unrelated", undefined] as const) {
      const registry = [
        src("S01", status, URL_SAFE, { discovery_provenance: "known_store_data" }),
      ];
      expect(resolveSafeSourceUrls(["S01"], registry)).toEqual([URL_SAFE]);
    }
  });

  /* --- 8 / 9: 混在・全件除外 ---------------------------------------------- */

  it("8. 混在時は safe のみを、元の順序を保って返す", () => {
    const registry = [
      src("S01", "uncertain", "https://example.com/1"),
      src("S02", "target_match", "https://example.com/2"),
      src("S03", "unrelated", "https://example.com/3"),
      src("S04", "contextual", "https://example.com/4"),
    ];
    expect(resolveSafeSourceUrls(["S01", "S02", "S03", "S04"], registry)).toEqual([
      "https://example.com/2",
      "https://example.com/4",
    ]);
    // 入力順が違えば出力順も追従する(順序は source_ids 側が決める)。
    expect(resolveSafeSourceUrls(["S04", "S02"], registry)).toEqual([
      "https://example.com/4",
      "https://example.com/2",
    ]);
  });

  it("8'. duplicate / 未知 id の扱いは resolveSourceUrls と同一", () => {
    const registry = [src("S01", "target_match", URL_SAFE)];
    // dedupe しない(既存 resolveSourceUrls の挙動)。
    expect(resolveSafeSourceUrls(["S01", "S01"], registry)).toEqual([URL_SAFE, URL_SAFE]);
    // registry に存在しない id は無視する。
    expect(resolveSafeSourceUrls(["S99"], registry)).toEqual([]);
    expect(resolveSafeSourceUrls([], registry)).toEqual([]);
  });

  it("9. 全件除外されても元の source_ids へ fallback しない", () => {
    const registry = [
      src("S01", "uncertain", "https://example.com/1"),
      src("S02", "unrelated", "https://example.com/2"),
    ];
    const result = resolveSafeSourceUrls(["S01", "S02"], registry);
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("resolved_url が無ければ grounding_redirect_url へ fallback する(選択順は不変)", () => {
    const registry = [
      makeSource({
        id: "S01",
        identity_status: "contextual",
        discovery_provenance: "gemini_search_candidate",
        resolved_url: null,
        grounding_redirect_url:
          "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
      }),
    ];
    expect(resolveSafeSourceUrls(["S01"], registry)).toEqual([
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
    ]);
  });
});

describe("buildAdoptedBasicInfoField の canonical source_urls (PR #180 F2)", () => {
  const now = "2026-08-14T12:00:00.000Z";
  const URL_SAFE = "https://example.com/safe";
  const URL_UNSAFE = "https://example.com/unsafe";

  const unsafe = (id: string) =>
    makeSource({
      id,
      identity_status: "uncertain",
      discovery_provenance: "gemini_search_candidate",
      resolved_url: URL_UNSAFE,
    });
  const unrelated = (id: string) =>
    makeSource({
      id,
      identity_status: "unrelated",
      discovery_provenance: "gemini_search_candidate",
      resolved_url: "https://example.com/other-store",
    });
  const safe = (id: string, identity_status: SourceRegistryEntry["identity_status"] = "contextual") =>
    makeSource({
      id,
      identity_status,
      discovery_provenance: "gemini_search_candidate",
      resolved_url: URL_SAFE,
    });

  /* --- A: 通常 item ------------------------------------------------------- */

  it("A. inferred item + uncertain source のみ → source_urls は空(tier B は変わらない)", () => {
    const item = makeItem({
      key: "competitor_stores",
      research_policy: "ANALYSIS",
      status: "inferred",
      value: "鮨 ほそ川、鮨 山浦",
      source_ids: ["S01"],
    });
    const field = buildAdoptedBasicInfoField(item, [unsafe("S01")], now);
    expect(field.source_urls).toEqual([]);
    expect(field.tier).toBe("B");
    expect(field.value).toBe("鮨 ほそ川、鮨 山浦");
  });

  it("A'. unrelated source は canonical の出典へ入らない(誘導防止ガードの一貫性)", () => {
    const item = makeItem({ status: "confirmed", source_ids: ["S01", "S02"] });
    const field = buildAdoptedBasicInfoField(item, [unrelated("S01"), safe("S02")], now);
    expect(field.source_urls).toEqual([URL_SAFE]);
    expect(field.source_urls).not.toContain("https://example.com/other-store");
  });

  it("A''. contextual source は inferred でも出典として保持される", () => {
    const item = makeItem({
      key: "competitor_stores",
      research_policy: "ANALYSIS",
      status: "inferred",
      source_ids: ["S01"],
    });
    const field = buildAdoptedBasicInfoField(item, [safe("S01", "contextual")], now);
    expect(field.source_urls).toEqual([URL_SAFE]);
  });

  /* --- B: conflict candidate ---------------------------------------------- */

  const conflictItem = (candidateSourceIds: string[]) =>
    makeItem({
      key: "phone",
      status: "conflict",
      value: null,
      source_ids: [],
      candidates: [
        {
          candidate_id: "a",
          label: "候補A",
          value: "04-2998-0000",
          evidence: "公式サイトに記載",
          source_ids: candidateSourceIds,
        },
      ],
    });

  it("10. conflict 候補選択: safe/unsafe 混在なら safe のみが source_urls になる", () => {
    const field = buildAdoptedBasicInfoField(
      conflictItem(["S01", "S02"]),
      [unsafe("S01"), safe("S02", "target_match")],
      now,
      { selectedCandidateId: "a" },
    );
    expect(field.source_urls).toEqual([URL_SAFE]);
    expect(field.source_urls).not.toContain(URL_UNSAFE);
    expect(field.tier).toBe("A");
    expect(field.value).toBe("04-2998-0000");
  });

  it("11. conflict 候補の source が全て unsafe なら source_urls は空", () => {
    const field = buildAdoptedBasicInfoField(
      conflictItem(["S01", "S02"]),
      [unsafe("S01"), unrelated("S02")],
      now,
      { selectedCandidateId: "a" },
    );
    expect(field.source_urls).toEqual([]);
    expect(field.tier).toBe("A");
  });

  /* --- C: 編集して採用 ---------------------------------------------------- */

  it("12. editedValue が元と異なれば source_urls は undefined(既存 misattribution 対策を維持)", () => {
    const item = makeItem({ status: "confirmed", source_ids: ["S01"] });
    const field = buildAdoptedBasicInfoField(item, [safe("S01", "target_match")], now, {
      editedValue: "人間が直した値",
    });
    expect(field.source_urls).toBeUndefined();
    expect(field.confidence).toBeUndefined();
    expect(field.source_quote).toBe("人間が編集した値です(直接の出典URLはありません)。");
  });

  it("13. editedValue が元と同一なら safe filter を適用した source_urls になる", () => {
    const item = makeItem({ status: "confirmed", value: "17:00〜24:00", source_ids: ["S01", "S02"] });
    const field = buildAdoptedBasicInfoField(item, [unsafe("S01"), safe("S02", "target_match")], now, {
      editedValue: "17:00〜24:00",
    });
    expect(field.source_urls).toEqual([URL_SAFE]);
    expect(field.source_quote).toBe(item.evidence);
  });

  /* --- 14 / 15 / 16: 他のフィールドと入力の不変性 -------------------------- */

  it("14. tier 決定ルールは不変(confirmed=A / inferred=B / conflict選択=A)", () => {
    const registry = [unsafe("S01")];
    expect(
      buildAdoptedBasicInfoField(makeItem({ status: "confirmed", source_ids: ["S01"] }), registry, now)
        .tier,
    ).toBe("A");
    expect(
      buildAdoptedBasicInfoField(
        makeItem({ status: "inferred", research_policy: "ANALYSIS", source_ids: ["S01"] }),
        registry,
        now,
      ).tier,
    ).toBe("B");
    expect(
      buildAdoptedBasicInfoField(conflictItem(["S01"]), registry, now, {
        selectedCandidateId: "a",
      }).tier,
    ).toBe("A");
  });

  it("15. value / confidence / source_quote / filled_by / updated_at は不変", () => {
    const item = makeItem({ status: "confirmed", value: "17:00〜24:00", confidence: 88 });
    const field = buildAdoptedBasicInfoField(item, [unsafe("S01")], now);
    expect(field.value).toBe("17:00〜24:00");
    expect(field.confidence).toBe(88);
    expect(field.source_quote).toBe(item.evidence);
    expect(field.filled_by).toBe("manual");
    expect(field.updated_at).toBe(now);
    // 変わるのは source_urls だけ。
    expect(field.source_urls).toEqual([]);
  });

  it("16. ResearchItem.source_ids / sourceRegistry は変更されない(純関数)", () => {
    const item = makeItem({ status: "confirmed", source_ids: ["S01", "S02"] });
    const registry = [unsafe("S01"), safe("S02", "target_match")];
    const itemSnapshot = JSON.stringify(item);
    const registrySnapshot = JSON.stringify(registry);

    buildAdoptedBasicInfoField(item, registry, now);

    expect(JSON.stringify(item)).toBe(itemSnapshot);
    expect(JSON.stringify(registry)).toBe(registrySnapshot);
    expect(item.source_ids).toEqual(["S01", "S02"]);
  });
});
