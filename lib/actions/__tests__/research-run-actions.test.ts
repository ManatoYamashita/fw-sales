/**
 * `research-run-actions.ts` の単体検証(AI 店舗調査再設計 Plan v3.2, PR3/PR4)。
 *
 * `workflow/api` の `start` / `@/lib/repositories` / `@/lib/supabase/server` / `next/cache`
 * をモックし、実 Gemini API・実 DB・実 Workflow 起動を一切行わない。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchItem, SourceRegistryEntry, StoreResearchRun } from "@/types/research-run";
import type { BasicInfo } from "@/types/basic-info";

vi.mock("server-only", () => ({}));

const {
  mockStart,
  mockStoreGet,
  mockStoreUpdate,
  mockGetLatestForStore,
  mockResearchRunGet,
  mockGetForUpdate,
  mockCreate,
  mockUpdate,
  mockRevalidateTag,
  mockGetCurrentSession,
  mockTransaction,
} = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreUpdate: vi.fn(),
  mockGetLatestForStore: vi.fn(),
  mockResearchRunGet: vi.fn(),
  // fix: PR #180 review Finding 5。`getForUpdate`(SELECT ... FOR UPDATE)と通常`get`は
  // **別のmock**にする。同一mockを共有していると、実装が誤って行ロック無しの`get`を
  // 使うようになってもテストが検知できなかった。
  mockGetForUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockGetCurrentSession: vi.fn(),
  // feat/research-review-write-integrity(MAJOR10): review系Actionは
  // repos.transaction(async (tx) => ...) 経由でgetForUpdate/get/updateを呼ぶ。
  // 実装はこのブロックの外側(他のmockが変数として参照可能になった後)で設定する。
  mockTransaction: vi.fn(),
}));

vi.mock("workflow/api", () => ({ start: mockStart }));
vi.mock("@/workflows/store-research", () => ({ storeResearchWorkflow: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { get: mockStoreGet, update: mockStoreUpdate },
    researchRun: {
      getLatestForStore: mockGetLatestForStore,
      get: mockResearchRunGet,
      create: mockCreate,
      update: mockUpdate,
    },
    transaction: mockTransaction,
  },
}));

// review系Actionは `repos.transaction(async (tx) => ...)` 経由でtxのメソッドを呼ぶ。
// `getForUpdate` と `get` は別mockにしてあるため、行ロックが設計上必須の処理で
// 実装が誤って `get` を使った場合、`getForUpdate` が undefined を返して
// テストが失敗する(= 実装ミスを検知できる)。
mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    store: { get: mockStoreGet, update: mockStoreUpdate },
    researchRun: {
      getForUpdate: mockGetForUpdate,
      get: mockResearchRunGet,
      create: mockCreate,
      update: mockUpdate,
    },
  }),
);
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentSession: mockGetCurrentSession }));

const {
  startResearchRunAction,
  getResearchRunStatusAction,
  recordReviewDecisionAction,
  bulkAdoptConfirmedAction,
  completeReviewAction,
} = await import("../research-run-actions");
const { _resetRateLimitForTest } = await import("@/lib/ai/rate-limiter");

let seq = 0;
const nextStoreId = () => `store-${++seq}`;

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
    store_id: "store-1",
    requested_by_user_id: null,
    status: "succeeded",
    stage: "done",
    result: [makeItem()],
    source_registry: [makeSource()],
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

function makeBasicInfo(): BasicInfo {
  return {};
}

/**
 * postgres-js の `PostgresError` 互換オブジェクト(`lib/db/postgres-error.ts` が
 * `name === "PostgresError"` + `code` で検出する形)。
 */
function makePgError(code: string, extra: Record<string, unknown> = {}) {
  return { name: "PostgresError", message: `pg ${code}`, code, ...extra };
}

beforeEach(() => {
  mockStart.mockReset();
  mockStoreGet.mockReset();
  mockStoreUpdate.mockReset();
  mockGetLatestForStore.mockReset();
  mockResearchRunGet.mockReset();
  mockGetForUpdate.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockRevalidateTag.mockReset();
  mockGetCurrentSession.mockReset();
  _resetRateLimitForTest();

  mockGetCurrentSession.mockResolvedValue({ userId: "user-1", email: "a@example.com" });
  mockStoreGet.mockResolvedValue({
    id: "store-1",
    name: "テスト店舗",
    stage: "未調査",
    basic_info: makeBasicInfo(),
  });
  mockStoreUpdate.mockImplementation(async (id: string, patch: unknown) => ({ id, ...(patch as object) }));
  mockGetLatestForStore.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "research_run_1", store_id: "store-1", status: "running" });
  mockUpdate.mockImplementation(async (id: string, patch: unknown) => ({ id, ...(patch as object) }));
  mockStart.mockResolvedValue({ runId: "wrun_1" });
});

describe("startResearchRunAction", () => {
  it("未ログインならエラーを返しDB/Workflowを一切呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(null);

    const result = await startResearchRunAction(nextStoreId());

    expect(result.ok).toBe(false);
    expect(mockStoreGet).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("storeIdが空文字ならエラーを返す", async () => {
    const result = await startResearchRunAction("");
    expect(result.ok).toBe(false);
  });

  it("店舗が存在しなければエラーを返す", async () => {
    mockStoreGet.mockResolvedValue(null);

    const result = await startResearchRunAction(nextStoreId());

    expect(result.ok).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("既にrunning runがあれば二重起動を拒否する", async () => {
    mockGetLatestForStore.mockResolvedValue({
      status: "running",
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    const result = await startResearchRunAction(nextStoreId());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("既に調査中");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("running runがexpires_atを過ぎている(stuck run)場合はfailedへ倒してから新規runを許可する", async () => {
    mockGetLatestForStore.mockResolvedValue({
      id: "research_run_stuck",
      status: "running",
      expires_at: "2000-01-01T00:00:00.000Z",
    });

    const storeId = nextStoreId();
    const result = await startResearchRunAction(storeId);

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      "research_run_stuck",
      expect.objectContaining({ status: "failed", error_kind: "stuck_run_timeout" }),
    );
    expect(mockCreate).toHaveBeenCalledWith({
      store_id: storeId,
      requested_by_user_id: "user-1",
    });
  });

  it("正常系: runを作成しWorkflowを起動する", async () => {
    const storeId = nextStoreId();

    const result = await startResearchRunAction(storeId);

    expect(result.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({
      store_id: storeId,
      requested_by_user_id: "user-1",
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    const startArgs = mockStart.mock.calls[0];
    expect(startArgs?.[1]).toEqual(["research_run_1", storeId]);
    expect(mockRevalidateTag).toHaveBeenCalled();
  });

  it("DB作成が部分ユニークインデックス違反(SQLSTATE 23505)で失敗した場合、二重起動エラーとして扱う(レース対策)", async () => {
    mockCreate.mockRejectedValue(
      makePgError("23505", {
        constraint_name: "store_research_runs_running_store_idx",
        table_name: "store_research_runs",
      }),
    );

    const result = await startResearchRunAction(nextStoreId());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("既に調査中");
    expect(mockStart).not.toHaveBeenCalled();
  });

  // fix: PR #180 review Finding 4。旧実装は裸の `catch {}` で全失敗を二重起動扱いし、
  // ログも残さなかったため、接続断・権限エラー等が「既に調査中」という誤った案内のまま
  // 検知不能になっていた。
  describe("create()のエラー分類(SQLSTATEを判別する)", () => {
    it("23505以外のDBエラーは二重起動扱いにせず、汎用文言を返す", async () => {
      mockCreate.mockRejectedValue(makePgError("08006", { message: "connection failure" }));

      const result = await startResearchRunAction(nextStoreId());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).not.toContain("既に調査中");
        expect(result.error).toContain("調査の開始に失敗");
      }
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("23505以外のDBエラーはSQLSTATE等を構造化ログへ残す(運用で原因を追えるように)", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockCreate.mockRejectedValue(
        makePgError("42501", { table_name: "store_research_runs", constraint_name: "some_constraint" }),
      );

      await startResearchRunAction(nextStoreId());

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("[research.startRun]"),
        expect.objectContaining({ code: "42501", table: "store_research_runs" }),
      );
      spy.mockRestore();
    });

    it("DBエラーのraw messageやdetailをUIへ露出しない", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockCreate.mockRejectedValue(
        makePgError("42501", {
          message: "permission denied for table store_research_runs",
          detail: "internal schema detail that must not leak",
        }),
      );

      const result = await startResearchRunAction(nextStoreId());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).not.toContain("permission denied");
        expect(result.error).not.toContain("internal schema detail");
      }
      spy.mockRestore();
    });

    it("PostgresErrorとして解釈できないエラーも二重起動扱いにしない", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockCreate.mockRejectedValue(new Error("unexpected non-pg failure"));

      const result = await startResearchRunAction(nextStoreId());

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).not.toContain("既に調査中");
      spy.mockRestore();
    });

    it("PostgresErrorとして解釈できないエラーでもerror識別子をログに残す(全項目undefinedにしない)", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockCreate.mockRejectedValue(new TypeError("fetch failed"));

      await startResearchRunAction(nextStoreId());

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("[research.startRun]"),
        expect.objectContaining({ unrecognized_error_name: "TypeError" }),
      );
      // 生メッセージはログにも含めない(DB由来の値が混入しうるため)。
      const logged = JSON.stringify(spy.mock.calls[0]?.[1]);
      expect(logged).not.toContain("fetch failed");
      spy.mockRestore();
    });
  });

  it("Workflow起動が失敗したらrunをfailedへ遷移させる", async () => {
    mockStart.mockRejectedValue(new Error("workflow infra error"));

    const result = await startResearchRunAction(nextStoreId());

    expect(result.ok).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(
      "research_run_1",
      expect.objectContaining({ status: "failed", error_kind: "workflow_start_failed" }),
    );
  });

  it("レート制限に達している場合はエラーを返す", async () => {
    const storeId = nextStoreId();
    // per-store 上限(10分5回)に達するまで呼び出す
    for (let i = 0; i < 5; i++) {
      await startResearchRunAction(storeId);
    }
    mockCreate.mockClear();

    const result = await startResearchRunAction(storeId);

    expect(result.ok).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("getResearchRunStatusAction", () => {
  it("未ログインならエラー", async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    const result = await getResearchRunStatusAction("research_run_1");
    expect(result.ok).toBe(false);
  });

  it("存在しないrunはエラー", async () => {
    mockResearchRunGet.mockResolvedValue(null);
    const result = await getResearchRunStatusAction("missing");
    expect(result.ok).toBe(false);
  });

  it("正常系: runをそのまま返す", async () => {
    const run = makeRun();
    mockResearchRunGet.mockResolvedValue(run);
    const result = await getResearchRunStatusAction(run.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(run.id);
  });
});

/**
 * 行ロック(`SELECT ... FOR UPDATE`)が設計上必須のreview系書込みAction
 * (feat/research-review-write-integrity MAJOR10)について、実際に `getForUpdate` が
 * 呼ばれ、ロック無しの `get` が使われていないことを検証する
 * (fix: PR #180 review Finding 5)。
 */
describe("review系Actionの行ロック(getForUpdate)呼び出し", () => {
  it("recordReviewDecisionActionはgetForUpdateでrun行をロックする", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });

    expect(mockGetForUpdate).toHaveBeenCalledWith(run.id);
    expect(mockResearchRunGet).not.toHaveBeenCalled();
  });

  it("bulkAdoptConfirmedActionはgetForUpdateでrun行をロックする", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    await bulkAdoptConfirmedAction({ runId: run.id, storeId: run.store_id });

    expect(mockGetForUpdate).toHaveBeenCalledWith(run.id);
    expect(mockResearchRunGet).not.toHaveBeenCalled();
  });

  it("completeReviewActionはgetForUpdateでrun行をロックする", async () => {
    const run = makeRun({ review_decisions: { business_hours_holidays: { decision: "skipped", decided_at: "2026-08-01T00:00:00.000Z" } } });
    mockGetForUpdate.mockResolvedValue(run);

    await completeReviewAction({ runId: run.id, storeId: run.store_id, skipRemaining: false });

    expect(mockGetForUpdate).toHaveBeenCalledWith(run.id);
    expect(mockResearchRunGet).not.toHaveBeenCalled();
  });

  it("トランザクション内でgetしか呼ばない実装だったら失敗する(テストの検知能力の確認)", async () => {
    // `getForUpdate` と `get` が同一mockだった旧テストでは、この差を区別できなかった。
    // 通常の `get` にだけrunを設定した状態では、行ロック経由の読み出しは何も得られない。
    const run = makeRun();
    mockResearchRunGet.mockResolvedValue(run);
    mockGetForUpdate.mockResolvedValue(null);

    const result = await bulkAdoptConfirmedAction({ runId: run.id, storeId: run.store_id });

    expect(result.ok).toBe(false);
  });
});

describe("recordReviewDecisionAction", () => {
  it("採用(adopted)時にbasic_infoへmanualソースで即時反映する", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).toHaveBeenCalledWith(
      run.store_id,
      expect.objectContaining({
        basic_info: expect.objectContaining({
          business_hours_holidays: expect.objectContaining({
            value: "17:00〜24:00",
            tier: "A",
            filled_by: "manual",
          }),
        }),
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({
        review_decisions: expect.objectContaining({
          business_hours_holidays: expect.objectContaining({ decision: "adopted" }),
        }),
      }),
    );
  });

  it("却下(rejected)時はbasic_infoを変更しない", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "rejected",
    });

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({
        review_decisions: expect.objectContaining({
          business_hours_holidays: expect.objectContaining({ decision: "rejected" }),
        }),
      }),
    );
  });

  it("reviewable でない項目(hearing_required)は拒否する", async () => {
    const run = makeRun({
      result: [makeItem({ key: "revenue", status: "hearing_required", value: null, source_ids: [] })],
    });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "revenue",
      decision: "adopted",
    });

    expect(result.ok).toBe(false);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
  });

  it("conflict項目でselected_candidate_id未指定のadoptedは拒否する(value:null誤書込み防止)", async () => {
    const run = makeRun({
      result: [
        makeItem({
          status: "conflict",
          value: null,
          candidates: [
            { candidate_id: "c1", label: "候補A", value: "v1", evidence: "e1", source_ids: ["S01"] },
          ],
        }),
      ],
    });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });

    expect(result.ok).toBe(false);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("conflict項目でcandidates外のselected_candidate_idは不正として拒否する", async () => {
    const run = makeRun({
      result: [
        makeItem({
          status: "conflict",
          value: null,
          candidates: [
            { candidate_id: "c1", label: "候補A", value: "v1", evidence: "e1", source_ids: ["S01"] },
          ],
        }),
      ],
    });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
      selectedCandidateId: "does-not-exist",
    });

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("レビュー完了済みのrunは拒否する", async () => {
    const run = makeRun({ review_completed_at: "2026-08-01T01:00:00.000Z" });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });

    expect(result.ok).toBe(false);
  });

  it("既に判断済みのitemKeyへの再判断は拒否する(feat/research-review-write-integrity、MAJOR10: immutable設計)", async () => {
    const run = makeRun({
      review_decisions: {
        business_hours_holidays: { decision: "adopted", decided_at: "2026-08-01T00:30:00.000Z" },
      },
    });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "rejected",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("既に判断済み");
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("editedValueが空文字ならcanonicalへ保存せず拒否する(MAJOR11)", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
      editedValue: "",
    });

    expect(result.ok).toBe(false);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
  });

  it("editedValueが空白のみでも拒否する(MAJOR11)", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
      editedValue: "   ",
    });

    expect(result.ok).toBe(false);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
  });

  it("editedValueの前後の空白はtrimして保存する", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
      editedValue: "  17:00-23:00  ",
    });

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).toHaveBeenCalledWith(
      run.store_id,
      expect.objectContaining({
        basic_info: expect.objectContaining({
          business_hours_holidays: expect.objectContaining({ value: "17:00-23:00" }),
        }),
      }),
    );
  });

  it("decisionが不正な値(未知のenum)ならruntimeで拒否する(追加修正E)", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      // @ts-expect-error 不正値をruntime検証するためのテスト
      decision: "not_a_real_decision",
    });

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("runId/storeId/itemKeyが文字列以外ならruntimeで拒否する(追加修正E)", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      // @ts-expect-error 不正型をruntime検証するためのテスト
      runId: 123,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });

    expect(result.ok).toBe(false);
    expect(mockGetForUpdate).not.toHaveBeenCalled();
  });

  it("runId/storeId/itemKeyが空文字(型は正しいが空)ならruntimeで拒否する(fix/ai-research-final-audit-hardening、欠落していたテストケース)", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    const blankRunId = await recordReviewDecisionAction({
      runId: "",
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });
    expect(blankRunId.ok).toBe(false);

    const blankStoreId = await recordReviewDecisionAction({
      runId: run.id,
      storeId: "",
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });
    expect(blankStoreId.ok).toBe(false);

    const blankItemKey = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "",
      decision: "adopted",
    });
    expect(blankItemKey.ok).toBe(false);

    expect(mockGetForUpdate).not.toHaveBeenCalled();
  });

  it("selectedCandidateIdが空文字ならruntimeで明示的に拒否する(fix/ai-research-final-audit-hardening、以前は候補一覧に存在しないことによる偶然の拒否のみだった)", async () => {
    const run = makeRun({
      result: [
        makeItem({
          status: "conflict",
          value: null,
          candidates: [
            { candidate_id: "c1", label: "候補A", value: "v1", evidence: "e1", source_ids: ["S01"] },
          ],
        }),
      ],
    });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
      selectedCandidateId: "",
    });

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("bulkAdoptConfirmedAction", () => {
  it("confirmed かつ未対応の項目のみ一括採用し、書込みは1回ずつにまとめる", async () => {
    const run = makeRun({
      result: [
        makeItem({ key: "store_name", status: "confirmed", value: "A店" }),
        makeItem({ key: "address", status: "confirmed", value: "東京都..." }),
        makeItem({ key: "average_spend_day_night", status: "inferred", value: "3000円" }),
      ],
    });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await bulkAdoptConfirmedAction({ runId: run.id, storeId: run.store_id });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.adoptedCount).toBe(2);
    expect(mockStoreUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const basicInfoArg = mockStoreUpdate.mock.calls[0]?.[1]?.basic_info;
    expect(basicInfoArg.store_name.tier).toBe("A");
    expect(basicInfoArg.address.tier).toBe("A");
    expect(basicInfoArg.average_spend_day_night).toBeUndefined();
  });

  it("対象が無ければ書込みを行わない", async () => {
    const run = makeRun({
      result: [makeItem({ status: "inferred" })],
    });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await bulkAdoptConfirmedAction({ runId: run.id, storeId: run.store_id });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.adoptedCount).toBe(0);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
  });
});

describe("completeReviewAction", () => {
  it("未対応項目が残っている場合、skipRemaining=falseなら拒否する", async () => {
    const run = makeRun({ result: [makeItem()] });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await completeReviewAction({
      runId: run.id,
      storeId: run.store_id,
      skipRemaining: false,
    });

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skipRemaining=trueなら残りをskippedにして完了する", async () => {
    const run = makeRun({ result: [makeItem()] });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await completeReviewAction({
      runId: run.id,
      storeId: run.store_id,
      skipRemaining: true,
    });

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({
        review_decisions: expect.objectContaining({
          business_hours_holidays: expect.objectContaining({ decision: "skipped" }),
        }),
        review_completed_at: expect.any(String),
      }),
    );
  });

  it("全件対応済みなら未調査→調査済みへ遷移する", async () => {
    const run = makeRun({
      result: [makeItem()],
      review_decisions: { business_hours_holidays: { decision: "adopted", decided_at: "x" } },
    });
    mockGetForUpdate.mockResolvedValue(run);
    mockStoreGet.mockResolvedValue({ id: run.store_id, stage: "未調査", basic_info: {} });

    const result = await completeReviewAction({
      runId: run.id,
      storeId: run.store_id,
      skipRemaining: false,
    });

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).toHaveBeenCalledWith(run.store_id, { stage: "調査済み" });
  });

  it("既に調査済み/架電済みの店舗は降格させない(stage変更しない)", async () => {
    const run = makeRun({
      result: [makeItem()],
      review_decisions: { business_hours_holidays: { decision: "adopted", decided_at: "x" } },
    });
    mockGetForUpdate.mockResolvedValue(run);
    mockStoreGet.mockResolvedValue({ id: run.store_id, stage: "架電済み", basic_info: {} });

    const result = await completeReviewAction({
      runId: run.id,
      storeId: run.store_id,
      skipRemaining: false,
    });

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).not.toHaveBeenCalledWith(run.store_id, expect.objectContaining({ stage: expect.anything() }));
  });

  it("レビュー完了済みのrunは再度完了できない", async () => {
    const run = makeRun({ review_completed_at: "2026-08-01T01:00:00.000Z" });
    mockGetForUpdate.mockResolvedValue(run);

    const result = await completeReviewAction({
      runId: run.id,
      storeId: run.store_id,
      skipRemaining: true,
    });

    expect(result.ok).toBe(false);
  });
});
