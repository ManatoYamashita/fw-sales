/**
 * `getDealsDueSoon(mode)` の単体テスト (auth-and-notifications spec, Issue #16)
 *
 * カバレッジ:
 * 1. `mode='tomorrow'` で翌日 JST のみ抽出
 * 2. `mode='today'` で当日 JST のみ抽出
 * 3. 担当者 NULL の商談は除外 (Req 6.7)
 * 4. ユーザーごとに集約される (2 名 × 各 2 件 → 2 bundle)
 *
 * 関連: requirements.md §6.1, §6.2, §6.3, §6.4, §6.7
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Deal } from "@/types/deal";
import type { Profile } from "@/types/profile";

// `repos.deal.list()` と `repos.profile.findManyByIds()` をモック化
const dealListMock = vi.fn();
const profileFindManyMock = vi.fn();

vi.mock("@/lib/repositories", () => ({
  repos: {
    deal: { list: dealListMock },
    profile: { findManyByIds: profileFindManyMock },
  },
}));

const { getDealsDueSoon } = await import("../deals-due-soon");

/**
 * テスト用に固定された JST 基準時刻を設定する。
 * UTC 2026-05-16T03:00 = JST 2026-05-16T12:00 → jstYmd() = "2026-05-16"。
 * 翌日 JST = "2026-05-17"。
 */
const FIXED_NOW = new Date("2026-05-16T03:00:00Z");
const TODAY_JST = "2026-05-16";
const TOMORROW_JST = "2026-05-17";

function makeDeal(overrides: Partial<Deal>): Deal {
  return {
    id: "deal_001",
    store_id: "store_001",
    store_name: "テスト店舗",
    date: TODAY_JST,
    meeting_type: "対面",
    discussion: "",
    proposal: "提案A",
    estimate_amount: 0,
    order_amount: null,
    lost_reason: "",
    status: "継続追客",
    assigned_sales_user_id: "user_001",
    created_at: TODAY_JST,
    updated_at: TODAY_JST,
    ...overrides,
  };
}

function makeProfile(id: string, display_name: string): Profile {
  return {
    id,
    email: `${id}@example.com`,
    display_name,
    avatar_url: null,
    role: "member",
    created_at: TODAY_JST,
    updated_at: TODAY_JST,
  };
}

describe("getDealsDueSoon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    dealListMock.mockReset();
    profileFindManyMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mode='tomorrow' で翌日 JST のみ抽出する", async () => {
    dealListMock.mockResolvedValueOnce([
      makeDeal({ id: "d1", date: TOMORROW_JST, assigned_sales_user_id: "u1" }),
      makeDeal({ id: "d2", date: TODAY_JST, assigned_sales_user_id: "u1" }),
      makeDeal({ id: "d3", date: "2026-05-20", assigned_sales_user_id: "u1" }),
    ]);
    profileFindManyMock.mockResolvedValueOnce([makeProfile("u1", "佐藤")]);

    const bundles = await getDealsDueSoon("tomorrow");
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.deals).toHaveLength(1);
    expect(bundles[0]?.deals[0]?.store_id).toBe("store_001");
  });

  it("mode='today' で当日 JST のみ抽出する", async () => {
    dealListMock.mockResolvedValueOnce([
      makeDeal({ id: "d1", date: TODAY_JST, assigned_sales_user_id: "u1" }),
      makeDeal({ id: "d2", date: TOMORROW_JST, assigned_sales_user_id: "u1" }),
    ]);
    profileFindManyMock.mockResolvedValueOnce([makeProfile("u1", "佐藤")]);

    const bundles = await getDealsDueSoon("today");
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.deals).toHaveLength(1);
  });

  it("担当者 NULL の商談は除外される (Req 6.7)", async () => {
    dealListMock.mockResolvedValueOnce([
      makeDeal({ id: "d1", date: TODAY_JST, assigned_sales_user_id: null }),
      makeDeal({ id: "d2", date: TODAY_JST, assigned_sales_user_id: "u1" }),
    ]);
    profileFindManyMock.mockResolvedValueOnce([makeProfile("u1", "佐藤")]);

    const bundles = await getDealsDueSoon("today");
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.deals).toHaveLength(1);
    expect(profileFindManyMock).toHaveBeenCalledWith(["u1"]);
  });

  it("ユーザーごとに集約される (2 名 × 各 2 件 → 2 bundle)", async () => {
    dealListMock.mockResolvedValueOnce([
      makeDeal({ id: "d1", date: TODAY_JST, assigned_sales_user_id: "u1", store_id: "s1" }),
      makeDeal({ id: "d2", date: TODAY_JST, assigned_sales_user_id: "u1", store_id: "s2" }),
      makeDeal({ id: "d3", date: TODAY_JST, assigned_sales_user_id: "u2", store_id: "s3" }),
      makeDeal({ id: "d4", date: TODAY_JST, assigned_sales_user_id: "u2", store_id: "s4" }),
    ]);
    profileFindManyMock.mockResolvedValueOnce([
      makeProfile("u1", "佐藤"),
      makeProfile("u2", "渡部"),
    ]);

    const bundles = await getDealsDueSoon("today");
    expect(bundles).toHaveLength(2);
    const sato = bundles.find((b) => b.profile.id === "u1");
    const watabe = bundles.find((b) => b.profile.id === "u2");
    expect(sato?.deals).toHaveLength(2);
    expect(watabe?.deals).toHaveLength(2);
  });

  it("対象 0 件の場合は profile.findManyByIds を呼ばず空配列を返す", async () => {
    dealListMock.mockResolvedValueOnce([
      makeDeal({ id: "d1", date: "2026-12-31", assigned_sales_user_id: "u1" }),
    ]);

    const bundles = await getDealsDueSoon("today");
    expect(bundles).toEqual([]);
    expect(profileFindManyMock).not.toHaveBeenCalled();
  });
});
