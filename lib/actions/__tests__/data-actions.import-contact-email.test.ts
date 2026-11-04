/**
 * `importJsonAction` の契約連絡先メール (#384)。#395 のテナント単位の data repository を通す。
 *
 * - 列の追加前に書き出した JSON (店舗に `contact_email` のキーが無い) は、キーを省いたまま
 *   `repos.forTenant(tenantId).data.importSnapshot` へ渡す。`toDbRow` も `rowFor` も列ごと省くため、
 *   保存済みのアドレスは変わらない (実 DB での確認は
 *   `lib/db/__tests__/store-contact-email-import.integration.test.ts`)
 * - キーがある店舗は、画面と同じ規則で検証・正規化する
 * - 1 件でも不正なら、repository を呼ぶ前 (トランザクションの開始前) に断り、何も書かない
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  importSnapshot: vi.fn(),
  forTenant: vi.fn(),
  tag: vi.fn(),
}));

vi.mock("../_authz", () => ({ requireAdmin: mocks.admin, requireSignedIn: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.tag }));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: async () => "tenant-a" }));
vi.mock("@/lib/repositories", () => ({ repos: { forTenant: mocks.forTenant } }));

const { importJsonAction } = await import("../data-actions");

function formDataWith(payload: unknown): FormData {
  const fd = new FormData();
  fd.set("file", new File([JSON.stringify(payload)], "snapshot.json", { type: "application/json" }));
  return fd;
}

function importedStores(): Array<Record<string, unknown>> {
  expect(mocks.importSnapshot).toHaveBeenCalledTimes(1);
  return mocks.importSnapshot.mock.calls[0]![0].stores;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ ok: true, profile: { id: "u1", email: "admin@example.com", role: "admin" } });
  mocks.forTenant.mockImplementation((id: string) => {
    expect(id).toBe("tenant-a");
    return { data: { importSnapshot: mocks.importSnapshot } };
  });
  mocks.importSnapshot.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("importJsonAction の契約連絡先メール (#384)", () => {
  it("キーの無い旧 JSON の店舗は、キーを省いたまま束縛済みの入口へ渡す", async () => {
    const result = await importJsonAction(null, formDataWith({ stores: [{ id: "store_001", name: "導楽" }] }));
    expect(result.ok).toBe(true);
    const [row] = importedStores();
    expect(row).not.toHaveProperty("contact_email");
  });

  it("キーがある店舗は前後の空白を除き、空文字はそのまま (アドレスを消す) 渡す", async () => {
    const result = await importJsonAction(null, formDataWith({
      stores: [
        { id: "store_001", contact_email: "  a@example.com " },
        { id: "store_002", contact_email: "" },
        { id: "store_003" },
      ],
    }));
    expect(result.ok).toBe(true);
    const rows = importedStores();
    expect(rows.map((row) => row.contact_email)).toEqual(["a@example.com", "", undefined]);
    expect(rows[2]).not.toHaveProperty("contact_email");
  });

  it("1 件でも不正なアドレスがあれば、何件目かを示し、repository を呼ばない", async () => {
    const result = await importJsonAction(null, formDataWith({
      stores: [
        { id: "store_001", contact_email: "a@example.com" },
        { id: "store_002", contact_email: "leak-check@@example.com" },
      ],
      deals: [{ id: "deal_001", store_id: "store_001" }],
    }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain("2件目");
      expect(result.error).not.toContain("leak-check");
    }
    expect(mocks.forTenant).not.toHaveBeenCalled();
    expect(mocks.importSnapshot).not.toHaveBeenCalled();
    expect(mocks.tag).not.toHaveBeenCalled();
  });

  it("null や数値などの文字列でない値も断る", async () => {
    for (const contact_email of [null, 123, ["a@example.com"], { a: 1 }]) {
      const result = await importJsonAction(null, formDataWith({ stores: [{ id: "store_001", contact_email }] }));
      expect(result.ok).toBe(false);
    }
    expect(mocks.importSnapshot).not.toHaveBeenCalled();
  });

  it("書き出した JSON (アドレス入り) をそのまま戻せる", async () => {
    const exported = {
      stores: [
        { id: "store_001", name: "導楽", contact_email: "contract@example.com" },
        { id: "store_002", name: "炉端ジュン", contact_email: "" },
      ],
    };
    const result = await importJsonAction(null, formDataWith(exported));
    expect(result.ok).toBe(true);
    expect(importedStores()).toEqual(exported.stores);
  });

  it("admin でなければ、検証より前に断り、repository を呼ばない", async () => {
    mocks.admin.mockResolvedValue({ ok: false, denied: { ok: false, error: "権限がありません" } });
    const result = await importJsonAction(null, formDataWith({ stores: [{ id: "store_001", contact_email: "wrong" }] }));
    expect(result).toEqual({ ok: false, error: "権限がありません" });
    expect(mocks.forTenant).not.toHaveBeenCalled();
  });
});
