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
 *
 * 関連: deep-research-pipeline spec (Issue #43 follow-up, Stage 2 timeout fix)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — モック変数を最上位に巻き上げ
// ---------------------------------------------------------------------------
const {
  mockFindStuck,
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
  mockCountByMonthRepo,
} = vi.hoisted(() => ({
  mockFindStuck: vi.fn(),
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
  mockCountByMonthRepo: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    deepResearch: {
      findStuckJobs: mockFindStuck,
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
  full_markdown: MARKDOWN,
  all_source_urls: SOURCE_URLS,
};

const SIGNAL = new AbortController().signal;

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockFindStuck.mockResolvedValue([]);
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
// Case 6: Stage 2 本当の失敗 (schema_violation) → failed
// ---------------------------------------------------------------------------
describe("Case 6: Stage 2 本当の失敗 → failed", () => {
  it("schema_violation エラーは failed になり completed は増えない", async () => {
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

    expect(outcome).toBe("failed");
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
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
      polled: expect.any(Number),
      moved_to_structuring: expect.any(Number),
      structured: expect.any(Number),
      completed: expect.any(Number),
      started: expect.any(Number),
      deadline_reached: expect.any(Boolean),
    });
  });
});
