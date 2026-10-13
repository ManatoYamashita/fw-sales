/**
 * `getRecentNotifications` が削除済み店舗へのリンクを無効化すること (#296)。
 *
 * 店舗は物理削除されるため、通知だけが残ると「指定された店舗は見つかりません
 * でした」画面へ誘導してしまう。テスト方針は sales-progress.test.ts と同様
 * (repos / next をモック)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@/types/notification";

vi.mock("server-only", () => ({}));

const { mockFindByUserId, mockStoreGet, mockCacheTag } = vi.hoisted(() => ({
  mockFindByUserId: vi.fn(),
  mockStoreGet: vi.fn(),
  mockCacheTag: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    notification: { findByUserId: mockFindByUserId },
    store: { get: mockStoreGet },
  },
}));

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: mockCacheTag,
}));

const { getRecentNotifications } = await import("../notification");

function makeNotification(
  id: string,
  link_url: string | null,
): Notification {
  return {
    id,
    user_id: "user-1",
    kind: "research_job_completed",
    title: id,
    body: "",
    link_url,
    read_at: null,
    created_at: "2026-10-07",
    updated_at: "2026-10-07",
  };
}

describe("getRecentNotifications", () => {
  beforeEach(() => {
    mockFindByUserId.mockReset();
    mockStoreGet.mockReset();
    mockCacheTag.mockReset();
  });

  it("存在しない店舗を指すリンクだけを null にする", async () => {
    mockFindByUserId.mockResolvedValue([
      makeNotification("alive", "/stores/store_alive#deep-research"),
      makeNotification("dead", "/stores/store_dead#deep-research"),
      makeNotification("dead-again", "/stores/store_dead"),
      makeNotification("other", "/settings"),
      makeNotification("none", null),
    ]);
    mockStoreGet.mockImplementation(async (id: string) =>
      id === "store_alive" ? { id } : null,
    );

    const result = await getRecentNotifications("user-1");

    expect(result.map((n) => [n.id, n.link_url])).toEqual([
      ["alive", "/stores/store_alive#deep-research"],
      ["dead", null],
      ["dead-again", null],
      ["other", "/settings"],
      ["none", null],
    ]);
    // 同じ店舗は 1 回だけ引く
    expect(mockStoreGet).toHaveBeenCalledTimes(2);
  });

  it("店舗削除で結果が変わるため stores タグにも相乗りする", async () => {
    mockFindByUserId.mockResolvedValue([]);
    await getRecentNotifications("user-1");
    expect(mockCacheTag).toHaveBeenCalledWith("notifications", "stores");
  });

  it("店舗リンクが無ければ店舗を引かない", async () => {
    mockFindByUserId.mockResolvedValue([makeNotification("none", null)]);
    await getRecentNotifications("user-1");
    expect(mockStoreGet).not.toHaveBeenCalled();
  });

  it("limit で切った後の通知だけを検査する", async () => {
    mockFindByUserId.mockResolvedValue([
      makeNotification("a", "/stores/store_a"),
      makeNotification("b", "/stores/store_b"),
    ]);
    mockStoreGet.mockResolvedValue({ id: "x" });
    const result = await getRecentNotifications("user-1", 1);
    expect(result.map((n) => n.id)).toEqual(["a"]);
    expect(mockStoreGet).toHaveBeenCalledTimes(1);
  });
});
