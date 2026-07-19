/**
 * 旧 `/deals` `/deals/[id]` `/deals/new` の後方互換 redirect ページのユニットテスト。
 *
 * #163 で `app/(main)/deals/_components/*` および `deal-new-form.tsx` を
 * 到達不能コードとして削除したが、redirect route 自体 (page.tsx) は
 * 旧URLブックマーク互換のため維持する。本テストは redirect 先URL・
 * ID / query parameter の維持・404 退行がないことを回帰検証する。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const NEXT_REDIRECT = Symbol("NEXT_REDIRECT");
const NEXT_NOT_FOUND = Symbol("NEXT_NOT_FOUND");

const { mockRedirect, mockNotFound, mockGetDealCached, mockGetStoreCached } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: NEXT_REDIRECT, url });
  }),
  mockNotFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: NEXT_NOT_FOUND });
  }),
  mockGetDealCached: vi.fn(),
  mockGetStoreCached: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));

vi.mock("@/lib/queries/deals", () => ({
  getDealCached: mockGetDealCached,
}));

vi.mock("@/lib/queries/stores", () => ({
  getStoreCached: mockGetStoreCached,
}));

const LegacyDealsPage = (await import("../page")).default;
const LegacyDealPage = (await import("../[id]/page")).default;
const LegacyNewDealPage = (await import("../new/page")).default;

beforeEach(() => {
  mockRedirect.mockClear();
  mockNotFound.mockClear();
  mockGetDealCached.mockReset();
  mockGetStoreCached.mockReset();
});

describe("/deals (LegacyDealsPage)", () => {
  it("/stores へ redirect する", () => {
    expect(() => LegacyDealsPage()).toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/stores");
  });
});

describe("/deals/[id] (LegacyDealPage)", () => {
  it("Deal が存在する場合、store_id と activity(id) を維持した URL へ redirect する", async () => {
    mockGetDealCached.mockResolvedValueOnce({ id: "deal_1", store_id: "store_9" });

    await expect(
      LegacyDealPage({ params: Promise.resolve({ id: "deal_1" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockGetDealCached).toHaveBeenCalledWith("deal_1");
    expect(mockRedirect).toHaveBeenCalledWith("/stores/store_9?tab=progress&activity=deal_1");
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("Deal が存在しない場合、404 (notFound) へ退行する", async () => {
    mockGetDealCached.mockResolvedValueOnce(null);

    await expect(
      LegacyDealPage({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("/deals/new (LegacyNewDealPage)", () => {
  it("store query parameter が維持され、対象店舗の営業記録追加画面へ redirect する", async () => {
    mockGetStoreCached.mockResolvedValueOnce({ id: "store_9" });

    await expect(
      LegacyNewDealPage({ searchParams: Promise.resolve({ store: "store_9" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockGetStoreCached).toHaveBeenCalledWith("store_9");
    expect(mockRedirect).toHaveBeenCalledWith("/stores/store_9?tab=progress&action=new");
  });

  it("store query parameter が未指定の場合、404 (notFound) へ退行する", async () => {
    await expect(
      LegacyNewDealPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockGetStoreCached).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("指定された store が存在しない場合、404 (notFound) へ退行する", async () => {
    mockGetStoreCached.mockResolvedValueOnce(null);

    await expect(
      LegacyNewDealPage({ searchParams: Promise.resolve({ store: "missing" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
