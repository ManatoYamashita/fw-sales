/**
 * 調査段階の即時更新 (#334) の失効方式を固定する。
 *
 * 店舗詳細の調査段階 Select は、選んだ直後の Server Action 応答に載る再描画で
 * 新しい段階を表示する。`revalidateTag(_, "max")` (stale-while-revalidate) だと
 * 再描画が失効前のキャッシュを返し、選んだ値が元に戻って見える。
 * 同一リクエスト内で失効が保証される `updateTag` を使うこと。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_TAGS } from "@/lib/cache";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/repositories", () => ({ repos: { store: { update: mocks.update } } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag, revalidateTag: mocks.revalidateTag }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateStoreStageAction } from "../store-actions";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("updateStoreStageAction", () => {
  it("店舗詳細と店舗一覧のキャッシュを同一リクエスト内で失効する", async () => {
    mocks.update.mockResolvedValue({ id: "store_1" });
    const result = await updateStoreStageAction("store_1", "調査済み");
    expect(result.ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("store_1", { stage: "調査済み" });
    expect(mocks.updateTag).toHaveBeenCalledWith(CACHE_TAGS.store("store_1"));
    expect(mocks.updateTag).toHaveBeenCalledWith(CACHE_TAGS.stores);
    // 詳細を stale-while-revalidate で失効すると、選んだ値が元に戻って見える。
    expect(mocks.revalidateTag).not.toHaveBeenCalledWith(CACHE_TAGS.store("store_1"), "max");
  });

  it("店舗が無ければ失効せずに失敗を返す", async () => {
    mocks.update.mockResolvedValue(null);
    const result = await updateStoreStageAction("missing", "調査済み");
    expect(result.ok).toBe(false);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});
