/**
 * 店舗の作成・更新の Server Action で、契約連絡先メール (#384) をどう扱うか。
 *
 * - 作成・全体編集・部分更新のどの経路でも、同じ規則 (`normalizeContactEmail`) で検証する
 * - キーが無い入力 (アドレス欄を持たない旧画面・ほかのカード) では、保存済みのアドレスを変えない
 * - 空文字を明示して送ったときだけ、アドレスを消す
 * - 不正な値やログインしていない呼び出しでは、DB に何も書かない
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_TAGS } from "@/lib/cache";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findProfile: vi.fn(),
  getCurrentProfile: vi.fn(),
  redirect: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { create: mocks.create, update: mocks.update },
    profile: { findById: mocks.findProfile },
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), updateTag: mocks.updateTag }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getCurrentProfile }));

const {
  createStoreAction,
  createStoreAndRedirect,
  updateStoreAction,
  updateStorePatchAction,
} = await import("../store-actions");

const SIGNED_IN = { id: "00000000-0000-4000-8000-000000000001", email: "staff@example.test", role: "member" };

function storeForm(fields: Record<string, string>): FormData {
  const formData = new FormData();
  formData.set("name", "導楽");
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

/** 最後の `repos.store.update` に渡した patch。 */
function lastUpdatePatch(): Record<string, unknown> {
  return mocks.update.mock.calls.at(-1)![1] as Record<string, unknown>;
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getCurrentProfile.mockResolvedValue(SIGNED_IN);
  mocks.create.mockImplementation(async (input: Record<string, unknown>) => ({ ...input, id: "store_new" }));
  mocks.update.mockResolvedValue({ id: "store_1", name: "導楽" });
});

describe("createStoreAction", () => {
  it("前後の空白を除いたアドレスで作成する", async () => {
    const result = await createStoreAction(null, storeForm({ contact_email: "  contract@example.com " }));
    expect(result.ok).toBe(true);
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ contact_email: "contract@example.com" });
  });

  it("空欄と、欄が無いフォームは未登録 (空文字) で作成する", async () => {
    await createStoreAction(null, storeForm({ contact_email: "" }));
    await createStoreAction(null, storeForm({}));
    expect(mocks.create.mock.calls.map(([input]) => input.contact_email)).toEqual(["", ""]);
  });

  it("不正なアドレスでは作成しない", async () => {
    const result = await createStoreAction(null, storeForm({ contact_email: "contract@@example.com" }));
    expect(result.ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ファイルなど文字列でない値では作成しない", async () => {
    const formData = storeForm({});
    formData.set("contact_email", new Blob(["a@example.com"]), "x.txt");
    expect((await createStoreAction(null, formData)).ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ログインしていなければ作成しない", async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const result = await createStoreAction(null, storeForm({ contact_email: "a@example.com" }));
    expect(result).toMatchObject({ ok: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("createStoreAndRedirect", () => {
  it("不正なアドレスとログインしていない呼び出しでは作成しない", async () => {
    await expect(createStoreAndRedirect(storeForm({ contact_email: "wrong" }))).rejects.toThrow();
    mocks.getCurrentProfile.mockResolvedValue(null);
    await expect(createStoreAndRedirect(storeForm({ contact_email: "a@example.com" }))).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("updateStoreAction (店舗全体の編集)", () => {
  it("アドレスの欄が無いフォーム (旧画面・未変更) では、アドレスを変更しない", async () => {
    const result = await updateStoreAction("store_1", null, storeForm({ memo: "メモ" }));
    expect(result.ok).toBe(true);
    expect(lastUpdatePatch()).not.toHaveProperty("contact_email");
    expect(lastUpdatePatch()).toMatchObject({ memo: "メモ" });
  });

  it("保存後に移る店舗詳細が新しい値を表示するよう、店舗のキャッシュを即時に失効する", async () => {
    await updateStoreAction("store_1", null, storeForm({ contact_email: "new@example.com" }));
    expect(mocks.updateTag).toHaveBeenCalledWith(CACHE_TAGS.store("store_1"));
    expect(mocks.updateTag).toHaveBeenCalledWith(CACHE_TAGS.stores);
  });

  it("空文字を送ったときだけ、アドレスを消す", async () => {
    await updateStoreAction("store_1", null, storeForm({ contact_email: "  " }));
    expect(lastUpdatePatch()).toMatchObject({ contact_email: "" });
  });

  it("前後の空白を除いて保存する", async () => {
    await updateStoreAction("store_1", null, storeForm({ contact_email: " new@example.com " }));
    expect(lastUpdatePatch()).toMatchObject({ contact_email: "new@example.com" });
  });

  it("不正なアドレスでは、ほかの項目も含めて何も保存しない", async () => {
    const result = await updateStoreAction("store_1", null, storeForm({ contact_email: "a@example.com?cc=x", memo: "x" }));
    expect(result.ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("ログインしていなければ保存しない", async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    expect((await updateStoreAction("store_1", null, storeForm({ contact_email: "" }))).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("updateStorePatchAction (店舗詳細の部分更新)", () => {
  it("キーの無い patch (地図・Web 資産・旧画面の基本情報) では、アドレスを変更しない", async () => {
    await updateStorePatchAction("store_1", { genre: "居酒屋" });
    expect(lastUpdatePatch()).toEqual({ genre: "居酒屋" });
  });

  it("値が undefined のキーも、変更しないものとして扱う", async () => {
    // undefined のまま repository へ渡り、toDbPatch が SET から外す (結合テストで確かめる)。
    const result = await updateStorePatchAction("store_1", { genre: "居酒屋", contact_email: undefined });
    expect(result.ok).toBe(true);
    expect(lastUpdatePatch().contact_email).toBeUndefined();
  });

  it("空文字でアドレスを消し、前後の空白を除いて保存する", async () => {
    await updateStorePatchAction("store_1", { contact_email: "" });
    expect(lastUpdatePatch()).toEqual({ contact_email: "" });
    await updateStorePatchAction("store_1", { contact_email: "　a@example.com " });
    expect(lastUpdatePatch()).toEqual({ contact_email: "a@example.com" });
  });

  it("不正な値 (形式違い・null・文字列以外) では何も保存しない", async () => {
    for (const contact_email of ["wrong", null, 123, { toString: () => "a@example.com" }]) {
      const result = await updateStorePatchAction("store_1", { contact_email } as never);
      expect(result.ok).toBe(false);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("基本情報カードが送る担当者の空文字 (未割当) は null にして保存する", async () => {
    await updateStorePatchAction("store_1", {
      contact_email: "a@example.com",
      assigned_planner_user_id: "",
      assigned_sales_user_id: "",
    } as never);
    expect(lastUpdatePatch()).toMatchObject({
      contact_email: "a@example.com",
      assigned_planner_user_id: null,
      assigned_sales_user_id: null,
    });
  });

  it("ログインしていなければ保存しない", async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    expect((await updateStorePatchAction("store_1", { contact_email: "a@example.com" })).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
