/**
 * `updateSalesProgressAction` のユニットテスト (customer-sales-progress-management)。
 *
 * 目的:
 * - 空文字 → null 正規化 (= 日付 / メモのクリア) が repository patch に反映されること
 * - 不正な日付形式 / 実在しない日付 / 5000 文字超のメモをサーバ側で拒否すること
 *   (拒否時は repository を呼ばない)
 * - 成功時に店舗系キャッシュタグ (stores / store:{id}) を revalidate すること
 * - 不存在店舗 (repository が null) は失敗を返すこと
 * - 未ログインは拒否すること (Low A)
 * - `next_action_date` / `next_action_note` (stores の legacy 列) は本 Action の
 *   書き込み対象ではなく、FormData に含まれていても無視されること (#161 follow-up:
 *   Deal (migration 0024) を次回アクションの単一の書き込み先とし、Store 側は
 *   read-only fallback として残す)
 *
 * テスト方針は store-actions.delete-impact.test.ts と同様 (repos / next をモック)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockUpdate, mockRevalidateTag, mockRedirect, mockGetCurrentProfile } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockRedirect: vi.fn(),
  mockGetCurrentProfile: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { update: mockUpdate },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: mockGetCurrentProfile,
}));

const { updateSalesProgressAction } = await import("../store-actions");
const profile = { id: "user-1", display_name: "担当", email: "a@example.com", role: "member" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("updateSalesProgressAction", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockRevalidateTag.mockReset();
    mockGetCurrentProfile.mockReset();
    mockGetCurrentProfile.mockResolvedValue(profile);
  });

  it("未ログイン時は更新を拒否し、repository を呼ばない (Low A: deal-actions と同じ認証方針)", async () => {
    mockGetCurrentProfile.mockResolvedValueOnce(null);
    const result = await updateSalesProgressAction("store_1", makeFormData({ memo: "更新" }));
    expect(result).toEqual({ ok: false, error: "ログインが必要です" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("正常系: 有効な日付とメモで更新し、店舗系タグを revalidate する", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({
        appointment_acquired_date: "2026-07-10",
        memo: "平日15時以降に連絡",
      }),
    );

    expect(result).toEqual({
      ok: true,
      data: undefined,
      message: "営業進捗を更新しました",
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      appointment_acquired_date: "2026-07-10",
      memo: "平日15時以降に連絡",
    });
    const revalidated = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(revalidated).toContain("stores");
    expect(revalidated).toContain("store:store_1");
  });

  it("空文字は null に正規化される (= フィールドのクリア)", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({
        appointment_acquired_date: "",
        memo: "",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      appointment_acquired_date: null,
      memo: "",
    });
  });

  it("未指定フィールドは patch に含めず、既存値を保持する", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ memo: "電話する" }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      memo: "電話する",
    });
  });

  it("next_action_date / next_action_note は FormData に含まれていても無視する (Store legacy列は read-only)", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({
        memo: "継続メモ",
        next_action_date: "2026-08-01",
        next_action_note: "この値は書き込まれないはず",
      }),
    );

    expect(result.ok).toBe(true);
    // patch に next_action_date / next_action_note が含まれないことを保証する
    // (Deal (migration 0024) が次回アクションの単一の書き込み先)
    expect(mockUpdate).toHaveBeenCalledWith("store_1", { memo: "継続メモ" });
  });

  it("営業メモは保存・空文字クリアでき、未送信時は触らない", async () => {
    mockUpdate.mockResolvedValue({ id: "store_1" });
    await updateSalesProgressAction("store_1", makeFormData({ memo: "継続メモ" }));
    expect(mockUpdate).toHaveBeenLastCalledWith("store_1", { memo: "継続メモ" });
    await updateSalesProgressAction("store_1", makeFormData({ memo: "" }));
    expect(mockUpdate).toHaveBeenLastCalledWith("store_1", { memo: "" });
  });

  it("営業メモは5000文字を許可し、5001文字を拒否する", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });
    expect((await updateSalesProgressAction("store_1", makeFormData({ memo: "あ".repeat(5000) }))).ok).toBe(true);
    const result = await updateSalesProgressAction("store_1", makeFormData({ memo: "あ".repeat(5001) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("5000文字以内");
  });

  it("空の店舗 ID は repository を呼ばず拒否する", async () => {
    const result = await updateSalesProgressAction("", new FormData());
    expect(result).toEqual({ ok: false, error: "店舗が指定されていません" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("DB 内部エラーを利用者向け結果へ露出しない", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockUpdate.mockRejectedValueOnce(new Error("password=secret relation stores"));

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ memo: "電話する" }),
    );

    expect(result).toEqual({ ok: false, error: "営業進捗の更新に失敗しました" });
    expect(JSON.stringify(result)).not.toContain("password=secret");
    errorSpy.mockRestore();
  });

  it("不正な日付形式 (YYYY/MM/DD) は拒否し、repository を呼ばない", async () => {
    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ appointment_acquired_date: "2026/07/10" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("アポ取得日");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("実在しない日付 (2026-02-30) は拒否する", async () => {
    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ appointment_acquired_date: "2026-02-30" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("アポ取得日");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("不存在店舗 (repository が null) は失敗を返し、revalidate しない", async () => {
    mockUpdate.mockResolvedValueOnce(null);

    const result = await updateSalesProgressAction(
      "store_missing",
      makeFormData({ appointment_acquired_date: "2026-07-20" }),
    );

    expect(result).toEqual({ ok: false, error: "店舗が見つかりませんでした" });
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});
