import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEAL_STATUSES, MEETING_TYPES } from "@/types/deal";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(), getStore: vi.fn(), getDeal: vi.fn(), create: vi.fn(), update: vi.fn(), findProfile: vi.fn(), revalidate: vi.fn(), redirect: vi.fn(),
  transaction: vi.fn(), storeStageUpdate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getProfile }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { get: mocks.getStore },
    deal: { get: mocks.getDeal, create: mocks.create, update: mocks.update, delete: vi.fn() },
    profile: { findById: mocks.findProfile },
    transaction: mocks.transaction,
  },
}));

const { createDealAction, updateDealAction } = await import("../deal-actions");
const profile = { id: "user-1", display_name: "担当", email: "a@example.com", role: "member" };
// stage を "架電済み" (= 昇格済み) にしておくと、Middle 1 系のテストで
// store stage 昇格トランザクションの分岐が余計に絡まない (Middle 7 のテストで個別に上書きする)。
const store = { id: "store-1", name: "店舗", assigned_sales_user_id: null, stage: "架電済み" };
const current = { id: "deal-1", store_id: "store-1", status: "初回接触", order_amount: null, lost_reason: "" };
function data(values: Record<string, string>) { const fd = new FormData(); for (const [k, v] of Object.entries(values)) fd.set(k, v); return fd; }
function valid(overrides: Record<string, string> = {}) { return data({ date: "2026-07-18", meeting_type: "DM", status: "初回接触", assigned_sales_user_id: "", activity_memo: "見積書を送付", proposal: "提案", discussion: "確認内容", estimate_amount: "1000", order_amount: "", lost_reason: "", next_action_date: "2026-07-20", next_action_type: "電話", next_action_note: "回答確認", ...overrides }); }

describe("営業記録Action", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getProfile.mockResolvedValue(profile);
    mocks.getStore.mockResolvedValue(store);
    mocks.getDeal.mockResolvedValue(current);
    mocks.findProfile.mockResolvedValue(profile);
    // repos.transaction をそのまま fn 実行として動かし、tx スコープの deal / store を
    // 通常の mock (create/update) + 専用の storeStageUpdate で構成する。
    mocks.transaction.mockImplementation(async (fn: (tx: { deal: { create: typeof mocks.create; update: typeof mocks.update }; store: { update: typeof mocks.storeStageUpdate } }) => unknown) =>
      fn({ deal: { create: mocks.create, update: mocks.update }, store: { update: mocks.storeStageUpdate } }),
    );
  });

  it("全項目を持つ営業記録を新規作成する", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    const result = await createDealAction("store-1", null, valid());
    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ meeting_type: "DM", status: "初回接触", activity_memo: "見積書を送付", next_action_date: "2026-07-20", next_action_type: "電話", next_action_note: "回答確認" }));
  });

  it("全活動種別と全営業状態を受理する", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    for (const meeting_type of MEETING_TYPES) {
      expect((await createDealAction("store-1", null, valid({ meeting_type }))).ok).toBe(true);
    }
    for (const status of DEAL_STATUSES) {
      expect((await createDealAction("store-1", null, valid({ status }))).ok).toBe(true);
    }
  });

  it("不正な列挙値・実在しない日付・負数・上限超過を拒否する", async () => {
    for (const fd of [valid({ meeting_type: "FAX" }), valid({ status: "完了" }), valid({ next_action_type: "会議" }), valid({ date: "2026-02-30" }), valid({ estimate_amount: "-1" }), valid({ activity_memo: "あ".repeat(5001) }), valid({ next_action_note: "あ".repeat(501) }), valid({ lost_reason: "あ".repeat(10001) })]) {
      expect((await createDealAction("store-1", null, fd)).ok).toBe(false);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("lost_reason は10000文字を受理し、10001文字を拒否する (Low B 境界値)", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    expect((await createDealAction("store-1", null, valid({ status: "失注", lost_reason: "あ".repeat(10000) }))).ok).toBe(true);
    expect((await createDealAction("store-1", null, valid({ status: "失注", lost_reason: "あ".repeat(10001) }))).ok).toBe(false);
  });

  it("更新は送信した項目だけ変更し、空文字をnullへクリアする", async () => {
    mocks.update.mockResolvedValue({ ...current, next_action_note: null });
    const result = await updateDealAction("deal-1", null, data({ next_action_note: "" }));
    expect(result.ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith("deal-1", { next_action_note: null });
  });

  it("未認証と不存在を拒否し、DB例外を露出しない", async () => {
    mocks.getProfile.mockResolvedValueOnce(null);
    expect(await createDealAction("store-1", null, valid())).toEqual({ ok: false, error: "ログインが必要です" });
    mocks.getStore.mockResolvedValueOnce(null);
    expect((await createDealAction("missing", null, valid())).ok).toBe(false);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.create.mockRejectedValueOnce(new Error("password=secret"));
    const result = await createDealAction("store-1", null, valid());
    expect(result).toEqual({ ok: false, error: "営業記録の追加に失敗しました" });
    expect(JSON.stringify(result)).not.toContain("secret");
    spy.mockRestore();
  });

  it("updateDealAction: 存在しない dealId は失敗を返し、repository を呼ばない", async () => {
    mocks.getDeal.mockResolvedValueOnce(null);
    const result = await updateDealAction("missing", null, data({ next_action_note: "x" }));
    expect(result).toEqual({ ok: false, error: "営業記録が見つかりませんでした" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updateDealAction: repository の update が null を返す場合は失敗を返す", async () => {
    mocks.update.mockResolvedValueOnce(null);
    const result = await updateDealAction("deal-1", null, data({ next_action_note: "x" }));
    expect(result).toEqual({ ok: false, error: "営業記録が見つかりませんでした" });
  });
});

describe("status に応じた order_amount / lost_reason の正規化 (Middle 1)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getProfile.mockResolvedValue(profile);
    mocks.getStore.mockResolvedValue(store);
    mocks.getDeal.mockResolvedValue(current);
    mocks.findProfile.mockResolvedValue(profile);
    mocks.transaction.mockImplementation(async (fn: (tx: { deal: { create: typeof mocks.create; update: typeof mocks.update }; store: { update: typeof mocks.storeStageUpdate } }) => unknown) =>
      fn({ deal: { create: mocks.create, update: mocks.update }, store: { update: mocks.storeStageUpdate } }),
    );
  });

  it("受注 → 失注 で order_amount が null になる", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "受注", order_amount: 50000, lost_reason: "" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "失注" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ status: "失注", order_amount: null }));
  });

  it("失注 → 受注 で lost_reason が空になる", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "失注", order_amount: null, lost_reason: "予算不足" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "受注", order_amount: "80000" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ status: "受注", lost_reason: "", order_amount: 80000 }));
  });

  it("受注 → 継続追客 で order_amount が null になる", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "受注", order_amount: 30000, lost_reason: "" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "継続追客" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ status: "継続追客", order_amount: null, lost_reason: "" }));
  });

  it("失注 → 初回接触 で lost_reason が空になる", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "失注", order_amount: null, lost_reason: "予算不足" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "初回接触" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ status: "初回接触", lost_reason: "", order_amount: null }));
  });

  it("受注のまま金額を更新できる", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "受注", order_amount: 10000, lost_reason: "" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "受注", order_amount: "99000" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ status: "受注", order_amount: 99000 }));
  });

  it("失注のまま理由を更新できる", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "失注", order_amount: null, lost_reason: "旧理由" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "失注", lost_reason: "新しい理由" }));
    expect(mocks.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ status: "失注", lost_reason: "新しい理由", order_amount: null }));
  });

  it("create 時も status に応じて正規化する", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid({ status: "失注", order_amount: "12345", lost_reason: "予算超過" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: "失注", order_amount: null, lost_reason: "予算超過" }));
  });

  it("失注記録は order_amount が null になるため、handoffへ旧受注金額が流れない", async () => {
    // handoff-new-form.tsx は `deal.order_amount ?? deal.estimate_amount` で初期費用を決めるため、
    // 失注記録の order_amount が確実に null であることが「旧受注金額が引き継がれない」ことの保証になる。
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "受注", order_amount: 500000, lost_reason: "" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "失注" }));
    const patch = mocks.update.mock.calls[0]?.[1] as { order_amount: number | null };
    expect(patch.order_amount).toBeNull();
  });
});

describe("Deal作成/更新時の Store.stage 自動昇格 (Middle 7)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getProfile.mockResolvedValue(profile);
    mocks.getDeal.mockResolvedValue(current);
    mocks.findProfile.mockResolvedValue(profile);
    mocks.transaction.mockImplementation(async (fn: (tx: { deal: { create: typeof mocks.create; update: typeof mocks.update }; store: { update: typeof mocks.storeStageUpdate } }) => unknown) =>
      fn({ deal: { create: mocks.create, update: mocks.update }, store: { update: mocks.storeStageUpdate } }),
    );
  });

  it("未調査Storeに初回接触を追加すると架電済みへ昇格する (create)", async () => {
    mocks.getStore.mockResolvedValue({ ...store, stage: "未調査" });
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid({ status: "初回接触" }));
    expect(mocks.storeStageUpdate).toHaveBeenCalledWith("store-1", { stage: "架電済み" });
  });

  it("調査済みStoreにアポ取得を追加すると架電済みへ昇格する (create)", async () => {
    mocks.getStore.mockResolvedValue({ ...store, stage: "調査済み" });
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid({ status: "アポ取得" }));
    expect(mocks.storeStageUpdate).toHaveBeenCalledWith("store-1", { stage: "架電済み" });
  });

  it("DeepResearch済みStoreに継続追客を追加すると架電済みへ昇格する (update)", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "初回接触", order_amount: null, lost_reason: "" });
    mocks.getStore.mockResolvedValue({ ...store, stage: "DeepResearch済み" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "継続追客" }));
    expect(mocks.storeStageUpdate).toHaveBeenCalledWith("store-1", { stage: "架電済み" });
  });

  it("Deal更新でstatusだけ変更しても、未到達Storeなら昇格する", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "初回接触", order_amount: null, lost_reason: "" });
    mocks.getStore.mockResolvedValue({ ...store, stage: "調査済み" });
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ status: "アポ取得" }));
    expect(mocks.storeStageUpdate).toHaveBeenCalledWith("store-1", { stage: "架電済み" });
  });

  it("既に架電済みのStoreは stage を更新しない", async () => {
    mocks.getStore.mockResolvedValue({ ...store, stage: "架電済み" });
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid());
    expect(mocks.storeStageUpdate).not.toHaveBeenCalled();
  });

  it("Deal作成が失敗した場合はStoreだけ更新されず、cache invalidationも起きない", async () => {
    mocks.getStore.mockResolvedValue({ ...store, stage: "未調査" });
    mocks.create.mockRejectedValueOnce(new Error("db error"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await createDealAction("store-1", null, valid());
    expect(result.ok).toBe(false);
    expect(mocks.storeStageUpdate).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("トランザクション内のStore更新が失敗した場合はDealだけ保存されない (失敗として返る)", async () => {
    mocks.getStore.mockResolvedValue({ ...store, stage: "未調査" });
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    mocks.storeStageUpdate.mockRejectedValueOnce(new Error("store update failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await createDealAction("store-1", null, valid());
    expect(result.ok).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
