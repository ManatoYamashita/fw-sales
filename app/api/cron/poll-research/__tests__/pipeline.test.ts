/**
 * パイプライン統合テスト (deep-research-pipeline spec #43, Task 6.2)
 *
 * モック SDK で 5 シナリオを検証:
 *   A. queued → researching: claimOldestQueued + Stage 1 起動 + DB 更新
 *   B. researching → in_progress: getTask で in_progress、副作用なし
 *   C. researching → completed → Stage 2 → done + 通知作成
 *   D. researching → failed (Stage 1 エラー): failed + 失敗通知
 *   E. Stuck sweep: 6h+ researching → cancelTask + failed + 失敗通知
 *
 * 関連: requirements.md §2.1, §2.5, §3.1, §4.1, §4.2, §5.4, §6.6
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "@/types/store";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    getInFlightCap: () => 10,
    getPollPerTick: () => 5,
    getMonthlyCap: () => 1000,
    getMonthlyWarningPercent: () => 80,
  };
});

import { runPollResearchTick } from "../pipeline";
import { mockDb } from "@/lib/mock/db";
import type {
  DeepResearchClient,
  DeepResearchTaskState,
} from "@/lib/ai/deep-research/client";
import type { Structurer } from "@/lib/ai/deep-research/structurer";
import type { DeepResearchJob } from "@/types/deep-research";

const USER_A = "00000000-0000-0000-0000-0000000000aa";
const STORE_1 = "store_test_001";

function makeMockStore(): Store {
  return {
    id: STORE_1,
    name: "テスト食堂",
    prefecture: "東京都",
    city: "新宿区",
    address: "西新宿 1-1-1",
    genre: "和食",
    priority: "中",
    stage: "調査待ち",
    channel: "テレアポ推奨",
    has_contact_form: "未確認",
    map_url: "",
    site_url: "https://example.com",
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
    business_hours: "",
    google_place_id: null,
    created_at: "2026-05-17",
    updated_at: "2026-05-17",
  };
}

function seedJob(overrides: Partial<DeepResearchJob>): DeepResearchJob {
  const base: DeepResearchJob = {
    id: `job_${Math.random().toString(36).slice(2, 8)}`,
    store_id: STORE_1,
    user_id: USER_A,
    status: "queued",
    deep_research_task_id: null,
    attempts: 0,
    error_log: null,
    enqueued_at: new Date().toISOString(),
    research_started_at: null,
    research_completed_at: null,
    completed_at: null,
    ...overrides,
  };
  mockDb.deepResearchJobs.set(base.id, base);
  return base;
}

function makeMockDrClient(
  overrides: Partial<DeepResearchClient> = {},
): DeepResearchClient {
  return {
    async startTask() {
      return { taskId: "interactions/start_default" };
    },
    async getTask(): Promise<DeepResearchTaskState> {
      return { state: "in_progress" };
    },
    async cancelTask() {
      return { cancelled: true };
    },
    ...overrides,
  };
}

function makeMockStructurer(
  override?: Partial<Structurer>,
): Structurer {
  return {
    async structure() {
      return {
        ok: true,
        data: {
          category_1_basic: [
            {
              key: "store_name",
              label: "屋号",
              tier: "A",
              value: "テスト食堂",
            },
          ],
          category_2_owner: [],
          category_3_menu: [],
          category_4_customer: [],
          category_5_marketing: [],
          category_6_competitor: [],
          category_7_owned_media: [],
          category_8_other: [],
          hearing_questions: [],
          full_markdown: "## 屋号\nテスト食堂",
          all_source_urls: ["https://example.com"],
        },
      };
    },
    ...override,
  };
}

beforeEach(() => {
  process.env.USE_MOCK_DB = "true";
  mockDb.deepResearchJobs.clear();
  mockDb.deepResearchReports.clear();
  mockDb.notifications.clear();
  mockDb.stores.set(STORE_1, makeMockStore() as never);
});

const FAR_FUTURE_DEADLINE = Date.now() + 100_000;

describe("runPollResearchTick — シナリオ A: queued → researching", () => {
  it("claimOldestQueued + Stage 1 起動 + DB 更新", async () => {
    const job = seedJob({ status: "queued" });
    const drClient = makeMockDrClient({
      async startTask() {
        return { taskId: "interactions/abc123" };
      },
    });

    const result = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeMockStructurer(),
    });

    expect(result.started).toBe(1);
    const updated = mockDb.deepResearchJobs.get(job.id);
    expect(updated?.status).toBe("researching");
    expect(updated?.deep_research_task_id).toBe("interactions/abc123");
    expect(updated?.attempts).toBe(1);
    expect(updated?.research_started_at).toBeTruthy();
  });
});

describe("runPollResearchTick — シナリオ B: researching が in_progress", () => {
  it("polled++ するが状態は変えない、副作用なし", async () => {
    const job = seedJob({
      status: "researching",
      deep_research_task_id: "interactions/aaa",
      research_started_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const drClient = makeMockDrClient({
      async getTask() {
        return { state: "in_progress" };
      },
    });

    const result = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeMockStructurer(),
    });

    expect(result.polled).toBe(1);
    expect(result.completed).toBe(0);
    const after = mockDb.deepResearchJobs.get(job.id);
    expect(after?.status).toBe("researching");
    expect(mockDb.notifications.size).toBe(0);
    expect(mockDb.deepResearchReports.size).toBe(0);
  });
});

describe("runPollResearchTick — シナリオ C: completed → Stage 2 → done", () => {
  it("Stage 1 完了 → 構造化 → done 化 + レポート保存 + 完了通知", async () => {
    const job = seedJob({
      status: "researching",
      deep_research_task_id: "interactions/bbb",
      research_started_at: new Date(Date.now() - 90_000).toISOString(),
    });
    const drClient = makeMockDrClient({
      async getTask() {
        return {
          state: "completed",
          reportMarkdown: "## レポート\n本文",
          sourceUrls: ["https://example.com/article"],
        };
      },
    });

    const result = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeMockStructurer(),
    });

    expect(result.completed).toBe(1);
    const after = mockDb.deepResearchJobs.get(job.id);
    expect(after?.status).toBe("done");
    expect(after?.completed_at).toBeTruthy();

    // レポート行が 1 件存在
    const reports = [...mockDb.deepResearchReports.values()].filter(
      (r) => r.job_id === job.id,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.category_1_basic[0]?.key).toBe("store_name");

    // 完了通知が 1 件作成 (kind=deep_research_done)
    const notifs = [...mockDb.notifications.values()].filter(
      (n) => n.kind === "deep_research_done",
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.user_id).toBe(USER_A);
  });
});

describe("runPollResearchTick — シナリオ D: Stage 1 failed", () => {
  it("getTask が failed → ジョブ failed + 失敗通知", async () => {
    const job = seedJob({
      status: "researching",
      deep_research_task_id: "interactions/ccc",
      research_started_at: new Date(Date.now() - 30_000).toISOString(),
    });
    const drClient = makeMockDrClient({
      async getTask() {
        return { state: "failed", reason: "Stage 1 API がエラーを返しました" };
      },
    });

    const result = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeMockStructurer(),
    });

    expect(result.polled).toBe(1);
    const after = mockDb.deepResearchJobs.get(job.id);
    expect(after?.status).toBe("failed");
    expect(after?.error_log).toBeTruthy();
    expect(after?.error_log?.[0]?.stage).toBe("stage1");

    const failedNotifs = [...mockDb.notifications.values()].filter(
      (n) => n.kind === "deep_research_failed",
    );
    expect(failedNotifs).toHaveLength(1);
  });
});

describe("runPollResearchTick — シナリオ E: Stuck sweep", () => {
  it("6h+ researching を cancelTask + failed + 失敗通知", async () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const job = seedJob({
      status: "researching",
      deep_research_task_id: "interactions/stuck1",
      research_started_at: sevenHoursAgo,
    });

    const cancelSpy = vi.fn(async () => ({ cancelled: true as const }));
    const drClient = makeMockDrClient({
      cancelTask: cancelSpy,
    });

    const result = await runPollResearchTick({
      deadline: FAR_FUTURE_DEADLINE,
      drClient,
      structurer: makeMockStructurer(),
    });

    expect(result.swept).toBe(1);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith(
      { taskId: "interactions/stuck1" },
      expect.anything(),
    );

    const after = mockDb.deepResearchJobs.get(job.id);
    expect(after?.status).toBe("failed");
    expect(after?.error_log?.[0]?.stage).toBe("sweep");
    expect(after?.error_log?.[0]?.kind).toBe("stage1_stuck");
    expect(after?.error_log?.[0]?.cancel_result?.cancelled).toBe(true);

    const failedNotifs = [...mockDb.notifications.values()].filter(
      (n) => n.kind === "deep_research_failed",
    );
    expect(failedNotifs).toHaveLength(1);
  });
});
