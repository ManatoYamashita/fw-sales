/**
 * `getDeepResearchReport` / `getDeepResearchJobByStore` / `getRecentNotifications`
 * の単体テスト (deep-research-pipeline spec, Issue #43, Tasks 3.2 + 3.4)
 *
 * Cache Components ('use cache') の挙動はテストで再現しにくいため、
 * underlying repo 経由のデータ取得結果を検証する純粋なフィルタロジックテストとする。
 *
 * カバレッジ (6 ケース):
 * 1. getDeepResearchReport: 未認証で null
 * 2. getDeepResearchReport: 認証済 + レポート無し → null
 * 3. getDeepResearchReport: 認証済 + レポート有り → 最新を返す
 * 4. getDeepResearchJobByStore: 進行中ジョブ無し → null
 * 5. getDeepResearchJobByStore: 進行中ジョブ有り → 返す
 * 6. getRecentNotifications: userId null → 空配列、limit 上限を尊重
 *
 * 関連: requirements.md §4.1, §4.2, §4.3, §5.2, §7.5
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  revalidateTag: vi.fn(),
}));

// auth: getCurrentSession をテストから差替え可能に
const sessionState = vi.hoisted(() => ({
  current: null as { userId: string; email: string } | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentSession: () => Promise.resolve(sessionState.current),
}));

import {
  getDeepResearchReport,
  getDeepResearchJobByStore,
} from "../deep-research";
import { getRecentNotifications } from "../notification";
import { mockDb } from "@/lib/mock/db";
import type { DeepResearchReport } from "@/types/deep-research";

const USER_A = "00000000-0000-0000-0000-0000000000aa";
const STORE_1 = "store_test_001";

beforeEach(() => {
  process.env.USE_MOCK_DB = "true";
  sessionState.current = { userId: USER_A, email: "u@example.com" };
  mockDb.deepResearchJobs.clear();
  mockDb.deepResearchReports.clear();
  mockDb.notifications.clear();
});

function seedReport(overrides: Partial<DeepResearchReport> = {}): DeepResearchReport {
  const r: DeepResearchReport = {
    id: `report_${Math.random().toString(36).slice(2, 8)}`,
    job_id: "job_seed",
    store_id: STORE_1,
    category_1_basic: [],
    category_2_owner: [],
    category_3_menu: [],
    category_4_customer: [],
    category_5_marketing: [],
    category_6_competitor: [],
    category_7_owned_media: [],
    category_8_other: [],
    hearing_questions: [],
    full_markdown: "## レポート",
    all_source_urls: [],
    total_cost_yen: null,
    total_duration_sec: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  mockDb.deepResearchReports.set(r.id, r);
  return r;
}

describe("getDeepResearchReport", () => {
  it("未認証 → null", async () => {
    sessionState.current = null;
    seedReport();
    const result = await getDeepResearchReport(STORE_1);
    expect(result).toBeNull();
  });

  it("認証済 + レポート無し → null", async () => {
    const result = await getDeepResearchReport("store_no_report");
    expect(result).toBeNull();
  });

  it("認証済 + 複数レポート → 最新を返す", async () => {
    seedReport({
      created_at: "2026-05-16T00:00:00.000Z",
      full_markdown: "## 旧",
    });
    seedReport({
      created_at: "2026-05-17T00:00:00.000Z",
      full_markdown: "## 新",
    });
    const result = await getDeepResearchReport(STORE_1);
    expect(result?.full_markdown).toBe("## 新");
  });
});

describe("getDeepResearchJobByStore", () => {
  it("進行中ジョブ無し → null", async () => {
    const result = await getDeepResearchJobByStore(STORE_1);
    expect(result).toBeNull();
  });

  it("進行中ジョブ有り → 返す、done は除外", async () => {
    mockDb.deepResearchJobs.set("job_done", {
      id: "job_done",
      store_id: STORE_1,
      user_id: USER_A,
      status: "done",
      deep_research_task_id: null,
      attempts: 0,
      error_log: null,
      enqueued_at: "2026-05-16T00:00:00.000Z",
      research_started_at: null,
      research_completed_at: null,
      completed_at: null,
    });
    mockDb.deepResearchJobs.set("job_researching", {
      id: "job_researching",
      store_id: STORE_1,
      user_id: USER_A,
      status: "researching",
      deep_research_task_id: "interactions/abc",
      attempts: 1,
      error_log: null,
      enqueued_at: "2026-05-17T00:00:00.000Z",
      research_started_at: "2026-05-17T01:00:00.000Z",
      research_completed_at: null,
      completed_at: null,
    });
    const result = await getDeepResearchJobByStore(STORE_1);
    expect(result?.id).toBe("job_researching");
  });
});

describe("getRecentNotifications", () => {
  it("userId が null/空 → 空配列", async () => {
    expect(await getRecentNotifications(null)).toEqual([]);
    expect(await getRecentNotifications("")).toEqual([]);
    expect(await getRecentNotifications("   ")).toEqual([]);
  });

  it("limit は default 10, 上限 50 でクランプ", async () => {
    for (let i = 0; i < 60; i++) {
      const id = `notif_${i.toString().padStart(3, "0")}`;
      mockDb.notifications.set(id, {
        id,
        user_id: USER_A,
        kind: "deep_research_done",
        title: `title ${i}`,
        body: `body ${i}`,
        link_url: null,
        read_at: null,
        created_at: `2026-05-17T${i.toString().padStart(2, "0")}:00:00.000Z`,
        updated_at: `2026-05-17T${i.toString().padStart(2, "0")}:00:00.000Z`,
      });
    }
    const def = await getRecentNotifications(USER_A);
    expect(def.length).toBe(10);
    const clamped = await getRecentNotifications(USER_A, 999);
    expect(clamped.length).toBe(50);
    const exact = await getRecentNotifications(USER_A, 3);
    expect(exact.length).toBe(3);
  });
});
