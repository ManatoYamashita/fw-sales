/**
 * requireAdmin ガードのユニットテスト (#155 destructive-action-authz)。
 *
 * - 未認証 / member / placeholder / admin の 4 ロール分岐
 * - 拒否時は構造化ログ ([authz] denied) に理由を残し、UI 文言は内部情報を含まない
 * - 許可時は profile を返し、成功監査ログに使えること
 *
 * mock 方針は prompt-template-actions.test.ts に倣い @/lib/supabase/server を差し替える。
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { mockGetCurrentProfile } = vi.hoisted(() => ({
  mockGetCurrentProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: mockGetCurrentProfile,
}));

const { requireAdmin } = await import("../_authz");

function makeProfile(role: "member" | "placeholder" | "admin") {
  return {
    id: "user-uuid-1",
    email: "u@test.com",
    display_name: "テスト",
    avatar_url: null,
    role,
    created_at: "2026-07-05",
    updated_at: "2026-07-05",
  };
}

describe("requireAdmin", () => {
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    mockGetCurrentProfile.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("未認証 (profile なし) は失敗し、ログインを促す文言 + unauthenticated ログ", async () => {
    mockGetCurrentProfile.mockResolvedValueOnce(null);

    const result = await requireAdmin("stores.delete");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denied).toEqual({ ok: false, error: "ログインが必要です" });
    }
    expect(warnSpy).toHaveBeenCalledWith(
      "[authz] denied",
      expect.objectContaining({ action: "stores.delete", reason: "unauthenticated" }),
    );
  });

  it("member は失敗し、管理者権限を要求する文言 + not_admin ログ (role/email を構造化ログに残す)", async () => {
    mockGetCurrentProfile.mockResolvedValueOnce(makeProfile("member"));

    const result = await requireAdmin("data.clearAll");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denied.ok).toBe(false);
      if (!result.denied.ok) {
        expect(result.denied.error).toMatch(/管理者/);
        // UI 文言に内部情報 (role / email / userId) を出さない
        expect(result.denied.error).not.toContain("member");
        expect(result.denied.error).not.toContain("u@test.com");
      }
    }
    expect(warnSpy).toHaveBeenCalledWith(
      "[authz] denied",
      expect.objectContaining({
        action: "data.clearAll",
        userId: "user-uuid-1",
        email: "u@test.com",
        role: "member",
        reason: "not_admin",
      }),
    );
  });

  it("placeholder も member と同様に拒否される", async () => {
    mockGetCurrentProfile.mockResolvedValueOnce(makeProfile("placeholder"));

    const result = await requireAdmin("stores.bulkDelete");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denied.ok).toBe(false);
    }
    expect(warnSpy).toHaveBeenCalledWith(
      "[authz] denied",
      expect.objectContaining({ role: "placeholder", reason: "not_admin" }),
    );
  });

  it("admin は許可され、profile を返す (成功監査ログ用)", async () => {
    const admin = makeProfile("admin");
    mockGetCurrentProfile.mockResolvedValueOnce(admin);

    const result = await requireAdmin("stores.delete");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile).toBe(admin);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    { profile: null, reason: "unauthenticated", message: "ログインが必要です" },
    { profile: makeProfile("member"), reason: "not_admin", message: "この操作には管理者権限が必要です" },
  ])("observer rejectを隔離して$reasonの拒否結果を維持する", async ({ profile, reason, message }) => {
    mockGetCurrentProfile.mockResolvedValueOnce(profile);
    const observer = vi.fn().mockRejectedValue(new Error("PRIVATE observer error"));

    const result = await requireAdmin("stores.delete", observer);

    expect(result).toEqual({ ok: false, denied: { ok: false, error: message } });
    expect(observer).toHaveBeenCalledExactlyOnceWith({ profile, reason });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    const fallback = JSON.parse(errorSpy.mock.calls[0]![0]);
    expect(fallback).toEqual({
      level: "error",
      event: "authz.denial_observer_failed",
      reason,
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("PRIVATE");
  });
});
