/**
 * `updateStorePatchAction` の失効が read-your-own-writes を守ること (#297)。
 *
 * 店舗名・業態 / 基本情報 / 地図 / Web 資産の編集は保存直後に `router.refresh()` で
 * 同じ画面を読み直す。`revalidateTag(_, "max")` (stale-while-revalidate) だと旧値が
 * 返り、店舗名を直したのに見出しが戻らない。E2E (e2e/sales-status.spec.ts) で検出した。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_TAGS } from "@/lib/cache";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ update: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/repositories", () => ({ repos: { store: { update: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag, updateTag: mocks.updateTag }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: vi.fn() }));

const { updateStorePatchAction } = await import("../store-actions");

describe("updateStorePatchAction の失効", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.update.mockResolvedValue({ id: "store_1", name: "炉端ジュン" });
  });

  it("店舗詳細と店舗一覧のタグを即時失効する (updateTag)", async () => {
    const result = await updateStorePatchAction("store_1", { name: "炉端ジュン" });
    expect(result.ok).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalledWith(CACHE_TAGS.store("store_1"));
    expect(mocks.updateTag).toHaveBeenCalledWith(CACHE_TAGS.stores);
  });

  it("店舗詳細・一覧のタグを stale-while-revalidate で失効しない", async () => {
    await updateStorePatchAction("store_1", { name: "炉端ジュン" });
    const swrTags = mocks.revalidateTag.mock.calls.map(([tag]) => tag);
    expect(swrTags).not.toContain(CACHE_TAGS.store("store_1"));
    expect(swrTags).not.toContain(CACHE_TAGS.stores);
  });

  it("店舗が無ければ何も失効しない", async () => {
    mocks.update.mockResolvedValue(null);
    expect((await updateStorePatchAction("store_x", { name: "x" })).ok).toBe(false);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});
