/**
 * `createDeepResearchNotification` の単体テスト
 * (deep-research-pipeline spec, Issue #43, Task 3.3)
 *
 * カバレッジ (4 ケース):
 * 1. deep_research_done → 1 行 insert、登録ユーザー宛
 * 2. deep_research_failed → 1 行 insert、reason summary を body に含む
 * 3. deep_research_budget_warning → admin 全員に fan-out
 * 4. budget_warning で admin が 0 人なら no-op (空配列)
 *
 * 関連: requirements.md §4.1, §4.2, §4.4, §6.3, §7.4
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { createDeepResearchNotification } from "../notification-helpers";
import { mockDb } from "@/lib/mock/db";
import type { Profile } from "@/types/profile";

const USER_A = "00000000-0000-0000-0000-0000000000aa";
const ADMIN_1 = "00000000-0000-0000-0000-00000000ad01";
const ADMIN_2 = "00000000-0000-0000-0000-00000000ad02";

function seedProfile(p: Omit<Profile, "created_at" | "updated_at">) {
  mockDb.profiles.set(p.id, {
    ...p,
    created_at: "2026-05-17",
    updated_at: "2026-05-17",
  });
}

beforeEach(() => {
  process.env.USE_MOCK_DB = "true";
  mockDb.notifications.clear();
  mockDb.profiles.clear();
});

describe("createDeepResearchNotification", () => {
  it("deep_research_done → 1 行 insert、登録ユーザー宛", async () => {
    const created = await createDeepResearchNotification({
      kind: "deep_research_done",
      storeId: "store_xyz",
      storeName: "サンプル食堂",
      jobId: "job_001",
      userId: USER_A,
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.user_id).toBe(USER_A);
    expect(created[0]?.kind).toBe("deep_research_done");
    expect(created[0]?.link_url).toBe("/stores/store_xyz#deep-research");
    expect(created[0]?.title).toContain("サンプル食堂");
  });

  it("deep_research_failed → reason summary が body に含まれる", async () => {
    const created = await createDeepResearchNotification({
      kind: "deep_research_failed",
      storeId: "store_xyz",
      storeName: "サンプル食堂",
      jobId: "job_002",
      userId: USER_A,
      reasonSummary: "Stage 1 API がタイムアウトしました",
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.kind).toBe("deep_research_failed");
    expect(created[0]?.body).toContain("Stage 1 API がタイムアウト");
  });

  it("deep_research_budget_warning → admin 全員に fan-out", async () => {
    seedProfile({
      id: ADMIN_1,
      email: "admin1@example.com",
      display_name: "管理者 1",
      avatar_url: null,
      role: "admin",
    });
    seedProfile({
      id: ADMIN_2,
      email: "admin2@example.com",
      display_name: "管理者 2",
      avatar_url: null,
      role: "admin",
    });
    seedProfile({
      id: USER_A,
      email: "member@example.com",
      display_name: "メンバー",
      avatar_url: null,
      role: "member",
    });

    const created = await createDeepResearchNotification({
      kind: "deep_research_budget_warning",
      percent: 80,
      currentCount: 800,
      monthlyCap: 1000,
    });
    expect(created).toHaveLength(2);
    const userIds = created.map((n) => n.user_id).sort();
    expect(userIds).toEqual([ADMIN_1, ADMIN_2].sort());
    // member には届かない
    expect(userIds).not.toContain(USER_A);
    for (const n of created) {
      expect(n.kind).toBe("deep_research_budget_warning");
      expect(n.body).toContain("800/1000");
    }
  });

  it("budget_warning で admin が 0 人 → 空配列", async () => {
    const created = await createDeepResearchNotification({
      kind: "deep_research_budget_warning",
      percent: 80,
      currentCount: 800,
      monthlyCap: 1000,
    });
    expect(created).toEqual([]);
  });
});
