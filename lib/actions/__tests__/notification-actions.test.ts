/**
 * 通知既読化 Server Actions のユニットテスト (#296)。
 *
 * - 未ログインは拒否し、repo を呼ばない
 * - 対象ユーザーは必ずセッションの profile から決める (他人の通知を既読化させない)
 * - 更新が発生したときだけ notifications キャッシュを失効させる
 * - repo の例外は内部情報を出さない文言に変換する
 *
 * mock 様式は profile-actions.test.ts に準拠。
 */

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockGetCurrentProfile,
  mockMarkAsRead,
  mockMarkAllAsRead,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockGetCurrentProfile: vi.fn(),
  mockMarkAsRead: vi.fn(),
  mockMarkAllAsRead: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: mockGetCurrentProfile,
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    notification: {
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
    },
  },
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

const { markNotificationReadAction, markAllNotificationsReadAction } =
  await import("../notification-actions");

const PROFILE = { id: "user-1", email: "u@test.com", role: "member" };

describe("notification actions", () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    mockGetCurrentProfile.mockReset();
    mockMarkAsRead.mockReset();
    mockMarkAllAsRead.mockReset();
    mockUpdateTag.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => errorSpy.mockRestore();
  });

  describe("markNotificationReadAction", () => {
    it("未ログインは拒否し repo を呼ばない", async () => {
      mockGetCurrentProfile.mockResolvedValue(null);
      const result = await markNotificationReadAction("notif_1");
      expect(result.ok).toBe(false);
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });

    it("空の ID は拒否する", async () => {
      mockGetCurrentProfile.mockResolvedValue(PROFILE);
      const result = await markNotificationReadAction("  ");
      expect(result.ok).toBe(false);
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });

    it("セッションの profile id で既読化し、キャッシュを失効させる", async () => {
      mockGetCurrentProfile.mockResolvedValue(PROFILE);
      mockMarkAsRead.mockResolvedValue(true);
      const result = await markNotificationReadAction("notif_1");
      expect(result).toEqual({ ok: true, data: { updated: true } });
      expect(mockMarkAsRead).toHaveBeenCalledWith("notif_1", "user-1");
      expect(mockUpdateTag).toHaveBeenCalledWith("notifications");
      expect(mockUpdateTag).toHaveBeenCalledWith("notification:notif_1");
    });

    it("既読済み・他人の通知 (更新 0 件) は成功扱いでキャッシュを触らない", async () => {
      mockGetCurrentProfile.mockResolvedValue(PROFILE);
      mockMarkAsRead.mockResolvedValue(false);
      const result = await markNotificationReadAction("notif_other");
      expect(result).toEqual({ ok: true, data: { updated: false } });
      expect(mockUpdateTag).not.toHaveBeenCalled();
    });

    it("repo の例外は内部情報を出さない文言にしてログへ残す", async () => {
      mockGetCurrentProfile.mockResolvedValue(PROFILE);
      mockMarkAsRead.mockRejectedValue(new Error('relation "notifications" x'));
      const result = await markNotificationReadAction("notif_1");
      expect(result).toEqual({ ok: false, error: "通知を既読にできませんでした" });
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("markAllNotificationsReadAction", () => {
    it("未ログインは拒否し repo を呼ばない", async () => {
      mockGetCurrentProfile.mockResolvedValue(null);
      const result = await markAllNotificationsReadAction();
      expect(result.ok).toBe(false);
      expect(mockMarkAllAsRead).not.toHaveBeenCalled();
    });

    it("本人の未読をすべて既読化し、件数を返す", async () => {
      mockGetCurrentProfile.mockResolvedValue(PROFILE);
      mockMarkAllAsRead.mockResolvedValue(9);
      const result = await markAllNotificationsReadAction();
      expect(result).toEqual({ ok: true, data: { count: 9 } });
      expect(mockMarkAllAsRead).toHaveBeenCalledWith("user-1");
      expect(mockUpdateTag).toHaveBeenCalledWith("notifications");
    });

    it("0 件ならキャッシュを触らない", async () => {
      mockGetCurrentProfile.mockResolvedValue(PROFILE);
      mockMarkAllAsRead.mockResolvedValue(0);
      await markAllNotificationsReadAction();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    });

    it("repo の例外は内部情報を出さない文言にする", async () => {
      mockGetCurrentProfile.mockResolvedValue(PROFILE);
      mockMarkAllAsRead.mockRejectedValue(new Error("boom"));
      const result = await markAllNotificationsReadAction();
      expect(result).toEqual({ ok: false, error: "通知を既読にできませんでした" });
    });
  });
});
