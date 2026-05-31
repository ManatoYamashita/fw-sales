/**
 * poll-research pipeline 単体テスト
 *
 * 検証ケース:
 *   Case 1: researching completed → structuring (structurer 不呼出、completed 増えない)
 *   Case 2: structuring → Stage 2 成功 → done (structured/completed += 1)
 *   Case 3: Stage 2 開始前 deadline 不足 → structuring のまま、completed 増えない
 *   Case 4: Stage 2 実行中 timeout (上限未達) → still_structuring、completed 増えない
 *   Case 5: Stage 2 timeout 上限超過 → failed (stage2_timeout_exceeded)
 *   Case 6: Stage 2 本当の失敗 (schema_violation) → failed、completed 増えない
 *   Case 7: queued → researching (startOneQueued 既存動作)
 *   Case S1〜S8: Stage A2 進捗停滞 (stall) 検知 sweep
 *     S1 cancel+stage1_stalled_no_progress で failed / S2 cancel throw でも failed /
 *     S3 stalled_swept 別計上 / S3a cap 解放リンケージ / S3b 負の対照(cap 一杯) /
 *     S4 クエリ引数境界 / S5 0件 no-op / S6 deadline skip / S7 6h sweep と共存 /
 *     S8 reason 未指定の回帰
 *
 * 関連: deep-research-pipeline spec (Issue #43 follow-up, Stage 2 timeout fix /
 *       Stage 1 stall detection)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — モック変数を最上位に巻き上げ
// ---------------------------------------------------------------------------
const {
  mockFindStuck,
  mockFindStalled,
  mockFindResearching,
  mockFindStructuring,
  mockClaimQueued,
  mockCountInFlight,
  mockUpdateJobStatus,
  mockAppendJobError,
  mockInsertReport,
  mockGetStore,
  mockTransaction,
  mockRevalidateTag,
  mockCreateNotification,
  mockGetInFlightCap,
  mockGetPollPerTick,
  mockGetMonthlyCap,
  mockGetMonthlyWarningPercent,
  mockGetStallThresholdMs,
  mockGetStallGraceMs,
  mockCountByMonthRepo,
} = vi.hoisted(() => ({
  mockFindStuck: vi.fn(),
  mockFindStalled: vi.fn(),
  mockFindResearching: vi.fn(),
  mockFindStructuring: vi.fn(),
  mockClaimQueued: vi.fn(),
  mockCountInFlight: vi.fn(),
  mockUpdateJobStatus: vi.fn(),
  mockAppendJobError: vi.fn(),
  mockInsertReport: vi.fn(),
  mockGetStore: vi.fn(),
  mockTransaction: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockGetInFlightCap: vi.fn(),
  mockGetPollPerTick: vi.fn(),
  mockGetMonthlyCap: vi.fn(),
  mockGetMonthlyWarningPercent: vi.fn(),
  mockGetStallThresholdMs: vi.fn(),
  mockGetStallGraceMs: vi.fn(),
  mockCountByMonthRepo: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    deepResearch: {
      findStuckJobs: mockFindStuck,
      findStalledResearchingJobs: mockFindStalled,
      findOldestResearching: mockFindResearching,
      findOldestStructuring: mockFindStructuring,
      claimOldestQueued: mockClaimQueued,
      countInFlight: mockCountInFlight,
      updateJobStatus: mockUpdateJobStatus,
      appendJobError: mockAppendJobError,
      insertReport: mockInsertReport,
      countByMonth: mockCountByMonthRepo,
    },
    store: { get: mockGetStore },
    transaction: mockTransaction,
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));

vi.mock("@/lib/db/notification-helpers", () => ({
  createDeepResearchNotification: mockCreateNotification,
}));

vi.mock("@/lib/env", () => ({
  getInFlightCap: mockGetInFlightCap,
  getPollPerTick: mockGetPollPerTick,
  getMonthlyCap: mockGetMonthlyCap,
  getMonthlyWarningPercent: mockGetMonthlyWarningPercent,
  getStallThresholdMs: mockGetStallThresholdMs,
  getStallGraceMs: mockGetStallGraceMs,
  readEnv: vi.fn(),
}));

import { runPollResearchTick, __internal } from "../pipeline";
import type { TickResult } from "../pipeline";
import type { DeepResearchJob } from "@/types/deep-research";
import type {
  DeepResearchClient,
  DeepResearchTaskState,
} from "@/lib/ai/deep-research/client";
import type {
  Structurer,
  StructurerResult,
  StructuredReport,
} from "@/lib/ai/deep-research/structurer";

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------
const JOB_ID = "job_test_001";
const STORE_ID = "store_test_abc";
const USER_ID = "user-uuid-1";
const TASK_ID = "v1_task_handle_xyz";
const MARKDOWN = "# 店舗レポート\n\nサンプル内容";
const SOURCE_URLS = ["https://example.com/a", "https://example.com/b"];
const FAR_FUTURE_DEADLINE = Date.now() + 55_000;

function makeJob(overrides: Partial<DeepResearchJob> = {}): DeepResearchJob {
  return {
    id: JOB_ID,
    store_id: STORE_ID,
    user_id: USER_ID,
    status: "researching",
    deep_research_task_id: TASK_ID,
    attempts: 1,
    error_log: null,
    enqueued_at: "2026-05-30T10:00:00.000Z",
    research_started_at: "2026-05-30T10:01:00.000Z",
    research_completed_at: null,
    completed_at: null,
    api_updated_at: null,
    deleted_at: null,
    deleted_by: null,
    stage1_markdown: null,
    stage1_source_urls: null,
    ...overrides,
  };
}

function makeStructuringJob(
  overrides: Partial<DeepResearchJob> = {},
): DeepResearchJob {
  return makeJob({
    status: "structuring",
    stage1_markdown: MARKDOWN,
    stage1_source_urls: SOURCE_URLS,
    research_completed_at: "2026-05-30T11:00:00.000Z",
    ...overrides,
  });
}

function makeStore() {
  return {
    id: STORE_ID,
    name: "テスト食堂",
    prefecture: "東京都",
    city: "渋谷区",
    address: "道玄坂1-1-1",
    genre: "和食",
    site_url: "https://example.com",
  };
}

function makeDrClient(
  overrides: Partial<DeepResearchClient> = {},
): DeepResearchClient {
  return {
    startTask: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    ...overrides,
  };
}

function makeStructurer(
  result: StructurerResult<StructuredReport>,
): Structurer {
  return { structure: vi.fn().mockResolvedValue(result) };
}

const SUCCESS_REPORT: StructuredReport = {
  category_1_basic: [],
  category_2_owner: [],
  category_3_menu: [],
  category_4_customer: [],
  category_5_marketing: [],
  category_6_competitor: [],
  category_7_owned_media: [],
  category_8_other: [],
  hearing_questions: [],
  all_source_urls: SOURCE_URLS,
};

const SIGNAL = new AbortController().signal;

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockFindStuck.mockResolvedValue([]);
  mockFindStalled.mockResolvedValue([]);
  mockFindResearching.mockResolvedValue([]);
  mockFindStructuring.mockResolvedValue([]);
  mockClaimQueued.mockResolvedValue(null);
  mockCountInFlight.mockResolvedValue(0);
  mockUpdateJobStatus.mockImplementation((_, patch) =>
    Promise.resolve(makeJob({ ...patch })),
  );
  mockAppendJobError.mockResolvedValue(makeJob());
  mockInsertReport.mockResolvedValue({ id: "report_001" });
  mockCountByMonthRepo.mockResolvedValue(0);
  mockGetStore.mockResolvedValue(makeStore());
  mockTransaction.mockImplementation(
    async (fn: (r: unknown) => Promise<unknown>) =>
      fn({
        deepResearch: {
          insertReport: mockInsertReport,
          updateJobStatus: mockUpdateJobStatus,
        },
      }),
  );
  mockCreateNotification.mockResolvedValue(undefined);
  mockGetInFlightCap.mockReturnValue(10);
  mockGetPollPerTick.mockReturnValue(5);
  mockGetMonthlyCap.mockReturnValue(1000);
  mockGetMonthlyWarningPercent.mockReturnValue(80);
  mockGetStallThresholdMs.mockReturnValue(90 * 60_000); // 90 分
  mockGetStallGraceMs.mockReturnValue(60 * 60_000); // 60 分
});

// ---------------------------------------------------------------------------
// Case 1: researching completed → structuring
// ---------------------------------------------------------------------------
describe("Case 1: pollOneResearching — Gemini completed → structuring 遷移", () => {
  it("stage1_markdown/stage1_source_urls を保存し structuring に遷移する", async () => {
    const drClient = makeDrClient({
      getTask: vi.fn().mockResolvedValue({
        state: "completed",
        reportMarkdown: MARKDOWN,
        sourceUrls: SOURCE_URLS,
        apiUpdatedAt: "2026-05-30T11:00:00.000Z",
      } satisfies DeepResearchTaskState),
    });
    const structurer = makeStructurer({ ok: true, data: SUCCESS_REPORT });

    const outcome = await __internal.pollOneResearching({
      job: makeJob(),
      drClient,
      signal: SIGNAL,
    });

    expect(outcome).toBe("moved_to_structuring");
    // structurer は絶対に呼ばれない
    expect(structurer.structure).not.toHaveBeenCalled();
    // stage1_markdown と stage1_source_urls が保存される
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        status: "structuring",
        stage1_markdown: MARKDOWN,
        stage1_source_urls: SOURCE_URLS,
        research_completed_at: expect.any(String),
      }),
    );
    // error_log は増やさない
    expect(mockAppendJobError).not.toHaveBeenCalled();
  });

  it("runPollResearchTick では moved_to_structuring が増えるが completed は増えない", async () => {
    const researchingJob = makeJob({
      research_started_at: "2026-04-01T00:00:00.000Z", // shouldPollJob を通過させる
    });
    mockFindResearching.mockResolvedValue([researchingJob]);
    const drClient = makeDrClient({
      getTask: vi.fn().mockResolvedValue({
        state: "completed",
        reportMarkdown: MARKDOWN,
        sourceUrls: SOURCE_URLS,
      } satisfies DeepResearchTaskState),
    });

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeStructurer({ ok: true, data: SUCCESS_REPORT }),
    });

    expect(result.moved_to_structuring).toBe(1);
    expect(result.completed).toBe(0); // completed は増えない
    expect(result.structured).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Case 2: structuring → Stage 2 成功 → done
// ---------------------------------------------------------------------------
describe("Case 2: processOneStructuring — Stage 2 成功", () => {
  it("report が insert され job が done になり structured/completed が増える", async () => {
    const job = makeStructuringJob();
    const structurer = makeStructurer({ ok: true, data: SUCCESS_REPORT });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("completed");
    expect(structurer.structure).toHaveBeenCalledTimes(1);
    expect(mockInsertReport).toHaveBeenCalledTimes(1);
    // full_markdown は LLM 出力ではなく stage1_markdown (reportMarkdown) を注入する
    expect(mockInsertReport).toHaveBeenCalledWith(
      expect.objectContaining({ full_markdown: MARKDOWN }),
    );
    // 通常実行 (リトライ前) は concise を立てない
    expect(structurer.structure).toHaveBeenCalledWith(
      expect.objectContaining({ concise: false }),
      expect.anything(),
    );
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "done" }),
    );
    expect(mockRevalidateTag).toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "deep_research_done" }),
    );
  });

  it("runPollResearchTick では structured と completed が両方 += 1 になる", async () => {
    mockFindStructuring.mockResolvedValue([makeStructuringJob()]);
    const structurer = makeStructurer({ ok: true, data: SUCCESS_REPORT });

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient(),
      structurer,
    });

    expect(result.structured).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.moved_to_structuring).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Case 3: Stage 2 開始前 deadline 不足 → structuring のまま
// ---------------------------------------------------------------------------
describe("Case 3: Stage B で deadline 不足 → structuring 維持", () => {
  it("残り時間 < RESERVE_STRUCTURING_BUDGET_MS の場合 structurer を呼ばず deadline_reached=true", async () => {
    mockFindStructuring.mockResolvedValue([makeStructuringJob()]);
    const structurer = makeStructurer({ ok: true, data: SUCCESS_REPORT });
    const tightDeadline = Date.now() + 5_000; // 5秒 < 40秒

    const result: TickResult = await runPollResearchTick({
      deadline: tightDeadline,
      drClient: makeDrClient(),
      structurer,
    });

    expect(result.deadline_reached).toBe(true);
    expect(structurer.structure).not.toHaveBeenCalled();
    expect(result.structured).toBe(0);
    expect(result.completed).toBe(0);
    // job は structuring のまま → updateJobStatus で failed にしていない
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
    // error_log も増やさない (スケジューリング判断なのでログ不要)
    expect(mockAppendJobError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 4: Stage 2 実行中 timeout (上限未達) → still_structuring
// ---------------------------------------------------------------------------
describe("Case 4: Stage 2 実行中 timeout (1〜2回目) → structuring 継続", () => {
  it("timeout 1回目: still_structuring を返し error_log に stage2_timeout を追加", async () => {
    const job = makeStructuringJob({ error_log: null }); // timeout 0回
    const structurer = makeStructurer({ ok: false, error: { kind: "timeout" } });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("still_structuring");
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        stage: "stage2",
        kind: "stage2_timeout",
      }),
    );
    // failed にしていない
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("timeout 2回目: still_structuring を返す (上限 3回)", async () => {
    const job = makeStructuringJob({
      error_log: [
        { stage: "stage2", kind: "stage2_timeout", message: "1", occurred_at: "2026-05-30T12:00:00.000Z" },
      ],
    });
    const structurer = makeStructurer({ ok: false, error: { kind: "timeout" } });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("still_structuring");
    // まだ failed にならない
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("completed / structured は増えない", async () => {
    mockFindStructuring.mockResolvedValue([makeStructuringJob()]);
    const structurer = makeStructurer({ ok: false, error: { kind: "timeout" } });

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient(),
      structurer,
    });

    expect(result.completed).toBe(0);
    expect(result.structured).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Case 5: Stage 2 timeout 上限超過 → failed
// ---------------------------------------------------------------------------
describe("Case 5: Stage 2 timeout 上限超過 (3回) → failed", () => {
  it("stage2_timeout が 3件ある場合 structurer を呼ばず stage2_timeout_exceeded で failed", async () => {
    const job = makeStructuringJob({
      error_log: [
        { stage: "stage2", kind: "stage2_timeout", message: "1", occurred_at: "2026-05-30T11:00:00.000Z" },
        { stage: "stage2", kind: "stage2_timeout", message: "2", occurred_at: "2026-05-30T11:05:00.000Z" },
        { stage: "stage2", kind: "stage2_timeout", message: "3", occurred_at: "2026-05-30T11:10:00.000Z" },
      ],
    });
    const structurer = makeStructurer({ ok: false, error: { kind: "timeout" } });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("failed");
    expect(structurer.structure).not.toHaveBeenCalled();
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ kind: "stage2_timeout_exceeded" }),
    );
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
    );
    // completed は増えない
  });

  it("stage2_timeout_exceeded で failed になった場合 completed は増えない", async () => {
    const job = makeStructuringJob({
      error_log: [
        { stage: "stage2", kind: "stage2_timeout", message: "1", occurred_at: "2026-05-30T11:00:00.000Z" },
        { stage: "stage2", kind: "stage2_timeout", message: "2", occurred_at: "2026-05-30T11:05:00.000Z" },
        { stage: "stage2", kind: "stage2_timeout", message: "3", occurred_at: "2026-05-30T11:10:00.000Z" },
      ],
    });
    mockFindStructuring.mockResolvedValue([job]);

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient(),
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.completed).toBe(0);
    expect(result.structured).toBe(0);
  });

  it("countStage2Timeouts は stage2_timeout のみを数え他 kind は除外する", () => {
    const job = makeStructuringJob({
      error_log: [
        { stage: "stage2", kind: "stage2_timeout", message: "", occurred_at: "" },
        { stage: "stage2", kind: "stage2_schema_violation", message: "", occurred_at: "" },
        { stage: "stage1", kind: "stage2_timeout", message: "", occurred_at: "" }, // stage1 なので除外
        { stage: "stage2", kind: "stage2_timeout", message: "", occurred_at: "" },
      ],
    });
    const count = __internal.countStage2Timeouts(job);
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Case 5b: Stage 2 構造化リトライ (invalid_json / schema_violation)
// ---------------------------------------------------------------------------
describe("Case 5b: Stage 2 invalid_json/schema_violation → 縮約リトライ", () => {
  it("invalid_json 1回目: still_structuring を返し error_log に stage2_invalid_json を追加", async () => {
    const job = makeStructuringJob();
    const structurer = makeStructurer({
      ok: false,
      error: {
        kind: "invalid_json",
        message: "JSON 解釈不能",
        finishReason: "MAX_TOKENS",
        responseLength: 32875,
      },
    });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("still_structuring");
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ kind: "stage2_invalid_json" }),
    );
    // failed にはしない
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
    );
    expect(mockInsertReport).not.toHaveBeenCalled();
  });

  it("既に retryable 失敗が1件あると concise=true で再構造化する", async () => {
    const job = makeStructuringJob({
      error_log: [
        {
          stage: "stage2",
          kind: "stage2_invalid_json",
          message: "前回",
          occurred_at: "2026-05-30T11:00:00.000Z",
        },
      ],
    });
    const structurer = makeStructurer({ ok: true, data: SUCCESS_REPORT });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("completed");
    expect(structurer.structure).toHaveBeenCalledWith(
      expect.objectContaining({ concise: true }),
      expect.anything(),
    );
  });

  it("retryable 失敗が上限 (2件) に達したら structurer を呼ばず stage2_structure_retry_exceeded で failed", async () => {
    const job = makeStructuringJob({
      error_log: [
        {
          stage: "stage2",
          kind: "stage2_invalid_json",
          message: "1",
          occurred_at: "2026-05-30T11:00:00.000Z",
        },
        {
          stage: "stage2",
          kind: "stage2_schema_violation",
          message: "2",
          occurred_at: "2026-05-30T11:05:00.000Z",
        },
      ],
    });
    const structurer = makeStructurer({ ok: true, data: SUCCESS_REPORT });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("failed");
    expect(structurer.structure).not.toHaveBeenCalled();
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ kind: "stage2_structure_retry_exceeded" }),
    );
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Case 6: Stage 2 本当の失敗 (回復不能 kind) → failed
// ---------------------------------------------------------------------------
describe("Case 6: Stage 2 本当の失敗 → failed", () => {
  it("schema_violation 1回目は still_structuring (retryable)、failed にはしない", async () => {
    const job = makeStructuringJob();
    const structurer = makeStructurer({
      ok: false,
      error: { kind: "schema_violation", zodIssues: ["root: missing field"] },
    });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("still_structuring");
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ kind: "stage2_schema_violation" }),
    );
    expect(mockInsertReport).not.toHaveBeenCalled();
  });

  it("api_error は failed になる", async () => {
    const job = makeStructuringJob();
    const structurer = makeStructurer({
      ok: false,
      error: { kind: "api_error", status: 500 },
    });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("failed");
  });

  it("stage1_markdown が null の旧 structuring ジョブは stage2_markdown_missing で failed", async () => {
    const job = makeStructuringJob({ stage1_markdown: null });
    const structurer = makeStructurer({ ok: true, data: SUCCESS_REPORT });

    const outcome = await __internal.processOneStructuring({
      job,
      drClient: makeDrClient(),
      structurer,
      deadline: FAR_FUTURE_DEADLINE,
      signal: SIGNAL,
    });

    expect(outcome).toBe("failed");
    expect(structurer.structure).not.toHaveBeenCalled();
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ kind: "stage2_markdown_missing" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Case 7: queued → researching (startOneQueued 既存動作)
// ---------------------------------------------------------------------------
describe("Case 7: startOneQueued — queued → researching", () => {
  it("claimOldestQueued → startTask → status:researching + task_id 保存", async () => {
    const queuedJob = makeJob({
      status: "queued",
      deep_research_task_id: null,
      research_started_at: null,
      attempts: 0,
    });
    mockClaimQueued.mockResolvedValue(queuedJob);
    mockCountInFlight.mockResolvedValue(0);

    const drClient = makeDrClient({
      startTask: vi.fn().mockResolvedValue({ taskId: "new_task_id" }),
    });

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.started).toBe(1);
    expect(drClient.startTask).toHaveBeenCalledTimes(1);
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        status: "researching",
        deep_research_task_id: "new_task_id",
      }),
    );
    // completed は増えない
    expect(result.completed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Case S1〜S8: Stage A2 進捗停滞 (stall) 検知 sweep
// ---------------------------------------------------------------------------
describe("Stage A2: 進捗停滞 (stall) 検知 sweep", () => {
  function makeStalledJob(
    overrides: Partial<DeepResearchJob> = {},
  ): DeepResearchJob {
    return makeJob({
      status: "researching",
      deep_research_task_id: TASK_ID,
      research_started_at: "2026-05-30T08:00:00.000Z",
      api_updated_at: "2026-05-30T08:00:00.000Z", // 進捗が凍結 (古い)
      ...overrides,
    });
  }

  it("S1: cancelTask + stage1_stalled_no_progress で failed 化し失敗通知する", async () => {
    const cancelTask = vi.fn().mockResolvedValue({ cancelled: true });
    await __internal.sweepStuckJob({
      job: makeStalledJob(),
      drClient: makeDrClient({ cancelTask }),
      signal: SIGNAL,
      reason: {
        kind: "stage1_stalled_no_progress",
        message: "Stage 1 の進捗が停滞",
      },
    });

    expect(cancelTask).toHaveBeenCalledWith({ taskId: TASK_ID }, SIGNAL);
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        stage: "sweep",
        kind: "stage1_stalled_no_progress",
      }),
    );
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        status: "failed",
        completed_at: expect.any(String),
      }),
    );
    expect(mockRevalidateTag).toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "deep_research_failed" }),
    );
  });

  it("S2: cancelTask が throw でも failed 化し cancel_result.cancelled=false を記録 (best-effort)", async () => {
    const cancelTask = vi.fn().mockRejectedValue(new Error("boom"));
    await __internal.sweepStuckJob({
      job: makeStalledJob(),
      drClient: makeDrClient({ cancelTask }),
      signal: SIGNAL,
      reason: { kind: "stage1_stalled_no_progress", message: "x" },
    });

    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        kind: "stage1_stalled_no_progress",
        cancel_result: { cancelled: false, reason: "api_error" },
      }),
    );
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("S3: runPollResearchTick で stalled_swept=1 / swept=0 と別計上される", async () => {
    mockFindStalled.mockResolvedValue([makeStalledJob()]);
    const drClient = makeDrClient({
      cancelTask: vi.fn().mockResolvedValue({ cancelled: true }),
    });

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.stalled_swept).toBe(1);
    expect(result.swept).toBe(0); // 6h sweep とは別計上
  });

  it("S3a (cap 解放リンケージ): stall を failed 化した分 inFlight が空くと同一 tick の Stage D が起動する", async () => {
    mockFindStalled.mockResolvedValue([makeStalledJob()]);
    // sweep 後の inFlight 状態を表現: cap(10) 未満の 9 → Stage D が claim できる
    mockCountInFlight.mockResolvedValue(9);
    mockClaimQueued.mockResolvedValue(
      makeJob({
        status: "queued",
        deep_research_task_id: null,
        research_started_at: null,
        attempts: 0,
      }),
    );
    const drClient = makeDrClient({
      cancelTask: vi.fn().mockResolvedValue({ cancelled: true }),
      startTask: vi.fn().mockResolvedValue({ taskId: "new_task" }),
    });

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.stalled_swept).toBe(1);
    expect(mockClaimQueued).toHaveBeenCalled();
  });

  it("S3b (負の対照): stall が無く inFlight が cap 一杯なら Stage D は queued を起動しない", async () => {
    mockFindStalled.mockResolvedValue([]);
    mockCountInFlight.mockResolvedValue(10); // cap(10) 一杯
    mockClaimQueued.mockResolvedValue(makeJob({ status: "queued" }));

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient(),
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.stalled_swept).toBe(0);
    // cap ゲートが効いているので claim されない (S3a の linkage が空虚でないことの裏付け)
    expect(mockClaimQueued).not.toHaveBeenCalled();
  });

  it("S5 (no-op): 停滞ジョブが 0 件なら sweep せず stalled_swept=0、failed 遷移も起きない", async () => {
    mockFindStalled.mockResolvedValue([]);
    const cancelTask = vi.fn();

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient({ cancelTask }),
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.stalled_swept).toBe(0);
    expect(cancelTask).not.toHaveBeenCalled();
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("S4: findStalledResearchingJobs が (staleBefore, startedBefore, pollPerTick) で呼ばれる", async () => {
    await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient(),
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(mockFindStalled).toHaveBeenCalledTimes(1);
    const call = mockFindStalled.mock.calls[0];
    if (!call) throw new Error("findStalledResearchingJobs が呼ばれていません");
    const [staleBefore, startedBefore, limit] = call;
    expect(staleBefore).toBeInstanceOf(Date);
    expect(startedBefore).toBeInstanceOf(Date);
    // grace(60分) は threshold(90分) より新しい境界 → startedBefore > staleBefore
    expect(startedBefore.getTime()).toBeGreaterThan(staleBefore.getTime());
    expect(limit).toBe(5); // getPollPerTick
  });

  it("S6: deadline 不足なら stall sweep を実行せず stalled_swept=0 / deadline_reached=true", async () => {
    mockFindStalled.mockResolvedValue([makeStalledJob()]);
    const tightDeadline = Date.now() + 1_000; // < RESERVE_SWEEP_ONE_MS(3000)

    const result: TickResult = await runPollResearchTick({
      deadline: tightDeadline,
      drClient: makeDrClient({ cancelTask: vi.fn() }),
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.stalled_swept).toBe(0);
    expect(result.deadline_reached).toBe(true);
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("S7: 6h sweep と stall sweep が両方発火し別 kind で計上される", async () => {
    mockFindStuck.mockResolvedValue([
      makeJob({
        id: "job_6h",
        status: "researching",
        research_started_at: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    mockFindStalled.mockResolvedValue([makeStalledJob({ id: "job_stall" })]);

    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient({
        cancelTask: vi.fn().mockResolvedValue({ cancelled: true }),
      }),
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result.swept).toBe(1);
    expect(result.stalled_swept).toBe(1);
    expect(mockAppendJobError).toHaveBeenCalledWith(
      "job_6h",
      expect.objectContaining({ kind: "stage1_stuck" }),
    );
    expect(mockAppendJobError).toHaveBeenCalledWith(
      "job_stall",
      expect.objectContaining({ kind: "stage1_stalled_no_progress" }),
    );
  });

  it("S8 (回帰): reason 未指定 sweepStuckJob は researching→stage1_stuck / structuring→stage2_stuck", async () => {
    const drClient = makeDrClient({
      cancelTask: vi.fn().mockResolvedValue({ cancelled: true }),
    });

    await __internal.sweepStuckJob({
      job: makeJob({ status: "researching" }),
      drClient,
      signal: SIGNAL,
    });
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ kind: "stage1_stuck" }),
    );

    mockAppendJobError.mockClear();

    await __internal.sweepStuckJob({
      job: makeStructuringJob(),
      drClient,
      signal: SIGNAL,
    });
    expect(mockAppendJobError).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ kind: "stage2_stuck" }),
    );
  });
});

// ---------------------------------------------------------------------------
// TickResult の形状確認
// ---------------------------------------------------------------------------
describe("TickResult の形状", () => {
  it("全フィールドが存在する", async () => {
    const result: TickResult = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient: makeDrClient(),
      structurer: makeStructurer({ ok: false, error: { kind: "timeout" } }),
    });

    expect(result).toMatchObject({
      swept: expect.any(Number),
      stalled_swept: expect.any(Number),
      polled: expect.any(Number),
      moved_to_structuring: expect.any(Number),
      structured: expect.any(Number),
      completed: expect.any(Number),
      started: expect.any(Number),
      deadline_reached: expect.any(Boolean),
    });
  });
});
