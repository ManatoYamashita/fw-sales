/**
 * `listSalesProgressRows` の profile 取得ガード (#161 follow-up)。
 *
 * `getAllProfiles` の `'use cache'` キャッシュキーは引数を含む。本関数と
 * `app/(main)/stores/page.tsx` の `ProgressFilterBarSlot` は同一リクエスト内で
 * 両方が profiles を必要とするため、**引数形状が食い違うとキーが割れ、
 * コールド時に同じ SELECT が 2 回走る**。
 *
 * また profiles を引数で受け取る形にすると、既定値 (`= []`) を許した場合に
 * 呼び出し側の渡し忘れで全行の `salesName` が null になり、`applyProgressSort` の
 * `case "sales"` が例外も型エラーも出さずタイブレーカへ落ちて「更新日降順」に
 * 無言で化ける。ここではその設計を機械的に固定する。
 *
 * テスト方針は lib/actions/__tests__/*.test.ts と同様 (repos / next をモック)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Store } from "@/types/store";

/** 型を満たす最小の Store (stores-sort.test.ts と同じ方針)。 */
function makeStore(overrides: Partial<Store>): Store {
  return {
    id: "store_1", name: "テスト店", prefecture: "", city: "", address: "", genre: "",
    priority: "中", stage: "未調査", channel: "未判定", has_contact_form: "未確認",
    map_url: "", site_url: "", instagram_url: "", phone: "", target_service: "",
    review_count: 0, review_avg: 0, memo: "",
    assigned_planner_user_id: null, assigned_sales_user_id: null,
    operator_type: "未設定", operator_name: "", ai_analysis_result: null,
    lat: null, lng: null, google_place_id: null,
    appointment_acquired_date: null, next_action_date: null, next_action_note: null,
    basic_info: {}, created_at: "2024-01-01", updated_at: "2024-01-01",
    ...overrides,
  };
}

vi.mock("server-only", () => ({}));

const { mockFindAll, mockStoreList, mockDealList } = vi.hoisted(() => ({
  mockFindAll: vi.fn(),
  mockStoreList: vi.fn(),
  mockDealList: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    profile: { findAll: mockFindAll },
    store: { list: mockStoreList },
    deal: { list: mockDealList },
  },
}));

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  revalidateTag: () => {},
}));

import { listSalesProgressRows } from "@/lib/queries/sales-progress";

beforeEach(() => {
  vi.clearAllMocks();
  mockFindAll.mockResolvedValue([]);
  mockStoreList.mockResolvedValue([]);
  mockDealList.mockResolvedValue([]);
});

describe("listSalesProgressRows の getAllProfiles 呼び出し", () => {
  it("profile 一覧を 1 リクエストにつき 1 回だけ取得する", async () => {
    await listSalesProgressRows();
    expect(mockFindAll).toHaveBeenCalledTimes(1);
  });

  it("引数形状を {excludePlaceholders: false} に固定する (キャッシュキー分裂の防止)", async () => {
    await listSalesProgressRows();
    expect(mockFindAll).toHaveBeenCalledWith({ excludePlaceholders: false });
  });

  it("取得した profile を salesName へ解決する (呼び出し側から渡さなくても解決される)", async () => {
    // profiles を引数受け取りに戻し、呼び出し側が渡し忘れると salesName が null になる。
    // ここが null に落ちると sales ソートが無言で「更新日降順」へ化けるため、
    // 内部で取得して解決していることを振る舞いとして固定する。
    mockFindAll.mockResolvedValue([{ id: "user_1", display_name: "山田太郎" }]);
    mockStoreList.mockResolvedValue([
      makeStore({ id: "store_1", assigned_sales_user_id: "user_1" }),
    ]);

    const rows = await listSalesProgressRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.salesName).toBe("山田太郎");
  });

  it("store / deal 一覧も同時に取得する", async () => {
    await listSalesProgressRows();
    expect(mockStoreList).toHaveBeenCalledTimes(1);
    expect(mockDealList).toHaveBeenCalledTimes(1);
  });

  it("店舗 0 件でも例外を投げず空配列を返す", async () => {
    await expect(listSalesProgressRows()).resolves.toEqual([]);
  });
});

describe("getAllProfiles の引数形状が呼び出し元間で一致する", () => {
  it("stores/page.tsx も {excludePlaceholders: false} で呼ぶ", async () => {
    const source = await readFile(
      path.join(process.cwd(), "app/(main)/stores/page.tsx"),
      "utf8",
    );
    expect(source).toContain("getAllProfiles({ excludePlaceholders: false })");
  });
});
