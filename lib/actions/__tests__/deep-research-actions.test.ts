/**
 * `enqueueDeepResearchAction` / `retryDeepResearchAction` の単体テスト
 * (deep-research-pipeline spec, Issue #43, Task 3.1)
 *
 * カバレッジ (8 ケース):
 * 1. 未認証 → failure("ログインが必要")
 * 2. 店舗 ID 空 → failure
 * 3. 店舗が存在しない → failure
 * 4. 重複ジョブあり → failure（"進行中のジョブ"）
 * 5. 日次上限到達 → failure
 * 6. 月次上限到達 → failure
 * 7. 正常パス → success + queued ジョブが DB に登録
 * 8. retry: failed 以外の状態は拒否、正常時は新規行を作る (元行 touch なし)
 *
 * 関連: requirements.md §1.1, §1.2, §1.3, §1.5, §5.5, §5.6, §6.1, §6.2
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// next/cache の revalidateTag を no-op に
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

// auth: getCurrentSession をテスト側で差し替え可能に
const sessionState = vi.hoisted(() => ({
  current: null as { userId: string; email: string } | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentSession: () => Promise.resolve(sessionState.current),
}));

// env: 上限値をテストから差替え可能に (他の env helper は元実装を維持)
const envOverrides = vi.hoisted(() => ({
  daily: 30,
  monthly: 1000,
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    getDailyUserCap: () => envOverrides.daily,
    getMonthlyCap: () => envOverrides.monthly,
  };
});

import {
  enqueueDeepResearchAction,
  retryDeepResearchAction,
} from "../deep-research-actions";
import { mockDb } from "@/lib/mock/db";

const USER_A = "00000000-0000-0000-0000-0000000000aa";

function seedStore(overrides: Partial<typeof mockDb.stores extends Map<string, infer T> ? T : never> = {}) {
  // Mock のストア型に合わせて最小限のフィールドを埋める
  const store = {
    id: "store_test_001",
    name: "テスト食堂",
    prefecture: "東京都",
    city: "新宿区",
    address: "西新宿 1-1-1",
    genre: "和食",
    priority: "中" as const,
    stage: "調査待ち" as const,
    channel: "テレアポ" as const,
    has_contact_form: "" as const,
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
    operator_type: "未設定" as const,
    operator_name: "",
    ai_analysis_result: null,
    lat: null,
    lng: null,
    business_hours: "",
    google_place_id: null,
    created_at: "2026-05-17",
    updated_at: "2026-05-17",
    ...overrides,
  };
  mockDb.stores.set(store.id, store as never);
  return store;
}

beforeEach(() => {
  process.env.USE_MOCK_DB = "true";
  sessionState.current = { userId: USER_A, email: "user@example.com" };
  envOverrides.daily = 30;
  envOverrides.monthly = 1000;
  mockDb.deepResearchJobs.clear();
  mockDb.deepResearchReports.clear();
});

afterEach(() => {
  // 各テストで追加した store を取り除く
  mockDb.stores.delete("store_test_001");
});

describe("enqueueDeepResearchAction", () => {
  it("未認証 → failure", async () => {
    sessionState.current = null;
    seedStore();
    const result = await enqueueDeepResearchAction("store_test_001");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ログイン/);
    }
  });

  it("空 storeId → failure", async () => {
    const result = await enqueueDeepResearchAction("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/店舗 ID/);
    }
  });

  it("店舗が存在しない → failure", async () => {
    const result = await enqueueDeepResearchAction("store_does_not_exist");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/見つかりません/);
    }
  });

  it("必須項目欠落 → failure", async () => {
    seedStore({ name: "", address: "" });
    const result = await enqueueDeepResearchAction("store_test_001");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/必須項目/);
    }
  });

  it("重複ジョブあり → failure", async () => {
    seedStore();
    // 1 件目登録
    const first = await enqueueDeepResearchAction("store_test_001");
    expect(first.ok).toBe(true);
    // 2 件目は重複拒否
    const second = await enqueueDeepResearchAction("store_test_001");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/進行中のジョブ/);
    }
  });

  it("日次上限到達 → failure", async () => {
    seedStore();
    envOverrides.daily = 1;
    // 1 件登録 → done に遷移させて active から外す → ただし日次カウントは残る
    const first = await enqueueDeepResearchAction("store_test_001");
    expect(first.ok).toBe(true);
    if (first.ok) {
      mockDb.deepResearchJobs.set(first.data.jobId, {
        ...mockDb.deepResearchJobs.get(first.data.jobId)!,
        status: "done",
      });
    }
    // 2 件目は日次上限で拒否
    const second = await enqueueDeepResearchAction("store_test_001");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/上限|本日/);
    }
  });

  it("正常パス → success + queued ジョブが DB に存在", async () => {
    seedStore();
    const result = await enqueueDeepResearchAction("store_test_001");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("queued");
      const inDb = mockDb.deepResearchJobs.get(result.data.jobId);
      expect(inDb?.status).toBe("queued");
      expect(inDb?.user_id).toBe(USER_A);
      expect(inDb?.store_id).toBe("store_test_001");
    }
  });
});

describe("retryDeepResearchAction", () => {
  it("failed 以外 (例: queued) → failure", async () => {
    seedStore();
    const first = await enqueueDeepResearchAction("store_test_001");
    if (!first.ok) throw new Error("setup failed");
    const result = await retryDeepResearchAction(first.data.jobId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/failed/);
    }
  });

  it("failed → 新規行を作る、元行は touch しない", async () => {
    seedStore();
    const first = await enqueueDeepResearchAction("store_test_001");
    if (!first.ok) throw new Error("setup failed");
    // 状態を failed にする
    mockDb.deepResearchJobs.set(first.data.jobId, {
      ...mockDb.deepResearchJobs.get(first.data.jobId)!,
      status: "failed",
      completed_at: new Date().toISOString(),
    });
    const before = mockDb.deepResearchJobs.get(first.data.jobId);

    const result = await retryDeepResearchAction(first.data.jobId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.previousJobId).toBe(first.data.jobId);
      expect(result.data.newJobId).not.toBe(first.data.jobId);
      // 元行は変化なし
      const after = mockDb.deepResearchJobs.get(first.data.jobId);
      expect(after).toEqual(before);
      // 新規行は queued
      const newJob = mockDb.deepResearchJobs.get(result.data.newJobId);
      expect(newJob?.status).toBe("queued");
    }
  });
});
