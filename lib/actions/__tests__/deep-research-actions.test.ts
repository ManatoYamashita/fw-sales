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
  mockGetCurrentSession,
  mockRevalidateTag,
  mockGetTask,
  mockCreateClient,
} = vi.hoisted(() => ({
  mockRepo: {
    getById: vi.fn(),
    updateJobStatus: vi.fn(),
    appendJobError: vi.fn(),
  },
  mockGetCurrentSession: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockGetTask: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: { deepResearch: mockRepo },
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

import { pollGeminiJobAction } from "../deep-research-actions";
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
