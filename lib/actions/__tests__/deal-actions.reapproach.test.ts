/**
 * 失注時の再アプローチ可否 (#297) の保存と正規化。
 *
 * 現場が店舗名に「（Rアポ）」「（確バツ）」と書いていた情報の受け皿。失注以外では
 * 意味を持たないので、status を単一の真実として null へ落とす
 * (order_amount / lost_reason と同じ規約。`normalizeDealStatusAmounts`)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(), getStore: vi.fn(), getDeal: vi.fn(), create: vi.fn(), update: vi.fn(),
  findProfile: vi.fn(), revalidate: vi.fn(), updateTag: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getProfile }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate, updateTag: mocks.updateTag }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { get: mocks.getStore },
    deal: { get: mocks.getDeal, create: mocks.create, update: mocks.update },
    profile: { findById: mocks.findProfile },
    transaction: mocks.transaction,
  },
}));

const { createDealAction, updateDealAction } = await import("../deal-actions");

const profile = { id: "user-1", display_name: "担当", email: "a@example.com", role: "member" };
const store = { id: "store-1", name: "炉端ジュン", assigned_sales_user_id: null, stage: "架電済み" };
const lostDeal = {
  id: "deal-1", store_id: "store-1", status: "失注", order_amount: null,
  lost_reason: "ハマらず", reapproach: "再アプローチ可",
};

function data(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getProfile.mockResolvedValue(profile);
  mocks.getStore.mockResolvedValue(store);
  mocks.getDeal.mockResolvedValue(lostDeal);
  mocks.findProfile.mockResolvedValue(profile);
  mocks.create.mockImplementation(async (input: object) => ({ id: "deal-new", ...input }));
  mocks.update.mockImplementation(async (id: string, patch: object) => ({ id, store_id: "store-1", ...patch }));
  // 作成は常に tx 経由 (Deal 作成 + stage 昇格)。tx スコープの deal を通常の mock へ繋ぐ。
  mocks.transaction.mockImplementation(async (fn: (tx: { deal: { create: typeof mocks.create; update: typeof mocks.update }; store: { update: () => Promise<void> } }) => unknown) =>
    fn({ deal: { create: mocks.create, update: mocks.update }, store: { update: async () => undefined } }),
  );
});

describe("createDealAction: 再アプローチ可否", () => {
  it.each(["再アプローチ可", "再アプローチ不可"] as const)("失注で %s を保存する", async (value) => {
    const result = await createDealAction("store-1", null, data({ status: "失注", lost_reason: "予算", reapproach: value }));
    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: "失注", lost_reason: "予算", reapproach: value }));
  });

  it("未判断 (空文字) は null で保存する", async () => {
    await createDealAction("store-1", null, data({ status: "失注", reapproach: "" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ reapproach: null }));
  });

  it("失注以外では送られても null に落とす", async () => {
    await createDealAction("store-1", null, data({ status: "継続追客", reapproach: "再アプローチ不可" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: "継続追客", reapproach: null }));
  });

  it("選択肢にない値は保存せず拒否する", async () => {
    const result = await createDealAction("store-1", null, data({ status: "失注", reapproach: "バツ" }));
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "再アプローチ可否が不正です" }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("updateDealAction: 再アプローチ可否", () => {
  it("失注のまま可否だけを変更できる", async () => {
    await updateDealAction("deal-1", null, data({ reapproach: "再アプローチ不可" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ reapproach: "再アプローチ不可", lost_reason: "ハマらず" }));
  });

  it("可否を送らない更新では既存の値を保つ", async () => {
    await updateDealAction("deal-1", null, data({ status: "失注", lost_reason: "新しい理由" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ lost_reason: "新しい理由", reapproach: "再アプローチ可" }));
  });

  it("失注から別の状態へ変えると可否を null に戻す (旧値を残さない)", async () => {
    await updateDealAction("deal-1", null, data({ status: "アポ取得" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ status: "アポ取得", reapproach: null, lost_reason: "" }));
  });

  it("status も可否も送らない更新では可否に触れない", async () => {
    await updateDealAction("deal-1", null, data({ activity_memo: "メモだけ" }));
    expect(mocks.update.mock.calls[0]![1]).not.toHaveProperty("reapproach");
  });
});
