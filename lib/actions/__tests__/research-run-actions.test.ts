/**
 * `startResearchRunAction` の単体検証(AI 店舗調査再設計 Plan v3.2, PR3)。
 *
 * `workflow/api` の `start` / `@/lib/repositories` / `@/lib/supabase/server` / `next/cache`
 * をモックし、実 Gemini API・実 DB・実 Workflow 起動を一切行わない。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockStart,
  mockStoreGet,
  mockGetLatestForStore,
  mockCreate,
  mockUpdate,
  mockRevalidateTag,
  mockGetCurrentSession,
} = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStoreGet: vi.fn(),
  mockGetLatestForStore: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockGetCurrentSession: vi.fn(),
}));

vi.mock("workflow/api", () => ({ start: mockStart }));
vi.mock("@/workflows/store-research", () => ({ storeResearchWorkflow: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { get: mockStoreGet },
    researchRun: {
      getLatestForStore: mockGetLatestForStore,
      create: mockCreate,
      update: mockUpdate,
    },
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentSession: mockGetCurrentSession }));

const { startResearchRunAction } = await import("../research-run-actions");
const { _resetRateLimitForTest } = await import("@/lib/ai/rate-limiter");

let seq = 0;
const nextStoreId = () => `store-${++seq}`;

beforeEach(() => {
  mockStart.mockReset();
  mockStoreGet.mockReset();
  mockGetLatestForStore.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockRevalidateTag.mockReset();
  mockGetCurrentSession.mockReset();
  _resetRateLimitForTest();

  mockGetCurrentSession.mockResolvedValue({ userId: "user-1", email: "a@example.com" });
  mockStoreGet.mockResolvedValue({ id: "store-1", name: "テスト店舗" });
  mockGetLatestForStore.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "research_run_1", store_id: "store-1", status: "running" });
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
    mockGetLatestForStore.mockResolvedValue({ status: "running" });

    const result = await startResearchRunAction(nextStoreId());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("既に調査中");
    expect(mockCreate).not.toHaveBeenCalled();
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

  it("DB作成が部分ユニークインデックス違反で失敗した場合、二重起動エラーとして扱う(レース対策)", async () => {
    mockCreate.mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    const result = await startResearchRunAction(nextStoreId());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("既に調査中");
    expect(mockStart).not.toHaveBeenCalled();
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
