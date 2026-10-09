/**
 * 調査状態の画面間一致 (#299)。
 *
 * #299 では同じ本番データに対して、サイドバー「調査」バッジ 5 / `/research` の要確認タブ 4 /
 * `/stores` の「未調査」5 と、画面ごとに別の数が出ていた。原因は 3 画面が別々の述語で
 * 数えていたこと。ここでは本番で起きた食い違いを再現する 1 つの fixture を 3 経路に通し、
 * 件数と店舗ごとの状態が一致することを固定する。
 *
 * repos だけをモックし、クエリ層 (`getResearchQueue` / `getResearchNavBadgeCount` /
 * `listSalesProgressRows`) は実物を通す。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "@/types/store";

vi.mock("server-only", () => ({}));

const { mockStoreList, mockNeedsReview } = vi.hoisted(() => ({
  mockStoreList: vi.fn(),
  mockNeedsReview: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { list: mockStoreList },
    deal: { list: vi.fn().mockResolvedValue([]) },
    handoff: { list: vi.fn().mockResolvedValue([]) },
    profile: { findAll: vi.fn().mockResolvedValue([]) },
    researchRun: { listStoreIdsNeedingReview: mockNeedsReview },
  },
}));

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  revalidateTag: () => {},
}));

import { getResearchQueue } from "@/lib/queries/research";
import { getResearchNavBadgeCount } from "@/lib/queries/stats";
import { listSalesProgressRows } from "@/lib/queries/sales-progress";

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

/** #299 の観察を縮約した fixture。 */
const STORES = [
  // 未調査のままレビュー待ち (例: 店舗一覧では「未調査」、/research では「要確認」だった店)
  makeStore({ id: "unresearched_pending", stage: "未調査" }),
  // 調査済みなのにレビュー待ち (例: 関内 なむら)
  makeStore({ id: "researched_pending", stage: "調査済み" }),
  // 架電済みなのにレビュー待ち (例: トラットリア SOLE)
  makeStore({ id: "contacted_pending", stage: "架電済み" }),
  makeStore({ id: "waiting", stage: "未調査" }),
  makeStore({ id: "done", stage: "調査済み" }),
];
const NEEDS_REVIEW = ["unresearched_pending", "researched_pending", "contacted_pending"];

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreList.mockResolvedValue(STORES);
  mockNeedsReview.mockResolvedValue(NEEDS_REVIEW);
});

describe("調査状態の画面間一致 (#299)", () => {
  it("サイドバーのバッジ = /research のレビュー待ちタブ = /stores でレビュー待ちと出る行", async () => {
    const [queue, badge, rows] = await Promise.all([
      getResearchQueue(),
      getResearchNavBadgeCount(),
      listSalesProgressRows(),
    ]);

    const pendingRows = rows.filter((r) => r.researchStatus === "レビュー待ち");
    expect(badge).toBe(3);
    expect(queue.needsReview).toHaveLength(badge);
    expect(pendingRows).toHaveLength(badge);
  });

  it("店舗ごとの状態が /research のタブと /stores の調査段階列で矛盾しない", async () => {
    const [queue, rows] = await Promise.all([getResearchQueue(), listSalesProgressRows()]);

    const tabOf = new Map<string, string>();
    for (const s of queue.needsReview) tabOf.set(s.id, "レビュー待ち");
    for (const s of queue.waiting) tabOf.set(s.id, "調査待ち");
    for (const s of queue.done) tabOf.set(s.id, "調査済み");

    // /stores の調査状態を /research のタブへ写す。調査済み・架電済みはどちらも「調査済み」タブ。
    const toTab = (status: string) =>
      status === "レビュー待ち" ? "レビュー待ち" : status === "未調査" ? "調査待ち" : "調査済み";

    for (const row of rows) {
      expect(toTab(row.researchStatus), row.store.id).toBe(tabOf.get(row.store.id));
    }
  });

  it("バッジは stage=未調査 の件数を数えない (#121 以来の旧定義へ退行しない)", async () => {
    const stageUnresearched = STORES.filter((s) => s.stage === "未調査").length;
    const badge = await getResearchNavBadgeCount();
    // fixture は 2 つの定義で件数が分かれるように組んである。等しいと検知力が無い。
    expect(stageUnresearched).not.toBe(NEEDS_REVIEW.length);
    expect(badge).toBe(NEEDS_REVIEW.length);
  });
});
