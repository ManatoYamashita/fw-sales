import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEAL_STATUSES, MEETING_TYPES } from "@/types/deal";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(), getStore: vi.fn(), getDeal: vi.fn(), create: vi.fn(), update: vi.fn(), findProfile: vi.fn(), revalidate: vi.fn(), updateTag: vi.fn(), redirect: vi.fn(),
  transaction: vi.fn(), storeStageUpdate: vi.fn(), dealDelete: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getProfile }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate, updateTag: mocks.updateTag }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { get: mocks.getStore },
    deal: { get: mocks.getDeal, create: mocks.create, update: mocks.update, delete: mocks.dealDelete },
    profile: { findById: mocks.findProfile },
    transaction: mocks.transaction,
  },
}));

const { createDealAction, updateDealAction, deleteSalesActivityAction } = await import("../deal-actions");
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

  it("調査済みStoreに継続追客を追加すると架電済みへ昇格する (update)", async () => {
    mocks.getDeal.mockResolvedValueOnce({ id: "deal-1", store_id: "store-1", status: "初回接触", order_amount: null, lost_reason: "" });
    mocks.getStore.mockResolvedValue({ ...store, stage: "調査済み" });
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
    expect(mocks.updateTag).not.toHaveBeenCalled();
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
    expect(mocks.updateTag).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("金額の上限検証 (#172)", () => {
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

  it("DB integer 上限 (2147483647) ちょうどは受理する", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    expect((await createDealAction("store-1", null, valid({ estimate_amount: "2147483647" }))).ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ estimate_amount: 2147483647 }));
  });

  it("上限超過 (2147483648) と巨大値は拒否し、repository を呼ばない", async () => {
    for (const fd of [valid({ estimate_amount: "2147483648" }), valid({ status: "受注", order_amount: "9007199254740993" })]) {
      expect((await createDealAction("store-1", null, fd)).ok).toBe(false);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["1e3", "+100", "-100", "0x10", "0b101", "1.5", "1000円", " 100", "100 ", "2147483648"])(
    "createは非canonical金額 %j を拒否し、repositoryを呼ばない",
    async (estimateAmount) => {
      const result = await createDealAction("store-1", null, valid({ estimate_amount: estimateAmount }));
      expect(result.ok).toBe(false);
      expect(mocks.getStore).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["1e3", "+100", "-100", "0x10", "0b101", "1.5", "1000円", " 100", "100 ", "2147483648"])(
    "updateは非canonical金額 %j を拒否し、repositoryを呼ばない",
    async (estimateAmount) => {
      const result = await updateDealAction("deal-1", null, data({ estimate_amount: estimateAmount }));
      expect(result.ok).toBe(false);
      expect(mocks.getDeal).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("カンマなし整数 (YenAmountInput の hidden 送信値) がそのまま数値として保存される", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid({ status: "受注", estimate_amount: "100000", order_amount: "250000" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ estimate_amount: 100000, order_amount: 250000 }));
  });

  it("空欄の estimate_amount は現行仕様どおり 0 として保存される", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid({ estimate_amount: "" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ estimate_amount: 0 }));
  });

  it("0 入力は 0 として保存される", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid({ estimate_amount: "0" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ estimate_amount: 0 }));
  });
});

describe("cache invalidation (read-your-own-writes) (#172)", () => {
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

  it("create 成功時、閲覧系タグは updateTag (即時)、集計系タグは revalidateTag (SWR) で失効する", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    await createDealAction("store-1", null, valid());
    const updated = mocks.updateTag.mock.calls.map((c) => c[0]);
    expect(updated).toEqual(expect.arrayContaining(["deals", "deal:deal-new", "deals:store:store-1", "store:store-1", "stores"]));
    const revalidated = mocks.revalidate.mock.calls.map((c) => c[0]);
    expect(revalidated).toEqual(expect.arrayContaining(["stats", "kpi", "pipeline"]));
    // 店舗詳細/一覧の閲覧系タグを SWR (revalidateTag) 側へ落とさない
    expect(revalidated).not.toContain("deals:store:store-1");
    expect(revalidated).not.toContain("store:store-1");
  });

  it("update 成功時も同じタグ構成で失効する", async () => {
    mocks.update.mockResolvedValueOnce({ id: "deal-1" });
    await updateDealAction("deal-1", null, data({ activity_memo: "更新" }));
    const updated = mocks.updateTag.mock.calls.map((c) => c[0]);
    expect(updated).toEqual(expect.arrayContaining(["deals", "deal:deal-1", "deals:store:store-1", "store:store-1", "stores"]));
  });

  it("バリデーション失敗時はどのタグも失効しない", async () => {
    await createDealAction("store-1", null, valid({ estimate_amount: "-1" }));
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("deleteSalesActivityAction (#172)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getProfile.mockResolvedValue(profile);
    mocks.getDeal.mockResolvedValue(current);
    mocks.dealDelete.mockResolvedValue(undefined);
  });

  it("ログイン済みユーザー (admin でなくても) が削除できる", async () => {
    // profile.role は "member" (admin ではない)
    const result = await deleteSalesActivityAction("deal-1");
    expect(result).toEqual({ ok: true, data: undefined, message: "営業記録を削除しました" });
    expect(mocks.dealDelete).toHaveBeenCalledTimes(1);
    expect(mocks.dealDelete).toHaveBeenCalledWith("deal-1");
  });

  it("未ログインは拒否し、repository もキャッシュ失効も呼ばない", async () => {
    mocks.getProfile.mockResolvedValueOnce(null);
    const result = await deleteSalesActivityAction("deal-1");
    expect(result).toEqual({ ok: false, error: "ログインが必要です" });
    expect(mocks.getDeal).not.toHaveBeenCalled();
    expect(mocks.dealDelete).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("空の dealId は repository を呼ばず拒否する", async () => {
    const result = await deleteSalesActivityAction("");
    expect(result.ok).toBe(false);
    expect(mocks.dealDelete).not.toHaveBeenCalled();
  });

  it("存在しない Deal は失敗を返し、削除もキャッシュ失効もしない", async () => {
    mocks.getDeal.mockResolvedValueOnce(null);
    const result = await deleteSalesActivityAction("missing");
    expect(result).toEqual({ ok: false, error: "営業記録が見つかりませんでした" });
    expect(mocks.dealDelete).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("成功時は対象 Deal と店舗スコープのタグを即時失効する (storeId の取り違えなし)", async () => {
    await deleteSalesActivityAction("deal-1");
    const updated = mocks.updateTag.mock.calls.map((c) => c[0]);
    expect(updated).toEqual(expect.arrayContaining(["deals", "deal:deal-1", "deals:store:store-1", "store:store-1", "stores"]));
  });

  it("repository 例外は利用者向けメッセージへ変換し、内部情報とキャッシュ失効を漏らさない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.dealDelete.mockRejectedValueOnce(new Error("password=secret relation deals"));
    const result = await deleteSalesActivityAction("deal-1");
    expect(result).toEqual({ ok: false, error: "営業記録の削除に失敗しました" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.updateTag).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("成功時に監査ログへ実行者・dealId・storeId を記録する", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await deleteSalesActivityAction("deal-1");
    expect(spy).toHaveBeenCalledWith("[audit] sales-activity.delete", { by: "a@example.com", dealId: "deal-1", storeId: "store-1" });
    spy.mockRestore();
  });

  it("redirect しない (画面内で toast + 即時反映するため ActionResult を返す)", async () => {
    await deleteSalesActivityAction("deal-1");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
