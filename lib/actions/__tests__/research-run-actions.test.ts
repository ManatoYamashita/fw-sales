/**
 * `research-run-actions.ts` の単体検証(AI 店舗調査再設計 Plan v3.2, PR3/PR4)。
 *
 * `workflow/api` の `start` / `@/lib/repositories` / `@/lib/supabase/server` / `next/cache`
 * をモックし、実 Gemini API・実 DB・実 Workflow 起動を一切行わない。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchItem, SourceRegistryEntry, StoreResearchRun } from "@/types/research-run";
import type { BasicInfo } from "@/types/basic-info";

vi.mock("server-only", () => ({}));

const {
  mockStart,
  mockGetRunStatus,
  mockUpdateIfRunning,
  mockStoreGet,
  mockStoreGetForUpdate,
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
  // Workflow run の状態 (`getRun(id).status`)。#324 の突き合わせに使う。
  mockGetRunStatus: vi.fn(),
  mockUpdateIfRunning: vi.fn(),
  mockStoreGet: vi.fn(),
  // feat/ai-research-quality-ux-hardening(Plan 12.2.2): `stores` 行ロックも
  // run行ロックと同じく **別mock** にする。tx内の実装が誤ってロック無しの `get` を
  // 使うようになった場合にテストが検知できるようにするため。
  mockStoreGetForUpdate: vi.fn(),
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

vi.mock("workflow/api", () => ({
  start: mockStart,
  getRun: (id: string) => ({
    get status() {
      return mockGetRunStatus(id);
    },
  }),
}));
vi.mock("@/workflows/store-research", () => ({ storeResearchWorkflow: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { get: mockStoreGet, update: mockStoreUpdate },
    researchRun: {
      getLatestForStore: mockGetLatestForStore,
      get: mockResearchRunGet,
      create: mockCreate,
      update: mockUpdate,
      updateIfRunning: mockUpdateIfRunning,
    },
    // 監査 (#320) の書き込み先。監査そのものの検証は research-run-actions.audit.test.ts で行う。
    eventLog: { insert: vi.fn() },
    transaction: mockTransaction,
  },
}));

// review系Actionは `repos.transaction(async (tx) => ...)` 経由でtxのメソッドを呼ぶ。
// `getForUpdate` と `get` は別mockにしてあるため、行ロックが設計上必須の処理で
// 実装が誤って `get` を使った場合、`getForUpdate` が undefined を返して
// テストが失敗する(= 実装ミスを検知できる)。
mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    store: { get: mockStoreGet, getForUpdate: mockStoreGetForUpdate, update: mockStoreUpdate },
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
  completeReviewAction,
  adoptBulkLaneAction,
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
  mockGetRunStatus.mockReset();
  mockUpdateIfRunning.mockReset();
  // 開始前の実行条件チェック (#324) を通すため、AI の API キーがある環境にする。
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  mockStoreGet.mockReset();
  mockStoreGetForUpdate.mockReset();
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
  mockStoreGetForUpdate.mockResolvedValue({
    id: "store-default",
    stage: "未調査",
    basic_info: {},
  });
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
  mockGetRunStatus.mockResolvedValue("running");
  mockUpdateIfRunning.mockImplementation(async (id: string, patch: unknown) => ({
    ...makeRun({ id, status: "running" }),
    ...(patch as object),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  // 監査指摘 3 と同じ方針を Workflow 起動失敗経路にも適用する。`workflows/store-research.ts`
  // の `markFailedStep` だけを sanitize しても、この経路が raw message を同じ列へ書いて
  // いれば穴が残る。`error_message` は Client Component へ渡る `StoreResearchRun` に含まれる
  // ため、RSC payload としてブラウザへも送られる。
  it("Workflow起動失敗時にraw error messageをerror_messageへ保存しない", async () => {
    mockStart.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.7:5432 token=abc123 requestId=8f3c1d2e'),
    );

    await startResearchRunAction(nextStoreId());

    const updated = mockUpdate.mock.calls.at(-1)?.[1] as { error_message?: string };
    expect(updated.error_message).toBe("調査の開始に失敗しました");
    for (const secret of ["ECONNREFUSED", "10.0.0.7", "abc123", "8f3c1d2e"]) {
      expect(updated.error_message).not.toContain(secret);
    }
  });

  it("Workflow起動失敗はsanitized structured logへ記録する(DBから消えた分の観測性を補う)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStart.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.7:5432 token=abc123 requestId=8f3c1d2e'),
    );

    const storeId = nextStoreId();
    await startResearchRunAction(storeId);

    expect(spy).toHaveBeenCalledWith(
      "[research.startRun] workflow start failed",
      expect.objectContaining({ storeId, runId: "research_run_1", error_name: "Error" }),
    );
    // 元 Error オブジェクト・raw message はログにも渡さない。
    const logged = JSON.stringify(spy.mock.calls.at(-1));
    for (const secret of ["ECONNREFUSED", "10.0.0.7", "abc123", "8f3c1d2e"]) {
      expect(logged).not.toContain(secret);
    }
    for (const arg of spy.mock.calls.at(-1)!) {
      expect(arg).not.toBeInstanceOf(Error);
    }
    spy.mockRestore();
  });

  describe("開始前の実行条件チェック (#324)", () => {
    it("AI の API キーが無い検証環境では run を作らず、Workflow も起動せずに理由を返す", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");
      vi.stubEnv("VERCEL", "");

      const result = await startResearchRunAction(nextStoreId());

      expect(result).toEqual({
        ok: false,
        error: "この検証環境ではAI調査を実行できません。店舗情報の入力や画面の確認はできます。",
      });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("デプロイ環境で API キーが無ければ、管理者への設定依頼を返す", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");
      vi.stubEnv("VERCEL", "1");

      const result = await startResearchRunAction(nextStoreId());

      expect(result).toEqual({
        ok: false,
        error: "AI調査を利用するための設定が完了していません。管理者に設定を依頼してください。",
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("実行できない環境では、期限切れの running run も打ち切らない (既存結果を書き換えない)", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");
      mockGetLatestForStore.mockResolvedValue({
        id: "research_run_stuck",
        status: "running",
        expires_at: "2000-01-01T00:00:00.000Z",
      });

      await startResearchRunAction(nextStoreId());

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Workflow run との関連付け (#324)", () => {
    it("起動した Workflow run の ID を running の run にだけ記録する (compare-and-swap)", async () => {
      await startResearchRunAction(nextStoreId());

      expect(mockUpdateIfRunning).toHaveBeenCalledWith("research_run_1", {
        token_usage: { workflow_run_id: "wrun_1" },
      });
    });

    it("記録に失敗しても調査の開始は成功として返す (調査自体は進んでいる)", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockUpdateIfRunning.mockRejectedValue(new Error("db down host=10.0.0.7"));

      const result = await startResearchRunAction(nextStoreId());

      expect(result.ok).toBe(true);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("10.0.0.7");
      spy.mockRestore();
    });

    it("空文字の VERCEL_URL を未定義に戻してから起動する (SDK が https:// を URL として扱い失敗するため)", async () => {
      vi.stubEnv("VERCEL_URL", "");
      let seenAtStart: string | undefined = "not called";
      mockStart.mockImplementation(async () => {
        seenAtStart = process.env.VERCEL_URL;
        return { runId: "wrun_1" };
      });

      await startResearchRunAction(nextStoreId());

      expect(seenAtStart).toBeUndefined();
      expect("VERCEL_URL" in process.env).toBe(false);
    });
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

  it("未ログインの文は、画面が「再ログイン」の案内に切り替える文と一致する (#324)", async () => {
    const { STATUS_CHECK_SIGNED_OUT_ERROR } = await import(
      "@/app/(main)/research/[storeId]/_components/use-research-run-polling"
    );
    mockGetCurrentSession.mockResolvedValue(null);
    const result = await getResearchRunStatusAction("research_run_1");
    expect(result).toEqual({ ok: false, error: STATUS_CHECK_SIGNED_OUT_ERROR });
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

  describe("実行基盤の終了状態との突き合わせ (#324)", () => {
    const runningRun = () =>
      makeRun({
        status: "running",
        stage: null,
        result: null,
        token_usage: { workflow_run_id: "wrun_9" },
        finished_at: null,
      });

    it("enqueue 後に実行基盤で失敗した run は failed として記録して返す", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockResearchRunGet.mockResolvedValue(runningRun());
      mockGetRunStatus.mockResolvedValue("failed");

      const result = await getResearchRunStatusAction("research_run_1");

      expect(mockGetRunStatus).toHaveBeenCalledWith("wrun_9");
      expect(mockUpdateIfRunning).toHaveBeenCalledWith(
        "research_run_1",
        expect.objectContaining({
          status: "failed",
          error_kind: "workflow_run_failed",
          error_message: "AI店舗調査に失敗しました",
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe("failed");
        expect(result.data.error_kind).toBe("workflow_run_failed");
      }
      // 他の画面 (一覧・店舗詳細) のキャッシュも古い「実行中」を出さないようにする。
      expect(mockRevalidateTag).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("正常な長時間処理 (実行基盤も running) は running のまま返し、何も書き込まない", async () => {
      const run = makeRun({ ...runningRun(), started_at: "2000-01-01T00:00:00.000Z" });
      mockResearchRunGet.mockResolvedValue(run);
      mockGetRunStatus.mockResolvedValue("running");

      const result = await getResearchRunStatusAction(run.id);

      expect(result.ok && result.data.status).toBe("running");
      expect(mockUpdateIfRunning).not.toHaveBeenCalled();
      expect(mockRevalidateTag).not.toHaveBeenCalled();
    });

    it("実行基盤に問い合わせられないときは失敗と断定せず running のまま返す", async () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockResearchRunGet.mockResolvedValue(runningRun());
      mockGetRunStatus.mockRejectedValue(new Error("WorkflowAPIError token=secret-abc"));

      const result = await getResearchRunStatusAction("research_run_1");

      expect(result.ok && result.data.status).toBe("running");
      expect(mockUpdateIfRunning).not.toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-abc");
      spy.mockRestore();
    });

    it("終了済みの run は実行基盤へ問い合わせない", async () => {
      mockResearchRunGet.mockResolvedValue(
        makeRun({ status: "failed", token_usage: { workflow_run_id: "wrun_9" } }),
      );

      await getResearchRunStatusAction("research_run_1");

      expect(mockGetRunStatus).not.toHaveBeenCalled();
    });
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

  it("adoptBulkLaneActionはgetForUpdateでrun行をロックする", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);

    await adoptBulkLaneAction({
      runId: run.id,
      storeId: run.store_id,
      expectedKeys: ["business_hours_holidays"],
      complete: false,
    });

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

    const result = await adoptBulkLaneAction({
      runId: run.id,
      storeId: run.store_id,
      expectedKeys: ["business_hours_holidays"],
      complete: false,
    });

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

  it("いまの値と同じ(正規化して一致)なら、判断だけ記録し basic_info を書き換えない (#319)", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);
    mockStoreGetForUpdate.mockResolvedValue({
      id: run.store_id,
      stage: "調査済み",
      basic_info: {
        business_hours_holidays: {
          value: "１７:００〜２４:００",
          tier: "A",
          filled_by: "manual",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      },
    });

    const result = await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({
        review_decisions: expect.objectContaining({
          business_hours_holidays: expect.objectContaining({ decision: "adopted" }),
        }),
      }),
    );
  });

  it("いまの値と違えば上書きする(上のテストの検知能力の確認)", async () => {
    const run = makeRun();
    mockGetForUpdate.mockResolvedValue(run);
    mockStoreGetForUpdate.mockResolvedValue({
      id: run.store_id,
      stage: "調査済み",
      basic_info: {
        business_hours_holidays: {
          value: "18:00〜23:00",
          tier: "A",
          filled_by: "manual",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      },
    });

    await recordReviewDecisionAction({
      runId: run.id,
      storeId: run.store_id,
      itemKey: "business_hours_holidays",
      decision: "adopted",
    });

    expect(mockStoreUpdate).toHaveBeenCalledTimes(1);
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
    mockStoreGetForUpdate.mockResolvedValue({ id: run.store_id, stage: "未調査", basic_info: {} });

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
    mockStoreGetForUpdate.mockResolvedValue({ id: run.store_id, stage: "架電済み", basic_info: {} });

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

/**
 * 「残りを採用して調査完了」(feat/ai-research-quality-ux-hardening、Plan §12.2)。
 *
 * 既存2 action(`bulkAdoptConfirmedAction` / `completeReviewAction`)の body を
 * **1トランザクション**に連結したもの。既存の不変条件をすべて維持する。
 */
describe("adoptBulkLaneAction (#301, #319)", () => {
  const NOW_KEYS = ["business_hours_holidays", "seat_count"];
  const ITEMS: ResearchItem[] = [
    { key: "business_hours_holidays", research_policy: "FACT", status: "confirmed", value: "17:00-24:00", evidence: "e", source_ids: [] },
    { key: "seat_count", research_policy: "FACT", status: "confirmed", value: "20席", evidence: "e", source_ids: [] },
    { key: "main_target", research_policy: "ANALYSIS", status: "inferred", value: "30代", evidence: "e", source_ids: [] },
  ];

  /** 調査結果から採用済みの値(`source_quote` あり)。 */
  const adopted = (value: string) => ({
    value,
    tier: "A" as const,
    source_quote: "前回の根拠",
    filled_by: "manual" as const,
    updated_at: "2026-09-01T00:00:00.000Z",
  });

  const call = (overrides: Partial<Parameters<typeof adoptBulkLaneAction>[0]> = {}) =>
    adoptBulkLaneAction({
      runId: "research_run_1",
      storeId: "store-1",
      expectedKeys: NOW_KEYS,
      complete: false,
      ...overrides,
    });

  beforeEach(() => {
    mockGetForUpdate.mockResolvedValue(makeRun({ result: ITEMS }));
    mockStoreGetForUpdate.mockResolvedValue({ id: "store-1", stage: "未調査", basic_info: {} });
  });

  it("まとめて採用の対象(注記の無い確認済みの新規)だけを採用し、推定は採用しない", async () => {
    const result = await call();

    expect(result.ok).toBe(true);
    const patch = mockStoreUpdate.mock.calls[0]![1] as {
      basic_info: Record<string, { tier: string; filled_by: string }>;
    };
    expect(patch.basic_info.business_hours_holidays!.tier).toBe("A");
    expect(patch.basic_info.seat_count!.filled_by).toBe("manual");
    expect(patch.basic_info.main_target).toBeUndefined();
    const runPatch = mockUpdate.mock.calls[0]![1] as { review_decisions: Record<string, unknown> };
    expect(runPatch.review_decisions.main_target).toBeUndefined();
  });

  it("推定を expectedKeys に含めたら、何も書き込まずに拒否する", async () => {
    const result = await call({ expectedKeys: [...NOW_KEYS, "main_target"] });

    expect(result.ok).toBe(false);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("画面の表示後に基本情報が変わり上書きになった項目があれば、何も書き込まずに拒否する", async () => {
    mockStoreGetForUpdate.mockResolvedValue({
      id: "store-1",
      stage: "未調査",
      basic_info: { seat_count: adopted("18席") },
    });

    const result = await call();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("再読み込み");
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("上書きにならないことの対照: いまの値が同じなら受け付ける(上のテストの検知能力の確認)", async () => {
    mockStoreGetForUpdate.mockResolvedValue({
      id: "store-1",
      stage: "未調査",
      basic_info: { seat_count: adopted("20席") },
    });

    const result = await call();

    expect(result.ok).toBe(true);
  });

  it("同じ値の項目は判断だけ記録し、基本情報の値・出典・更新日時を書き換えない", async () => {
    const current = adopted("２０席 ");
    mockStoreGetForUpdate.mockResolvedValue({
      id: "store-1",
      stage: "未調査",
      basic_info: { seat_count: current },
    });

    const result = await call();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.adoptedCount).toBe(2);
      expect(result.data.changedCount).toBe(1);
    }
    const patch = mockStoreUpdate.mock.calls[0]![1] as { basic_info: Record<string, unknown> };
    expect(patch.basic_info.seat_count).toBe(current);
    const runPatch = mockUpdate.mock.calls[0]![1] as {
      review_decisions: Record<string, { decision: string }>;
    };
    expect(runPatch.review_decisions.seat_count!.decision).toBe("adopted");
  });

  it("すべて同じ値なら stores へ書き込まない", async () => {
    mockStoreGetForUpdate.mockResolvedValue({
      id: "store-1",
      stage: "未調査",
      basic_info: { business_hours_holidays: adopted("17:00-24:00"), seat_count: adopted("20席") },
    });

    const result = await call();

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("complete: true は、採用後に未判断が残るなら何も書き込まずに拒否する", async () => {
    const result = await call({ complete: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1件");
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("complete: true で未判断が残らなければ、完了時刻と stage を 1 回の書き込みで記録する", async () => {
    mockGetForUpdate.mockResolvedValue(makeRun({ result: ITEMS.slice(0, 2) }));

    const result = await call({ complete: true });

    expect(result.ok).toBe(true);
    expect(mockStoreUpdate).toHaveBeenCalledTimes(1);
    const patch = mockStoreUpdate.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.stage).toBe("調査済み");
    expect(patch.basic_info).toBeDefined();
    const runPatch = mockUpdate.mock.calls[0]![1] as {
      review_completed_at: string;
      review_decisions: Record<string, { decided_at: string }>;
    };
    if (result.ok) {
      expect(result.data.reviewCompletedAt).toBe(runPatch.review_completed_at);
      expect(result.data.reviewDecisions).toEqual(runPatch.review_decisions);
    }
    const times = new Set(Object.values(runPatch.review_decisions).map((d) => d.decided_at));
    expect([...times]).toEqual([runPatch.review_completed_at]);
  });

  it("complete: false では完了時刻も stage も書かない", async () => {
    const result = await call();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.reviewCompletedAt).toBeNull();
    const patch = mockStoreUpdate.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.stage).toBeUndefined();
    const runPatch = mockUpdate.mock.calls[0]![1] as Record<string, unknown>;
    expect(runPatch.review_completed_at).toBeUndefined();
  });

  it("架電済みを調査済みへ降格させない", async () => {
    mockGetForUpdate.mockResolvedValue(makeRun({ result: ITEMS.slice(0, 2) }));
    mockStoreGetForUpdate.mockResolvedValue({ id: "store-1", stage: "架電済み", basic_info: {} });

    await call({ complete: true });

    const patch = mockStoreUpdate.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.stage).toBeUndefined();
  });

  it("既存の判断は変更しない(immutable)。判断済みの key を expectedKeys に含めたら拒否する", async () => {
    mockGetForUpdate.mockResolvedValue(
      makeRun({
        result: ITEMS,
        review_decisions: {
          business_hours_holidays: { decision: "rejected", decided_at: "2026-08-01T00:00:00.000Z" },
        },
      }),
    );

    expect((await call()).ok).toBe(false);
    expect((await call({ expectedKeys: ["seat_count"] })).ok).toBe(true);
    const runPatch = mockUpdate.mock.calls[0]![1] as {
      review_decisions: Record<string, { decision: string }>;
    };
    expect(runPatch.review_decisions.business_hours_holidays!.decision).toBe("rejected");
  });

  it("run行とstore行の両方をgetForUpdateでロックする(getは使わない)", async () => {
    await call();

    expect(mockGetForUpdate).toHaveBeenCalledWith("research_run_1");
    expect(mockStoreGetForUpdate).toHaveBeenCalledWith("store-1");
    expect(mockResearchRunGet).not.toHaveBeenCalled();
    expect(mockStoreGet).not.toHaveBeenCalled();
  });

  it("完了済みrun / succeeded以外 / store_id不一致 は拒否する", async () => {
    mockGetForUpdate.mockResolvedValue(makeRun({ result: ITEMS, review_completed_at: "2026-08-01T00:00:00.000Z" }));
    expect((await call()).ok).toBe(false);

    mockGetForUpdate.mockResolvedValue(makeRun({ result: ITEMS, status: "running" }));
    expect((await call()).ok).toBe(false);

    mockGetForUpdate.mockResolvedValue(makeRun({ result: ITEMS }));
    expect((await call({ storeId: "other-store" })).ok).toBe(false);
  });

  it.each([
    ["空の expectedKeys", { expectedKeys: [] }],
    ["重複した expectedKeys", { expectedKeys: ["seat_count", "seat_count"] }],
    ["空文字の key", { expectedKeys: [""] }],
  ])("%s は拒否する", async (_, overrides) => {
    expect((await call(overrides)).ok).toBe(false);
    expect(mockGetForUpdate).not.toHaveBeenCalled();
  });

  it("revalidateTagはtransaction成功後に呼ぶ", async () => {
    const order: string[] = [];
    mockUpdate.mockImplementation(async () => {
      order.push("db");
    });
    mockRevalidateTag.mockImplementation(() => {
      order.push("revalidate");
    });

    await call();

    expect(order[0]).toBe("db");
    expect(order).toContain("revalidate");
  });

  it("拒否したときは revalidateTag を呼ばない", async () => {
    await call({ expectedKeys: ["main_target"] });

    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});
