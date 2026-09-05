/**
 * `getStoreDeleteImpactAction` のユニットテスト (#152 store-cascade-delete)。
 *
 * 目的:
 * - bulkDeleteStoresAction と同一の ID 正規化 (空・非文字列の除外 + 重複排除)
 * - 読み取り専用であること (revalidateTag を一切呼ばない)
 * - 失敗時は構造化ログ (SQLSTATE / constraint) と UI 向け汎用文言の二系統分離
 *   (内部スキーマ情報を UI 文言へ露出しない)
 *
 * テスト方針は store-actions.bulk-delete.test.ts と同様 (repos / next をモック)。
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

vi.mock("server-only", () => ({}));

const { mockGetDeleteImpact, mockRevalidateTag, mockRedirect } = vi.hoisted(() => ({
  mockGetDeleteImpact: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { getDeleteImpact: mockGetDeleteImpact },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

const { getStoreDeleteImpactAction } = await import("../store-actions");

describe("getStoreDeleteImpactAction", () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    mockGetDeleteImpact.mockReset();
    mockRevalidateTag.mockReset();
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("正常系: 正規化済み ID 群で影響件数を返し、キャッシュを一切 invalidate しない", async () => {
    const impact = {
      deals: 3,
      store_research_runs: 22,
      handoffs: 1,
      place_candidates: 4,
    };
    mockGetDeleteImpact.mockResolvedValueOnce(impact);

    const result = await getStoreDeleteImpactAction([
      "store_a",
      "store_a",
      "",
      "store_b",
    ]);

    expect(result).toEqual({ ok: true, data: impact });
    // 重複と空文字を除外した ID 群で 1 回だけ呼ばれる
    expect(mockGetDeleteImpact).toHaveBeenCalledTimes(1);
    expect(mockGetDeleteImpact).toHaveBeenCalledWith(["store_a", "store_b"]);
    // 読み取り系 action の契約: revalidateTag を呼ばない (Req 3.5)
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("空配列は repository を呼ばずに failure を返す", async () => {
    const result = await getStoreDeleteImpactAction([]);

    expect(result).toEqual({
      ok: false,
      error: "削除対象の店舗が指定されていません",
    });
    expect(mockGetDeleteImpact).not.toHaveBeenCalled();
  });

  it("空文字・空白のみの配列は除外後 0 件となり failure を返す", async () => {
    const result = await getStoreDeleteImpactAction(["", "   "]);

    expect(result.ok).toBe(false);
    expect(mockGetDeleteImpact).not.toHaveBeenCalled();
  });

  it("PG エラー時は構造化ログに診断情報を残し、UI へは内部情報を含まない汎用文言を返す", async () => {
    mockGetDeleteImpact.mockRejectedValueOnce({
      name: "PostgresError",
      code: "57014",
      message: "canceling statement due to statement timeout",
      constraint_name: "deals_store_id_stores_id_fk",
    });

    const result = await getStoreDeleteImpactAction(["store_a"]);

    expect(result).toEqual({
      ok: false,
      error: "紐づけデータの件数を取得できませんでした",
    });
    if (result.ok === false) {
      expect(result.error).not.toContain("deals_store_id_stores_id_fk");
    }
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.deleteImpact] failed",
      expect.objectContaining({
        requestedCount: 1,
        code: "57014",
        constraint: "deals_store_id_stores_id_fk",
      }),
    );
  });

  it("code を持たない一般 Error は raw shape dump も二段構えで発火する", async () => {
    mockGetDeleteImpact.mockRejectedValueOnce(new Error("network blew up"));

    const result = await getStoreDeleteImpactAction(["store_a"]);

    expect(result).toEqual({
      ok: false,
      error: "紐づけデータの件数を取得できませんでした",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.deleteImpact] failed",
      expect.objectContaining({ code: undefined, message: "network blew up" }),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[stores.deleteImpact] unrecognized error shape",
      expect.objectContaining({ name: "Error", raw_message: "network blew up" }),
    );
  });
});
