/**
 * deep-research-actions の `pollGeminiJobAction` 単体テスト。
 *
 * 既存 prompt-template-actions.test.ts と同型の vi.hoisted + vi.mock パターンで
 * @/lib/repositories, @/lib/supabase/server, @/lib/ai/deep-research/client,
 * next/cache を全部モックして副作用を排除する。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRepo,
  mockStoreRepo,
  mockGetCurrentSession,
  mockRevalidateTag,
  mockGetTask,
  mockCreateClient,
  mockGetDailyUserCap,
  mockGetMonthlyCap,
  mockRunPollTick,
} = vi.hoisted(() => ({
  mockRepo: {
    getById: vi.fn(),
    updateJobStatus: vi.fn(),
    appendJobError: vi.fn(),
    findActiveByStore: vi.fn(),
    countByUserSinceDay: vi.fn(),
    countByMonth: vi.fn(),
    insertJob: vi.fn(),
  },
  mockStoreRepo: { get: vi.fn() },
  mockGetCurrentSession: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockGetTask: vi.fn(),
  mockCreateClient: vi.fn(),
  mockGetDailyUserCap: vi.fn(),
  mockGetMonthlyCap: vi.fn(),
  mockRunPollTick: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: { deepResearch: mockRepo, store: mockStoreRepo },
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentSession: mockGetCurrentSession,
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/lib/ai/deep-research/client", () => ({
  createDeepResearchClient: mockCreateClient,
}));

vi.mock("@/app/api/cron/poll-research/pipeline", () => ({
  runPollResearchTick: mockRunPollTick,
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    getDailyUserCap: mockGetDailyUserCap,
    getMonthlyCap: mockGetMonthlyCap,
  };
});

import {
  advanceStructuringAction,
  enqueueDeepResearchAction,
  pollGeminiJobAction,
} from "../deep-research-actions";
import type { DeepResearchJob } from "@/types/deep-research";

const JOB_ID = "job_test_xyz";
const STORE_ID = "store_test_abc";
const USER_ID = "user-uuid-1";
const TASK_ID = "v1_task_handle_xyz";
const SESSION = { userId: USER_ID, email: "u@test.com" };

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
    api_updated_at: "2026-05-30T10:01:00.000Z",
    deleted_at: null,
    deleted_by: null,
    stage1_markdown: null,
    stage1_source_urls: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCreateClient.mockReturnValue({
    getTask: mockGetTask,
    startTask: vi.fn(),
    cancelTask: vi.fn(),
  });
  mockGetDailyUserCap.mockReturnValue(30);
  mockGetMonthlyCap.mockReturnValue(1000);
  mockRunPollTick.mockResolvedValue(undefined);
});

describe("enqueueDeepResearchAction", () => {
  /** 店舗名以外も埋まった「正常系」をセットアップ。overrides で欠落を再現する。 */
  function setupHappyPath(storeOverrides: Record<string, unknown> = {}) {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockStoreRepo.get.mockResolvedValue({
      id: STORE_ID,
      name: "テスト食堂",
      prefecture: "東京都",
      city: "新宿区",
      address: "西新宿 1-1-1",
      ...storeOverrides,
    });
    mockRepo.findActiveByStore.mockResolvedValue(null);
    mockRepo.countByUserSinceDay.mockResolvedValue(0);
    mockRepo.countByMonth.mockResolvedValue(0);
    mockRepo.insertJob.mockResolvedValue(
      makeJob({ status: "queued", deep_research_task_id: null }),
    );
  }

  it("店舗名のみ有り・所在地が全て空でも success (= 必須は店舗名のみ)", async () => {
    setupHappyPath({ address: "", prefecture: "", city: "" });

    const result = await enqueueDeepResearchAction(STORE_ID);

    expect(result.ok).toBe(true);
    expect(mockRepo.insertJob).toHaveBeenCalledWith({
      store_id: STORE_ID,
      user_id: USER_ID,
    });
  });

  it("所在地の一部 (prefecture/city) のみ空でも所在地を必須扱いしない", async () => {
    setupHappyPath({ prefecture: "", city: "", address: "西新宿 1-1-1" });

    const result = await enqueueDeepResearchAction(STORE_ID);

    // 所在地を必須にしていた頃は failure になっていたケース。緩和後は success。
    expect(result.ok).toBe(true);
    expect(mockRepo.insertJob).toHaveBeenCalledTimes(1);
  });

  it("店舗名が空白なら failure「必須項目が未入力です: 店舗名」で insertJob を呼ばない", async () => {
    setupHappyPath({ name: "   " });

    const result = await enqueueDeepResearchAction(STORE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("必須項目が未入力です: 店舗名");
    expect(mockRepo.insertJob).not.toHaveBeenCalled();
  });

  it("storeId が空文字なら認証より前に failure", async () => {
    const result = await enqueueDeepResearchAction("");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/店舗 ID/);
    expect(mockGetCurrentSession).not.toHaveBeenCalled();
  });

  it("storeId が空白文字のみでも trim 後に failure (認証より前)", async () => {
    const result = await enqueueDeepResearchAction("   ");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/店舗 ID/);
    expect(mockGetCurrentSession).not.toHaveBeenCalled();
  });

  it("未ログインなら failure を返し store.get を呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(null);

    const result = await enqueueDeepResearchAction(STORE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ログイン/);
    expect(mockStoreRepo.get).not.toHaveBeenCalled();
    expect(mockRepo.insertJob).not.toHaveBeenCalled();
  });

  it("対象店舗が存在しなければ failure で insertJob を呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockStoreRepo.get.mockResolvedValue(null);

    const result = await enqueueDeepResearchAction(STORE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockRepo.insertJob).not.toHaveBeenCalled();
  });

  it("進行中ジョブがあれば重複として failure", async () => {
    setupHappyPath();
    mockRepo.findActiveByStore.mockResolvedValue(
      makeJob({ status: "researching" }),
    );

    const result = await enqueueDeepResearchAction(STORE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/進行中/);
    expect(mockRepo.insertJob).not.toHaveBeenCalled();
  });

  it("日次上限到達なら failure で insertJob を呼ばない", async () => {
    setupHappyPath();
    mockGetDailyUserCap.mockReturnValue(5);
    mockRepo.countByUserSinceDay.mockResolvedValue(5);

    const result = await enqueueDeepResearchAction(STORE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/本日の登録上限/);
    expect(mockRepo.insertJob).not.toHaveBeenCalled();
  });

  it("成功時は store/job/queue の 3 タグを revalidate する", async () => {
    setupHappyPath({ address: "", prefecture: "", city: "" });

    const result = await enqueueDeepResearchAction(STORE_ID);

    expect(result.ok).toBe(true);
    expect(mockRevalidateTag).toHaveBeenCalledTimes(3);
  });
});

describe("pollGeminiJobAction", () => {
  it("未ログインなら failure を返し getTask を呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    const result = await pollGeminiJobAction(JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ログイン/);
    expect(mockGetTask).not.toHaveBeenCalled();
    expect(mockRepo.updateJobStatus).not.toHaveBeenCalled();
    expect(mockRepo.appendJobError).not.toHaveBeenCalled();
  });

  it("status=done のジョブは早期 return し Gemini を叩かない", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById.mockResolvedValue(makeJob({ status: "done" }));
    const result = await pollGeminiJobAction(JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/完了\/失敗/);
    expect(mockGetTask).not.toHaveBeenCalled();
    expect(mockRepo.updateJobStatus).not.toHaveBeenCalled();
    expect(mockRepo.appendJobError).not.toHaveBeenCalled();
  });

  it("status=queued (task_id null) は早期 return", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById.mockResolvedValue(
      makeJob({ status: "queued", deep_research_task_id: null }),
    );
    const result = await pollGeminiJobAction(JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/まだ Gemini に投入/);
    expect(mockGetTask).not.toHaveBeenCalled();
  });

  it("researching + in_progress 応答: api_updated_at を更新し revalidateTag + success", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById.mockResolvedValue(makeJob());
    mockGetTask.mockResolvedValue({
      state: "in_progress",
      apiUpdatedAt: "2026-05-30T11:00:00.000Z",
    });
    mockRepo.updateJobStatus.mockResolvedValue(makeJob());

    const result = await pollGeminiJobAction(JOB_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.state).toBe("in_progress");
      expect(result.data.apiUpdatedAt).toBe("2026-05-30T11:00:00.000Z");
      expect(typeof result.data.polledAt).toBe("string");
    }
    expect(mockGetTask).toHaveBeenCalledTimes(1);
    expect(mockRepo.updateJobStatus).toHaveBeenCalledWith(JOB_ID, {
      status: "researching",
      api_updated_at: "2026-05-30T11:00:00.000Z",
    });
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      `deep-research:job:${JOB_ID}`,
      "max",
    );
    expect(mockRepo.appendJobError).not.toHaveBeenCalled();
  });

  it("Gemini API エラー時: appendJobError に manual_poll_<kind> を記録し failure を返す", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById.mockResolvedValue(makeJob());
    mockGetTask.mockRejectedValue({
      kind: "rate_limit",
      message: "429 quota exceeded",
    });

    const result = await pollGeminiJobAction(JOB_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rate_limit/);
    expect(mockRepo.appendJobError).toHaveBeenCalledTimes(1);
    const call = mockRepo.appendJobError.mock.calls[0];
    expect(call?.[0]).toBe(JOB_ID);
    const entry = call?.[1] as {
      stage: string;
      kind: string;
      message: string;
    };
    expect(entry.stage).toBe("stage1");
    expect(entry.kind).toBe("manual_poll_rate_limit");
    expect(entry.message).toBe("429 quota exceeded");
    // status は据置 (cron pipeline に任せる)
    expect(mockRepo.updateJobStatus).not.toHaveBeenCalled();
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      `deep-research:job:${JOB_ID}`,
      "max",
    );
  });
});

describe("advanceStructuringAction", () => {
  it("未ログインなら failure を返し tick を発火しない", async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    const result = await advanceStructuringAction(JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ログイン/);
    expect(mockRunPollTick).not.toHaveBeenCalled();
  });

  it("jobId が空なら認証より前に failure", async () => {
    const result = await advanceStructuringAction("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ジョブ ID/);
    expect(mockGetCurrentSession).not.toHaveBeenCalled();
    expect(mockRunPollTick).not.toHaveBeenCalled();
  });

  it("ジョブが存在しなければ failure で tick を発火しない", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById.mockResolvedValue(null);
    const result = await advanceStructuringAction(JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockRunPollTick).not.toHaveBeenCalled();
  });

  it("structuring 以外 (researching) なら tick を発火せず現在 status を返す", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById.mockResolvedValue(makeJob({ status: "researching" }));

    const result = await advanceStructuringAction(JOB_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("researching");
      expect(result.data.settled).toBe(false);
    }
    expect(mockRunPollTick).not.toHaveBeenCalled();
  });

  it("structuring なら tick を 1 回発火し、読み直した done を settled=true で返す", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById
      .mockResolvedValueOnce(makeJob({ status: "structuring" }))
      .mockResolvedValueOnce(makeJob({ status: "done" }));

    const result = await advanceStructuringAction(JOB_ID);

    expect(mockRunPollTick).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("done");
      expect(result.data.settled).toBe(true);
    }
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      `deep-research:job:${JOB_ID}`,
      "max",
    );
  });

  it("tick 後もまだ structuring なら settled=false を返す", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById
      .mockResolvedValueOnce(makeJob({ status: "structuring" }))
      .mockResolvedValueOnce(makeJob({ status: "structuring" }));

    const result = await advanceStructuringAction(JOB_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("structuring");
      expect(result.data.settled).toBe(false);
    }
  });

  it("tick が throw しても握りつぶし、読み直した status を返す (並行競合の無害化)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetCurrentSession.mockResolvedValue(SESSION);
    mockRepo.getById
      .mockResolvedValueOnce(makeJob({ status: "structuring" }))
      .mockResolvedValueOnce(makeJob({ status: "done" }));
    mockRunPollTick.mockRejectedValueOnce(
      Object.assign(
        new Error("duplicate key value violates unique constraint"),
        { code: "23505" },
      ),
    );

    const result = await advanceStructuringAction(JOB_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("done");
      expect(result.data.settled).toBe(true);
    }
    expect(mockRunPollTick).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
