import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildTextSearchMeta } from "@/lib/places/search-meta";
import type { AreaSearchPlaceViewModel } from "@/lib/places/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/area-search-actions", () => ({
  bulkAddStoresFromPlacesAction: vi.fn(),
  getPlaceDetailsForAreaSearchAction: vi.fn(),
  searchPlacesWithMatchesAction: vi.fn(),
}));

vi.mock("../add-store-button", () => ({
  AddStoreButton: () => <button type="button">店舗を追加</button>,
}));

const { AreaSearchResults } = await import("../area-search-results");
const { AreaSearchMap } = await import("../area-search-map");
const { PlaceResultList } = await import("../place-result-list");

const PLACE: AreaSearchPlaceViewModel = {
  place: {
    placeId: "place-1",
    name: "長い店舗名の候補",
    formattedAddress: "東京都渋谷区",
    lat: 35.66,
    lng: 139.7,
    phone: "",
    rating: null,
    userRatingsTotal: null,
    types: ["restaurant"],
    googleMapsUri: null,
  },
  matchedStore: null,
  distanceMeters: 500,
  isWithinRadius: true,
  discovery: {
    sources: ["mainTextSearch"],
    firstSource: "mainTextSearch",
    sourceCount: 1,
  },
  candidateInfo: null,
};

describe("エリア検索の狭幅構造", () => {
  it("地図は一覧との横並びが成立するコンテナ幅まで低い高さを保つ", () => {
    const previous = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "test-only";
    try {
      const html = renderToStaticMarkup(
        <AreaSearchMap
          center={{ lat: 35.66, lng: 139.7 }}
          radiusMeters={1000}
          places={[]}
          addedIds={new Set()}
          activePlaceId={null}
          onActivatePlace={() => {}}
        />,
      );
      const $ = load(html);
      const map = $("div[class*='h-[280px]']").first();
      expect(map.attr("class")).toContain("@min-[800px]:h-[520px]");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = previous;
    }
  });

  it("結果全体をコンテナにし、800px 未満では地図と一覧を縦に積む", () => {
    const html = renderToStaticMarkup(
      <AreaSearchResults
        results={[]}
        nextPageToken={null}
        keyword="ラーメン"
        area="渋谷駅"
        center={{ lat: 35.66, lng: 139.7 }}
        radiusMeters={1000}
        meta={buildTextSearchMeta({
          loadedCount: 0,
          hasNextPage: false,
          currentPageCount: 1,
          apiCallEstimate: 2,
        })}
      />,
    );
    const $ = load(html);
    const root = $("div").first();
    expect(root.attr("class")?.split(" ")).toContain("@container");
    const grid = $("div[class*='grid-cols-1']").filter((_, el) =>
      $(el).attr("class")?.includes("@min-[800px]:grid-cols-[minmax(0,1fr)_400px]") ?? false,
    );
    expect(grid).toHaveLength(1);
    expect(grid.children().first().attr("class")).toContain("order-1");
    expect(grid.children().eq(1).attr("class")).toContain("order-2");
  });

  it("候補の選択は 44px のタップ領域を持ち、操作列は狭幅で本文の下へ移る", () => {
    const html = renderToStaticMarkup(
      <PlaceResultList
        results={[PLACE]}
        addedIds={new Set()}
        selectedIds={new Set()}
        centerLabel="渋谷駅"
        activePlaceId={null}
        onActivatePlace={() => {}}
        onAdded={() => {}}
        onToggle={() => {}}
        detailsLoadingPlaceIds={new Set()}
        detailsLoadedPlaceIds={new Set()}
        detailsErrors={{}}
        onFetchDetails={() => {}}
      />,
    );
    const $ = load(html);
    expect($("div").first().attr("class")?.split(" ")).toContain("@container");
    const card = $("li[data-place-id='place-1']");
    expect(card.find("label").first().attr("class")?.split(" ")).toContain("h-11");
    expect(card.find("input[type='checkbox']").attr("aria-label")).toBe("長い店舗名の候補を選択");
    const body = card.find("div[class*='grid-cols-']").first();
    expect(body.attr("class")).toContain("grid-cols-[2.75rem_minmax(0,1fr)]");
    expect(body.children().last().attr("class")).toContain("col-start-2");
  });
});
