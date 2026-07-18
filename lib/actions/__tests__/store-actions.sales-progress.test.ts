/**
 * `updateSalesProgressAction` のユニットテスト (customer-sales-progress-management)。
 *
 * 目的:
 * - 空文字 → null 正規化 (= 日付 / メモのクリア) が repository patch に反映されること
 * - 不正な日付形式 / 実在しない日付 / 500 文字超のメモをサーバ側で拒否すること
 *   (拒否時は repository を呼ばない)
 * - 成功時に店舗系キャッシュタグ (stores / store:{id}) を revalidate すること
 * - 不存在店舗 (repository が null) は失敗を返すこと
 *
 * テスト方針は store-actions.delete-impact.test.ts と同様 (repos / next をモック)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockUpdate, mockRevalidateTag, mockRedirect } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockRedirect: vi.fn(),
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

const { updateSalesProgressAction } = await import("../store-actions");

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("updateSalesProgressAction", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockRevalidateTag.mockReset();
  });

  it("正常系: 有効な日付とメモで更新し、店舗系タグを revalidate する", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({
        appointment_acquired_date: "2026-07-10",
        next_action_date: "2026-07-20",
        next_action_note: "見積フォローの電話",
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
      next_action_date: "2026-07-20",
      next_action_note: "見積フォローの電話",
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
        next_action_date: "",
        next_action_note: "",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      appointment_acquired_date: null,
      next_action_date: null,
      next_action_note: null,
    });
  });

  it("未指定フィールドは patch に含めず、既存値を保持する", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ next_action_note: "電話する" }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      next_action_note: "電話する",
    });
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
      makeFormData({ next_action_note: "電話する" }),
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
      makeFormData({ next_action_date: "2026-02-30" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("次回アクション予定日");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("501 文字のメモは拒否し、500 文字は受理する", async () => {
    const tooLong = await updateSalesProgressAction(
      "store_1",
      makeFormData({ next_action_note: "あ".repeat(501) }),
    );
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toContain("500文字以内");
    expect(mockUpdate).not.toHaveBeenCalled();

    mockUpdate.mockResolvedValueOnce({ id: "store_1" });
    const justFits = await updateSalesProgressAction(
      "store_1",
      makeFormData({ next_action_note: "あ".repeat(500) }),
    );
    expect(justFits.ok).toBe(true);
  });

  it("不存在店舗 (repository が null) は失敗を返し、revalidate しない", async () => {
    mockUpdate.mockResolvedValueOnce(null);

    const result = await updateSalesProgressAction(
      "store_missing",
      makeFormData({ next_action_date: "2026-07-20" }),
    );

    expect(result).toEqual({ ok: false, error: "店舗が見つかりませんでした" });
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});
