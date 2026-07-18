import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(), getStore: vi.fn(), getDeal: vi.fn(), create: vi.fn(), update: vi.fn(), findProfile: vi.fn(), revalidate: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getProfile }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/repositories", () => ({ repos: { store: { get: mocks.getStore }, deal: { get: mocks.getDeal, create: mocks.create, update: mocks.update, delete: vi.fn() }, profile: { findById: mocks.findProfile } } }));

const { createDealAction, updateDealAction } = await import("../deal-actions");
const profile = { id: "user-1", display_name: "担当", email: "a@example.com", role: "member" };
const store = { id: "store-1", name: "店舗", assigned_sales_user_id: null };
const current = { id: "deal-1", store_id: "store-1" };
function data(values: Record<string, string>) { const fd = new FormData(); for (const [k, v] of Object.entries(values)) fd.set(k, v); return fd; }
function valid(overrides: Record<string, string> = {}) { return data({ date: "2026-07-18", meeting_type: "DM", status: "初回接触", assigned_sales_user_id: "", activity_memo: "見積書を送付", proposal: "提案", discussion: "確認内容", estimate_amount: "1000", order_amount: "", lost_reason: "", next_action_date: "2026-07-20", next_action_type: "電話", next_action_note: "回答確認", ...overrides }); }

describe("営業記録Action", () => {
  beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.getProfile.mockResolvedValue(profile); mocks.getStore.mockResolvedValue(store); mocks.getDeal.mockResolvedValue(current); mocks.findProfile.mockResolvedValue(profile); });

  it("全項目を持つ営業記録を新規作成する", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    const result = await createDealAction("store-1", null, valid());
    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ meeting_type: "DM", status: "初回接触", activity_memo: "見積書を送付", next_action_date: "2026-07-20", next_action_type: "電話", next_action_note: "回答確認" }));
  });

  it("全活動種別と全営業状態を受理する", async () => {
    mocks.create.mockImplementation(async (input) => ({ ...input, id: "deal-new" }));
    for (const meeting_type of ["対面", "オンライン", "電話", "DM", "メール", "訪問", "社内メモ", "その他"]) {
      expect((await createDealAction("store-1", null, valid({ meeting_type }))).ok).toBe(true);
    }
    for (const status of ["初回接触", "アポ取得", "継続追客", "見積提出", "受注", "失注"]) {
      expect((await createDealAction("store-1", null, valid({ status }))).ok).toBe(true);
    }
  });

  it("不正な列挙値・実在しない日付・負数・上限超過を拒否する", async () => {
    for (const fd of [valid({ meeting_type: "FAX" }), valid({ status: "完了" }), valid({ next_action_type: "会議" }), valid({ date: "2026-02-30" }), valid({ estimate_amount: "-1" }), valid({ activity_memo: "あ".repeat(5001) }), valid({ next_action_note: "あ".repeat(501) })]) {
      expect((await createDealAction("store-1", null, fd)).ok).toBe(false);
    }
    expect(mocks.create).not.toHaveBeenCalled();
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
});
