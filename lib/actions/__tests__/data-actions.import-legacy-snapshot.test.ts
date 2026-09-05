/**
 * `importJsonAction` の後方互換ガード (Issue #110)。
 *
 * `/api/export` の JSON は Issue #110 で 4 entity
 * (`stores` / `research` / `deals` / `handoffs`) から 3 entity へ縮んだ。
 * 過去に取得したバックアップ JSON には `research` キーが残っているため、
 * それを投入しても **エラーにならず、stores / deals / handoffs だけが
 * 取り込まれる** ことを固定する。
 *
 * 実装上は「トップレベルキーを個別に取り出す」構造がそのまま後方互換に
 * なっているが、将来 zod 等のスキーマ検証を足したときに旧 JSON を弾いて
 * しまう退行を、このテストで検知する。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockRequireAdmin,
  mockRevalidateTag,
  mockTransaction,
  mockInsert,
  mockValues,
  mockOnConflictDoUpdate,
  insertedTables,
} = vi.hoisted(() => {
  const insertedTables: string[] = [];
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn((table: { _name: string }) => {
    insertedTables.push(table._name);
    return { values: mockValues };
  });
  const mockDelete = vi.fn().mockResolvedValue(undefined);
  const mockTransaction = vi.fn(
    async (fn: (tx: unknown) => Promise<void>) =>
      fn({ insert: mockInsert, delete: mockDelete }),
  );
  return {
    mockRequireAdmin: vi.fn(),
    mockRevalidateTag: vi.fn(),
    mockTransaction,
    mockInsert,
    mockValues,
    mockOnConflictDoUpdate,
    insertedTables,
  };
});

vi.mock("../_authz", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));
vi.mock("@/lib/db/client", () => ({ db: { transaction: mockTransaction } }));
vi.mock("@/lib/db/schema", () => ({
  stores: { _name: "stores", id: "id" },
  deals: { _name: "deals", id: "id" },
  handoffs: { _name: "handoffs", id: "id" },
}));
vi.mock("@/lib/db/store-repository", () => ({
  toDbRow: (store: Record<string, unknown>) => store,
}));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { list: vi.fn() },
    deal: { list: vi.fn() },
    handoff: { list: vi.fn() },
  },
}));

const { importJsonAction } = await import("../data-actions");

/** 旧形式 (4 entity) のエクスポート JSON。`research` キーを含む。 */
const LEGACY_SNAPSHOT = {
  stores: [{ id: "store_001", name: "導楽" }],
  research: [{ id: "res_001", store_id: "store_001", store_name: "導楽" }],
  deals: [{ id: "deal_001", store_id: "store_001" }],
  handoffs: [{ id: "handoff_001", store_id: "store_001" }],
};

function formDataWith(payload: unknown): FormData {
  const fd = new FormData();
  fd.set(
    "file",
    new File([JSON.stringify(payload)], "snapshot.json", {
      type: "application/json",
    }),
  );
  return fd;
}

describe("importJsonAction — 旧 4 entity スナップショットの後方互換", () => {
  beforeEach(() => {
    insertedTables.length = 0;
    mockInsert.mockClear();
    mockValues.mockClear();
    mockOnConflictDoUpdate.mockClear();
    mockTransaction.mockClear();
    mockRevalidateTag.mockClear();
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      profile: { id: "u1", email: "admin@example.com", role: "admin" },
    });
  });

  it("`research` キーを含む旧 JSON をエラーなく受理する", async () => {
    const result = await importJsonAction(null, formDataWith(LEGACY_SNAPSHOT));
    expect(result.ok).toBe(true);
  });

  it("旧 JSON の `research` 行は取り込まない (stores / deals / handoffs のみ)", async () => {
    await importJsonAction(null, formDataWith(LEGACY_SNAPSHOT));
    expect(insertedTables).toEqual(["stores", "deals", "handoffs"]);
    expect(insertedTables).not.toContain("research");
  });

  it("`research` キーしか持たない JSON は書き込みを一切行わない", async () => {
    const result = await importJsonAction(
      null,
      formDataWith({ research: LEGACY_SNAPSHOT.research }),
    );
    expect(result.ok).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("現行 3 entity の JSON は従来どおり全件取り込む", async () => {
    const current = {
      stores: LEGACY_SNAPSHOT.stores,
      deals: LEGACY_SNAPSHOT.deals,
      handoffs: LEGACY_SNAPSHOT.handoffs,
    };
    await importJsonAction(null, formDataWith(current));
    expect(insertedTables).toEqual(["stores", "deals", "handoffs"]);
  });
});
