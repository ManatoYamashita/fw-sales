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

const { mockUpdate, mockRevalidateTag, mockUpdateTag, mockRedirect, mockGetCurrentProfile, mockFindProfileById } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockRedirect: vi.fn(),
  mockGetCurrentProfile: vi.fn(),
  mockFindProfileById: vi.fn(),
}));

// repos に deal を生やさない。本 Action が deals へ触れたら TypeError で落ちるため、
// 「Deal.assigned_sales_user_id を変更しない」ことの機械的な担保にもなる。
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { update: mockUpdate },
    profile: { findById: mockFindProfileById },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: mockGetCurrentProfile,
}));

const { updateSalesProgressAction } = await import("../store-actions");
const profile = { id: "user-1", display_name: "担当", email: "a@example.com", role: "member" };
/** profiles.id は uuid 列なので、担当者テストでは実在しうる形式の値を使う。 */
const VALID_USER_ID = "11111111-2222-4333-8444-555555555555";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("updateSalesProgressAction", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockRevalidateTag.mockReset();
    mockUpdateTag.mockReset();
    mockGetCurrentProfile.mockReset();
    mockGetCurrentProfile.mockResolvedValue(profile);
    mockFindProfileById.mockReset();
    mockFindProfileById.mockResolvedValue(profile);
  });

  it("未ログイン時は更新を拒否し、repository を呼ばない (Low A: deal-actions と同じ認証方針)", async () => {
    mockGetCurrentProfile.mockResolvedValueOnce(null);
    const result = await updateSalesProgressAction("store_1", makeFormData({ memo: "更新" }));
    expect(result).toEqual({ ok: false, error: "ログインが必要です" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
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
    // 保存直後に必ず読むタグは updateTag で即時失効する (下の describe で詳述)
    const updated = mockUpdateTag.mock.calls.map((c) => c[0]);
    expect(updated).toContain("stores");
    expect(updated).toContain("store:store_1");
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
    expect(mockUpdateTag).not.toHaveBeenCalled();
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

/**
 * 営業担当 (`Store.assigned_sales_user_id`) の更新。
 *
 * 店舗詳細「現在の営業状況」カードから直接変更できるようにしたぶんの検証。
 * `Deal.assigned_sales_user_id` (その活動を誰が行ったか) とは別概念であり、
 * 本 Action は deals に一切書き込まない。
 */
describe("updateSalesProgressAction: 営業担当", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockRevalidateTag.mockReset();
    mockUpdateTag.mockReset();
    mockGetCurrentProfile.mockReset();
    mockGetCurrentProfile.mockResolvedValue(profile);
    mockFindProfileById.mockReset();
    mockFindProfileById.mockResolvedValue(profile);
  });

  it("存在する profile なら patch に入る", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ assigned_sales_user_id: VALID_USER_ID }),
    );

    expect(result.ok).toBe(true);
    expect(mockFindProfileById).toHaveBeenCalledWith(VALID_USER_ID);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      assigned_sales_user_id: VALID_USER_ID,
    });
  });

  it("空文字は null (未割当) に正規化される", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ assigned_sales_user_id: "" }),
    );

    expect(result.ok).toBe(true);
    // 未割当への変更で profile 検索は走らない
    expect(mockFindProfileById).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      assigned_sales_user_id: null,
    });
  });

  it("存在しない profile id は拒否し、repository を呼ばない", async () => {
    mockFindProfileById.mockResolvedValueOnce(null);

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ assigned_sales_user_id: "00000000-0000-0000-0000-000000000000" }),
    );

    expect(result).toEqual({ ok: false, error: "営業担当が見つかりませんでした" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("uuid 形式でない値は DB へ問い合わせる前に弾く", async () => {
    // profiles.id は uuid 列。形式不正のまま findById すると Postgres の
    // 22P02 (invalid input syntax for type uuid) で例外になる。
    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ assigned_sales_user_id: "not-a-uuid" }),
    );

    expect(result).toEqual({ ok: false, error: "営業担当が見つかりませんでした" });
    expect(mockFindProfileById).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // 空文字 / 空白のみは readNullableString が未割当 (null) へ正規化するため、
  // ここでは「値はあるが uuid ではない」ものだけを列挙する。
  it.each(["12345", "user-1", "0000-0000", "'; DROP TABLE stores; --"])(
    "形式不正な値 (%s) は DB へ問い合わせず拒否する",
    async (value) => {
      const result = await updateSalesProgressAction(
        "store_1",
        makeFormData({ assigned_sales_user_id: value }),
      );
      expect(result.ok).toBe(false);
      expect(mockFindProfileById).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it("空白のみは未割当 (null) として扱う", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });
    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ assigned_sales_user_id: "   " }),
    );
    expect(result.ok).toBe(true);
    expect(mockFindProfileById).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      assigned_sales_user_id: null,
    });
  });

  it("FormData に含まれなければ patch に現れない (部分パッチの維持)", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ memo: "メモだけ更新" }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", { memo: "メモだけ更新" });
    expect(mockFindProfileById).not.toHaveBeenCalled();
  });

  it("3 項目を同時に保存できる (カードの一括保存)", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({
        assigned_sales_user_id: VALID_USER_ID,
        appointment_acquired_date: "2026-07-10",
        memo: "平日15時以降",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      assigned_sales_user_id: VALID_USER_ID,
      appointment_acquired_date: "2026-07-10",
      memo: "平日15時以降",
    });
  });

  it("「未取得に戻す」で送られる空のアポ取得日と担当変更を同時に扱える", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({
        assigned_sales_user_id: VALID_USER_ID,
        appointment_acquired_date: "",
        memo: "メモ",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("store_1", {
      assigned_sales_user_id: VALID_USER_ID,
      appointment_acquired_date: null,
      memo: "メモ",
    });
  });

  it("patch は Store の 3 フィールドしか含まない (Deal 側へ波及しない)", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    await updateSalesProgressAction(
      "store_1",
      makeFormData({
        assigned_sales_user_id: VALID_USER_ID,
        appointment_acquired_date: "2026-07-10",
        memo: "メモ",
        // カードが送らない値。混入しないことを確認する。
        status: "受注",
        next_action_type: "電話",
        stage: "架電済み",
      }),
    );

    const patch = mockUpdate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual([
      "appointment_acquired_date",
      "assigned_sales_user_id",
      "memo",
    ]);
  });
});

/**
 * 保存直後の read-your-own-writes 保証 (#172 と同じ考え方)。
 *
 * `revalidateTag(_, "max")` は stale-while-revalidate なので、Server Action 直後の
 * `router.refresh()` が失効前のキャッシュを返しうる。営業担当 / アポ取得日 /
 * 顧客共有メモはいずれも保存直後にこの画面と店舗一覧で目視される値なので、
 * `store:{id}` と `stores` だけは `updateTag` で即時失効する必要がある。
 * 集計系 (stats / pipeline / kpi / action-queue) は保存直後の閲覧画面ではないため
 * 従来どおり背景更新に任せる。
 */
describe("updateSalesProgressAction: キャッシュ失効", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockRevalidateTag.mockReset();
    mockUpdateTag.mockReset();
    mockGetCurrentProfile.mockReset();
    mockGetCurrentProfile.mockResolvedValue(profile);
    mockFindProfileById.mockReset();
    mockFindProfileById.mockResolvedValue(profile);
  });

  const tagsOf = (mock: typeof mockUpdateTag) =>
    mock.mock.calls.map((c) => c[0] as string);

  it("成功時に store:{id} と stores を updateTag で即時失効する", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ assigned_sales_user_id: VALID_USER_ID }),
    );

    expect(result.ok).toBe(true);
    expect(tagsOf(mockUpdateTag).sort()).toEqual(["store:store_1", "stores"]);
  });

  it("保存直後に見るタグを revalidateTag (stale-while-revalidate) に残さない", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    await updateSalesProgressAction("store_1", makeFormData({ memo: "メモ" }));

    const revalidated = tagsOf(mockRevalidateTag);
    expect(revalidated).not.toContain("stores");
    expect(revalidated).not.toContain("store:store_1");
  });

  it("集計系タグは従来どおり revalidateTag(_, 'max') で背景更新する", async () => {
    mockUpdate.mockResolvedValueOnce({ id: "store_1" });

    await updateSalesProgressAction("store_1", makeFormData({ memo: "メモ" }));

    expect(tagsOf(mockRevalidateTag).sort()).toEqual([
      "action-queue",
      "kpi",
      "pipeline",
      "stats",
    ]);
    for (const call of mockRevalidateTag.mock.calls) {
      expect(call[1]).toBe("max");
    }
  });

  it.each([
    [
      "未ログイン",
      () => mockGetCurrentProfile.mockResolvedValueOnce(null),
      { memo: "メモ" },
    ],
    [
      "日付が不正",
      () => undefined,
      { appointment_acquired_date: "2026/07/10" },
    ],
    [
      "メモが長すぎる",
      () => undefined,
      { memo: "あ".repeat(5001) },
    ],
    [
      "営業担当が uuid 形式でない",
      () => undefined,
      { assigned_sales_user_id: "not-a-uuid" },
    ],
    [
      "営業担当が存在しない",
      () => mockFindProfileById.mockResolvedValueOnce(null),
      { assigned_sales_user_id: VALID_USER_ID },
    ],
  ])("%s のときは即時失効も背景更新も走らない", async (_label, arrange, fields) => {
    arrange();

    const result = await updateSalesProgressAction("store_1", makeFormData(fields));

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("店舗が存在しない (repository が null) ときは失効しない", async () => {
    mockUpdate.mockResolvedValueOnce(null);

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ memo: "メモ" }),
    );

    expect(result).toEqual({ ok: false, error: "店舗が見つかりませんでした" });
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("repository が例外を投げたときも失効しない", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockUpdate.mockRejectedValueOnce(new Error("connection lost"));

    const result = await updateSalesProgressAction(
      "store_1",
      makeFormData({ memo: "メモ" }),
    );

    expect(result.ok).toBe(false);
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
