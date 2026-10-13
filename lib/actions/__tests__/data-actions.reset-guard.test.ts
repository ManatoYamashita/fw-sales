/**
 * シードリセット / 全削除の環境ガード (#298)。
 *
 * 本番の管理者 (8 人中 6 人) が設定画面から 2 クリックで本番の全店舗・商談・引き継ぎを
 * 消せたため、admin 判定に加えて「`ALLOW_DATA_RESET=1` を立てた本番以外の環境」でだけ
 * 実行できるようにした。ここでは **拒否された時に DB へ一切触れない** ことを固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockRequireAdmin, mockTransaction, mockDelete, mockInsert } =
  vi.hoisted(() => {
    const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const mockInsert = vi.fn(() => ({
      values: () => ({ onConflictDoUpdate: mockOnConflictDoUpdate }),
    }));
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockTransaction = vi.fn(
      async (fn: (tx: unknown) => Promise<void>) =>
        fn({ insert: mockInsert, delete: mockDelete }),
    );
    return {
      mockRequireAdmin: vi.fn(),
      mockTransaction,
      mockDelete,
      mockInsert,
    };
  });

vi.mock("../_authz", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
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

const { resetToSeedAction, clearAllAction } = await import("../data-actions");
const { isDataResetAllowed, DATA_RESET_DENIED_MESSAGE } = await import(
  "@/lib/data-reset-policy"
);

const ACTIONS = [
  ["resetToSeedAction", resetToSeedAction],
  ["clearAllAction", clearAllAction],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockRequireAdmin.mockResolvedValue({
    ok: true,
    profile: { id: "u1", email: "admin@example.test", role: "admin" },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isDataResetAllowed", () => {
  it.each([
    [{}, false],
    [{ ALLOW_DATA_RESET: "1" }, true],
    [{ ALLOW_DATA_RESET: "true" }, false],
    [{ ALLOW_DATA_RESET: "0" }, false],
    [{ VERCEL_ENV: "preview" }, false],
    [{ VERCEL_ENV: "preview", ALLOW_DATA_RESET: "1" }, true],
    [{ VERCEL_ENV: "production" }, false],
    // 本番ではフラグを立てても許可しない
    [{ VERCEL_ENV: "production", ALLOW_DATA_RESET: "1" }, false],
  ])("%j → %s", (env, expected) => {
    expect(isDataResetAllowed(env)).toBe(expected);
  });
});

describe.each(ACTIONS)("%s の環境ガード", (_name, action) => {
  it("本番 (VERCEL_ENV=production) ではフラグがあってもサーバ側で拒否し、DB に触れない", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_DATA_RESET", "1");

    const result = await action();

    expect(result).toEqual({ ok: false, error: DATA_RESET_DENIED_MESSAGE });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("フラグの無い環境 (本番 DB を指す next dev 等) でも拒否する", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALLOW_DATA_RESET", "");

    const result = await action();

    expect(result.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("フラグを立てた本番以外の環境では実行する", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALLOW_DATA_RESET", "1");

    const result = await action();

    expect(result.ok).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(3);
  });

  it("admin でなければ環境に関係なく admin ガードの結果を返す", async () => {
    vi.stubEnv("ALLOW_DATA_RESET", "1");
    const denied = { ok: false, error: "この操作には管理者権限が必要です" };
    mockRequireAdmin.mockResolvedValue({ ok: false, denied });

    expect(await action()).toBe(denied);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
