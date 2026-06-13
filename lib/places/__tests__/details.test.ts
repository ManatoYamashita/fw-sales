import { describe, expect, it } from "vitest";
import { mergePlaceDetailsIntoAreaSearchResult } from "../details";
import { createDiscoveryInfo } from "../discovery";
import type { AreaSearchPlaceViewModel, PlaceDetailsResult } from "../types";

function makeViewModel(
  overrides: Partial<AreaSearchPlaceViewModel> = {},
): AreaSearchPlaceViewModel {
  return {
    place: {
      placeId: "ChIJtarget",
      name: "テスト居酒屋",
      formattedAddress: "東京都渋谷区テスト1-1-1",
      lat: 35.6595,
      lng: 139.7005,
      phone: "",
      rating: null,
      userRatingsTotal: null,
      types: ["restaurant", "food"],
      googleMapsUri: null,
    },
    matchedStore: null,
    distanceMeters: 100,
    isWithinRadius: true,
    discovery: createDiscoveryInfo("mainTextSearch"),
    ...overrides,
  };
}

function makeDetails(overrides: Partial<PlaceDetailsResult> = {}): PlaceDetailsResult {
  return {
    placeId: "ChIJtarget",
    name: "テスト居酒屋",
    address: "東京都渋谷区テスト1-1-1",
    lat: 35.6595,
    lng: 139.7005,
    googleMapsUri: "https://maps.google.com/?cid=123",
    types: ["restaurant", "food"],
    phone: "03-1234-5678",
    rating: 4.1,
    userRatingsTotal: 120,
    websiteUri: "https://example.com",
    businessStatus: "OPERATIONAL",
    ...overrides,
  };
}

describe("mergePlaceDetailsIntoAreaSearchResult", () => {
  it("placeId一致時に phone/rating/userRatingsTotal/websiteUri/businessStatus がmergeされる", () => {
    const result = makeViewModel();
    const details = makeDetails();

    const merged = mergePlaceDetailsIntoAreaSearchResult(result, details);

    expect(merged.place.phone).toBe("03-1234-5678");
    expect(merged.place.rating).toBe(4.1);
    expect(merged.place.userRatingsTotal).toBe(120);
    expect(merged.websiteUri).toBe("https://example.com");
    expect(merged.businessStatus).toBe("OPERATIONAL");
  });

  it("placeId不一致時は元resultを返す", () => {
    const result = makeViewModel();
    const details = makeDetails({ placeId: "ChIJother" });

    const merged = mergePlaceDetailsIntoAreaSearchResult(result, details);

    expect(merged).toBe(result);
  });

  it("元オブジェクトを破壊しない", () => {
    const result = makeViewModel();
    const snapshot = JSON.parse(JSON.stringify(result));
    const details = makeDetails();

    mergePlaceDetailsIntoAreaSearchResult(result, details);

    expect(result).toEqual(snapshot);
  });

  it("discovery/matchedStore/distanceMeters/isWithinRadiusを維持する", () => {
    const result = makeViewModel({
      matchedStore: { id: "store-1", name: "既存店舗" },
      distanceMeters: 250,
      isWithinRadius: false,
    });
    const details = makeDetails();

    const merged = mergePlaceDetailsIntoAreaSearchResult(result, details);

    expect(merged.discovery).toEqual(result.discovery);
    expect(merged.matchedStore).toEqual({ id: "store-1", name: "既存店舗" });
    expect(merged.distanceMeters).toBe(250);
    expect(merged.isWithinRadius).toBe(false);
  });

  it("null/空値で既存の有効値を不用意に消さない", () => {
    const result = makeViewModel({
      place: {
        placeId: "ChIJtarget",
        name: "テスト居酒屋",
        formattedAddress: "東京都渋谷区テスト1-1-1",
        lat: 35.6595,
        lng: 139.7005,
        phone: "03-9999-9999",
        rating: 3.5,
        userRatingsTotal: 50,
        types: ["restaurant", "food"],
        googleMapsUri: null,
      },
      websiteUri: "https://existing.example.com",
      businessStatus: "OPERATIONAL",
    });
    const details = makeDetails({
      phone: "",
      rating: null,
      userRatingsTotal: null,
      websiteUri: null,
      businessStatus: null,
    });

    const merged = mergePlaceDetailsIntoAreaSearchResult(result, details);

    expect(merged.place.phone).toBe("03-9999-9999");
    expect(merged.place.rating).toBe(3.5);
    expect(merged.place.userRatingsTotal).toBe(50);
    expect(merged.websiteUri).toBe("https://existing.example.com");
    expect(merged.businessStatus).toBe("OPERATIONAL");
  });
});
