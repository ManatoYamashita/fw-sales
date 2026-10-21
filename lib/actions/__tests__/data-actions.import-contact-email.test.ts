/**
 * `importJsonAction` の契約連絡先メール (#384)。
 *
 * - 列の追加前に書き出した JSON (店舗に `contact_email` のキーが無い) は、キーを省いたまま
 *   upsert へ渡す。`toDbRow` が列ごと省くため、保存済みのアドレスは変わらない
 *   (実 DB での確認は `lib/db/__tests__/store-contact-email-app.integration.test.ts`)
 * - キーがある店舗は、画面と同じ規則で検証・正規化する
 * - 1 件でも不正なら、トランザクションを始める前に断り、何も書かない
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const storeRows: Array<Record<string, unknown>> = [];
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn((table: { _name: string }) => ({
    values: (row: Record<string, unknown>) => {
      if (table._name === "stores") storeRows.push(row);
      return { onConflictDoUpdate };
    },
  }));
  return {
    storeRows,
    requireAdmin: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({ insert })),
    consoleError: vi.fn(),
  };
});

vi.mock("../_authz", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/db/schema", () => ({
  stores: { _name: "stores", id: "id" },
  deals: { _name: "deals", id: "id" },
  handoffs: { _name: "handoffs", id: "id" },
}));
vi.mock("@/lib/db/store-repository", () => ({
  toDbRow: (store: Record<string, unknown>) => store,
}));
vi.mock("@/lib/repositories", () => ({ repos: {} }));

const { importJsonAction } = await import("../data-actions");

function formDataWith(payload: unknown): FormData {
  const fd = new FormData();
  fd.set("file", new File([JSON.stringify(payload)], "snapshot.json", { type: "application/json" }));
  return fd;
}

beforeEach(() => {
  mocks.storeRows.length = 0;
  mocks.transaction.mockClear();
  mocks.requireAdmin.mockResolvedValue({
    ok: true,
    profile: { id: "u1", email: "admin@example.com", role: "admin" },
  });
  vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.consoleError.mockClear();
});

describe("importJsonAction の契約連絡先メール (#384)", () => {
  it("キーの無い旧 JSON の店舗は、キーを省いたまま upsert へ渡す", async () => {
    const result = await importJsonAction(null, formDataWith({ stores: [{ id: "store_001", name: "導楽" }] }));
    expect(result.ok).toBe(true);
    expect(mocks.storeRows).toHaveLength(1);
    expect(mocks.storeRows[0]).not.toHaveProperty("contact_email");
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
    expect(mocks.storeRows.map((row) => row.contact_email)).toEqual(["a@example.com", "", undefined]);
  });

  it("1 件でも不正なアドレスがあれば、何件目かを示して何も書かない", async () => {
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
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.storeRows).toEqual([]);
  });

  it("null や数値などの文字列でない値も断る", async () => {
    for (const contact_email of [null, 123, ["a@example.com"], { a: 1 }]) {
      const result = await importJsonAction(null, formDataWith({ stores: [{ id: "store_001", contact_email }] }));
      expect(result.ok).toBe(false);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
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
    expect(mocks.storeRows).toEqual(exported.stores);
  });

  it("admin でなければ、検証より前に断る", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, denied: { ok: false, error: "権限がありません" } });
    const result = await importJsonAction(null, formDataWith({ stores: [{ id: "store_001", contact_email: "wrong" }] }));
    expect(result).toEqual({ ok: false, error: "権限がありません" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
