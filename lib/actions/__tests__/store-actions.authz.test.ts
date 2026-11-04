/**
 * 店舗の更新系 Server Action を、ブラウザから直接呼ばれたものとして確かめる (#384 のレビュー)。
 *
 * Server Action は画面を経由せずに任意の引数で呼べる。そのため、ログインの確認と引数の検証を
 * action 自身が持つ。拒否したときは DB に何も書かない。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  getDeleteImpact: vi.fn(),
  findProfile: vi.fn(),
  getCurrentProfile: vi.fn(),
}));
vi.mock("@/lib/repositories", () => ({
  repos: {
    forTenant: () => ({
      store: { update: mocks.update, getDeleteImpact: mocks.getDeleteImpact },
      membership: { find: mocks.findProfile },
    }),
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getCurrentProfile }));

const { updateStorePatchAction, updateStoreStageAction, getStoreDeleteImpactAction } = await import(
  "../store-actions"
);

const PROFILE_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getCurrentProfile.mockResolvedValue({ id: PROFILE_ID });
  mocks.update.mockResolvedValue({ id: "store_1" });
  mocks.findProfile.mockImplementation(async (id: string) => (id === PROFILE_ID ? { id } : null));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("ログインしていない呼び出しは、どの action も DB に触れずに断る", () => {
  beforeEach(() => mocks.getCurrentProfile.mockResolvedValue(null));

  it("updateStorePatchAction", async () => {
    expect((await updateStorePatchAction("store_1", { genre: "x" })).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updateStoreStageAction", async () => {
    expect((await updateStoreStageAction("store_1", "調査済み")).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("getStoreDeleteImpactAction", async () => {
    expect((await getStoreDeleteImpactAction(["store_1"])).ok).toBe(false);
    expect(mocks.getDeleteImpact).not.toHaveBeenCalled();
  });
});

describe("updateStorePatchAction は許可した項目だけを保存する", () => {
  it("tenant_id・id・created_at などを含む patch は、ほかの項目も含めて保存しない", async () => {
    for (const extra of [
      { tenant_id: "00000000-0000-4000-8000-0000000000ff" },
      { id: "store_other" },
      { created_at: "2000-01-01" },
      { stage: "受注" },
      { basic_info: {} },
    ]) {
      const result = await updateStorePatchAction("store_1", { genre: "居酒屋", ...extra } as never);
      expect(result.ok).toBe(false);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("拒否した項目名だけを警告ログに残し、値は残さない", async () => {
    const warn = vi.mocked(console.warn);
    await updateStorePatchAction("store_1", { tenant_id: "secret-tenant-value" } as never);
    expect(warn).toHaveBeenCalledWith("[store.patch] rejected", { keys: ["tenant_id"] });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-tenant-value");
  });

  it("許可した項目は検証後の値で保存する", async () => {
    const result = await updateStorePatchAction("store_1", {
      genre: "居酒屋",
      assigned_planner_user_id: PROFILE_ID,
      assigned_sales_user_id: "",
      contact_email: " a@example.com ",
    } as never);
    expect(result.ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("store_1", {
      genre: "居酒屋",
      assigned_planner_user_id: PROFILE_ID,
      assigned_sales_user_id: null,
      contact_email: "a@example.com",
    });
  });

  it("存在しない担当者は保存しない", async () => {
    const result = await updateStorePatchAction("store_1", {
      assigned_sales_user_id: "00000000-0000-4000-8000-0000000000aa",
    });
    expect(result.ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("店舗 ID が文字列でなければ保存しない", async () => {
    for (const id of ["", "  ", null, 1, { id: "store_1" }]) {
      expect((await updateStorePatchAction(id as never, { genre: "x" })).ok).toBe(false);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("updateStoreStageAction は定義済みの段階だけを保存する", () => {
  it("定義外の段階や文字列でない値では保存しない", async () => {
    for (const stage of ["受注済み", "", null, 1, { stage: "調査済み" }]) {
      expect((await updateStoreStageAction("store_1", stage as never)).ok).toBe(false);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("定義済みの段階は保存する", async () => {
    expect((await updateStoreStageAction("store_1", "調査済み")).ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("store_1", { stage: "調査済み" });
  });
});
