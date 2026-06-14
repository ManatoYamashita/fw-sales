/**
 * `bulkDeleteStoresAction` のエラーハンドリングテスト。
 *
 * 目的:
 * - PostgresError の SQLSTATE に応じて UI 文言が分岐すること
 * - 非 PostgresError は fallback 文言で `failure()` が返ること
 * - `console.error` が SQLSTATE 等を含む構造化情報で呼ばれること
 * - 入力バリデーション (空配列) で repos.bulkDelete を呼ばないこと
 *
 * 注: 成功パスは redirect / revalidateTag の副作用が広く、対象外。
 *      本ファイルでは失敗ハンドリングのみを境界として扱う。
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { mockBulkDelete, mockRevalidateTag, mockRedirect } = vi.hoisted(() => ({
  mockBulkDelete: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { bulkDelete: mockBulkDelete },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

const { bulkDeleteStoresAction } = await import("../store-actions");

function makePgError(
  code: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "PostgresError",
    code,
    message: `simulated ${code}`,
    ...extra,
  };
}

describe("bulkDeleteStoresAction エラーハンドリング", () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    mockBulkDelete.mockReset();
    mockRevalidateTag.mockReset();
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("statement_timeout (57014) を日本語フレンドリーメッセージに整形する", async () => {
    mockBulkDelete.mockRejectedValueOnce(makePgError("57014"));

    const result = await bulkDeleteStoresAction(["store_a", "store_b"]);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/タイムアウト/);
    }
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.bulkDelete] failed",
      expect.objectContaining({
        requestedCount: 2,
        sample: ["store_a", "store_b"],
        code: "57014",
      }),
    );
  });

  it("FK 違反 (23503) は UI 文言から制約名を抜き、構造化ログには残す (容疑 A 対応)", async () => {
    mockBulkDelete.mockRejectedValueOnce(
      makePgError("23503", {
        constraint_name: "deals_store_id_stores_id_fk",
        table_name: "deals",
      }),
    );

    const result = await bulkDeleteStoresAction(["store_a"]);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      // UI 文言には内部スキーマ情報 (制約名) を露出しない
      expect(result.error).not.toContain("deals_store_id_stores_id_fk");
      expect(result.error).toMatch(/関連レコード/);
    }
    // 構造化ログには constraint 名を残し、運用者がログから即座に原因特定できる
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.bulkDelete] failed",
      expect.objectContaining({
        code: "23503",
        constraint: "deals_store_id_stores_id_fk",
        table: "deals",
      }),
    );
  });

  it("code を持たない一般 Error は fallback 文言で failure を返し、raw shape dump も発火", async () => {
    mockBulkDelete.mockRejectedValueOnce(new Error("network blew up"));

    const result = await bulkDeleteStoresAction(["store_a"]);

    expect(result).toEqual({ ok: false, error: "店舗の削除に失敗しました" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.bulkDelete] failed",
      expect.objectContaining({
        requestedCount: 1,
        code: undefined,
        message: "network blew up",
      }),
    );
    // 2 段検出でも拾えない (code を持たない) 場合、raw err 構造の dump が二段構えで
    // 発火し、Vercel logs から真因を即特定できる
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.bulkDelete] unrecognized error shape",
      expect.objectContaining({
        name: "Error",
        raw_message: "network blew up",
      }),
    );
  });

  it("generic error (UNSAFE_TRANSACTION) は 2 段検出で UI 文言 [code] ... へ整形される", async () => {
    // postgres-js の generic(code, message) を再現: name は未設定 ("Error")、code 持ち。
    // PR #144 の executor.transaction が Supabase Pooler で投げる本番症状の仮説再現。
    const generic = Object.assign(
      new Error("UNSAFE_TRANSACTION: SET LOCAL is not safe ..."),
      { code: "UNSAFE_TRANSACTION" },
    );
    mockBulkDelete.mockRejectedValueOnce(generic);

    const result = await bulkDeleteStoresAction(["store_a"]);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toContain("[UNSAFE_TRANSACTION]");
    }
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.bulkDelete] failed",
      expect.objectContaining({ code: "UNSAFE_TRANSACTION" }),
    );
    // parsed が non-null になったので raw shape dump は呼ばれない
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      "[stores.bulkDelete] unrecognized error shape",
      expect.anything(),
    );
  });

  it("Drizzle wrapper の `cause` 経由で受けた PostgresError も解析できる", async () => {
    const inner = makePgError("57014");
    const wrapped: Error & { cause?: unknown } = Object.assign(
      new Error("Failed query: delete from stores where ..."),
      { cause: inner },
    );
    mockBulkDelete.mockRejectedValueOnce(wrapped);

    const result = await bulkDeleteStoresAction(["store_a"]);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/タイムアウト/);
    }
  });

  it("空配列は repos.bulkDelete を呼ばずに failure を返す", async () => {
    const result = await bulkDeleteStoresAction([]);

    expect(result).toEqual({
      ok: false,
      error: "削除対象の店舗が指定されていません",
    });
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  it("空文字 / 非文字列を含む配列は除外後の件数で再判定し、全部空なら failure", async () => {
    const result = await bulkDeleteStoresAction(["", "   "]);
    expect(result.ok).toBe(false);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });
});
