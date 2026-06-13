import { describe, expect, it } from "vitest";
import {
  getAreaSearchRankingReasons,
  sortAreaSearchResults,
} from "../ranking";
import type {
  AreaSearchDiscoveryInfo,
  AreaSearchPlaceViewModel,
  MatchedStoreSummary,
} from "../types";

const MAIN_TEXT_SEARCH_DISCOVERY: AreaSearchDiscoveryInfo = {
  sources: ["mainTextSearch"],
  firstSource: "mainTextSearch",
  sourceCount: 1,
};

function makePlace(
  overrides: Partial<AreaSearchPlaceViewModel> = {},
): AreaSearchPlaceViewModel {
  const { place: placeOverrides, ...rest } = overrides;
  return {
    place: {
      placeId: "p1",
      name: "テスト店舗",
      formattedAddress: "東京都渋谷区テスト1-1-1",
      lat: 35.658,
      lng: 139.7016,
      phone: "",
      rating: null,
      userRatingsTotal: null,
      types: ["restaurant", "food"],
      googleMapsUri: null,
      ...placeOverrides,
    },
    matchedStore: null,
    distanceMeters: 100,
    isWithinRadius: true,
    discovery: MAIN_TEXT_SEARCH_DISCOVERY,
    ...rest,
  };
}

function withId(
  vm: AreaSearchPlaceViewModel,
  placeId: string,
): AreaSearchPlaceViewModel {
  return { ...vm, place: { ...vm.place, placeId } };
}

const NO_ADDED: ReadonlySet<string> = new Set();

const REGISTERED: MatchedStoreSummary = { id: "store-1", name: "登録済み店舗" };

describe("sortAreaSearchResults", () => {
  it("google mode は元の順番を維持する (元配列のコピーを返す)", () => {
    const a = withId(makePlace({ distanceMeters: 500 }), "a");
    const b = withId(makePlace({ distanceMeters: 100 }), "b");
    const c = withId(makePlace({ distanceMeters: 300 }), "c");
    const input = [a, b, c];

    const result = sortAreaSearchResults(input, "google", NO_ADDED);

    expect(result.map((vm) => vm.place.placeId)).toEqual(["a", "b", "c"]);
    expect(result).not.toBe(input);
  });

  it("distance mode は distanceMeters 昇順になる", () => {
    const far = withId(makePlace({ distanceMeters: 800 }), "far");
    const near = withId(makePlace({ distanceMeters: 100 }), "near");
    const mid = withId(makePlace({ distanceMeters: 400 }), "mid");

    const result = sortAreaSearchResults([far, near, mid], "distance", NO_ADDED);

    expect(result.map((vm) => vm.place.placeId)).toEqual(["near", "mid", "far"]);
  });

  it("salesCandidate mode は 未登録・未追加・範囲内・近距離 を優先する", () => {
    const registered = withId(
      makePlace({ matchedStore: REGISTERED, distanceMeters: 50 }),
      "registered",
    );
    const added = withId(makePlace({ distanceMeters: 60 }), "added");
    const outOfRange = withId(
      makePlace({ distanceMeters: 70, isWithinRadius: false }),
      "outOfRange",
    );
    const farEligible = withId(makePlace({ distanceMeters: 900 }), "farEligible");
    const nearEligible = withId(makePlace({ distanceMeters: 100 }), "nearEligible");

    const addedIds = new Set(["added"]);
    const input = [registered, added, outOfRange, farEligible, nearEligible];

    const result = sortAreaSearchResults(input, "salesCandidate", addedIds);

    expect(result.map((vm) => vm.place.placeId)).toEqual([
      "nearEligible",
      "farEligible",
      "outOfRange",
      "added",
      "registered",
    ]);
  });

  it("unregistered mode は 登録済み/追加済み を下げる", () => {
    const registered = withId(
      makePlace({ matchedStore: REGISTERED, distanceMeters: 50 }),
      "registered",
    );
    const added = withId(makePlace({ distanceMeters: 60 }), "added");
    const eligible = withId(makePlace({ distanceMeters: 500 }), "eligible");

    const addedIds = new Set(["added"]);
    const result = sortAreaSearchResults(
      [registered, added, eligible],
      "unregistered",
      addedIds,
    );

    expect(result.map((vm) => vm.place.placeId)).toEqual([
      "eligible",
      "registered",
      "added",
    ]);
  });

  it("rating mode は rating desc、null は下になる", () => {
    const highRating = withId(
      makePlace({ place: { rating: 4.5 } as never }),
      "high",
    );
    const lowRating = withId(
      makePlace({ place: { rating: 3.0 } as never }),
      "low",
    );
    const noRating = withId(makePlace({ place: { rating: null } as never }), "none");

    const result = sortAreaSearchResults(
      [noRating, lowRating, highRating],
      "rating",
      NO_ADDED,
    );

    expect(result.map((vm) => vm.place.placeId)).toEqual(["high", "low", "none"]);
  });

  it("reviews mode は userRatingsTotal desc、null は下になる", () => {
    const many = withId(
      makePlace({ place: { userRatingsTotal: 500 } as never }),
      "many",
    );
    const few = withId(
      makePlace({ place: { userRatingsTotal: 10 } as never }),
      "few",
    );
    const none = withId(
      makePlace({ place: { userRatingsTotal: null } as never }),
      "none",
    );

    const result = sortAreaSearchResults([none, few, many], "reviews", NO_ADDED);

    expect(result.map((vm) => vm.place.placeId)).toEqual(["many", "few", "none"]);
  });

  it("同点の場合は元の順番を維持する (distance mode で同一distanceMeters)", () => {
    const a = withId(makePlace({ distanceMeters: 100 }), "a");
    const b = withId(makePlace({ distanceMeters: 100 }), "b");
    const c = withId(makePlace({ distanceMeters: 100 }), "c");

    const result = sortAreaSearchResults([a, b, c], "distance", NO_ADDED);

    expect(result.map((vm) => vm.place.placeId)).toEqual(["a", "b", "c"]);
  });

  it("元配列を破壊しない", () => {
    const a = withId(makePlace({ distanceMeters: 500 }), "a");
    const b = withId(makePlace({ distanceMeters: 100 }), "b");
    const input = [a, b];
    const snapshot = [...input];

    sortAreaSearchResults(input, "distance", NO_ADDED);

    expect(input).toEqual(snapshot);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });
});

describe("getAreaSearchRankingReasons", () => {
  it("未登録/登録済み/追加済み/範囲内/距離/評価/口コミ を返す", () => {
    const unregistered = makePlace({
      distanceMeters: 320,
      isWithinRadius: true,
      place: {
        rating: 4.1,
        userRatingsTotal: 120,
      } as never,
    });
    expect(getAreaSearchRankingReasons(unregistered, NO_ADDED)).toEqual([
      "未登録",
      "範囲内",
      "320m",
      "評価4.1",
      "口コミ120件",
      "メイン検索",
    ]);

    const registered = makePlace({ matchedStore: REGISTERED });
    expect(getAreaSearchRankingReasons(registered, NO_ADDED)).toEqual(
      expect.arrayContaining(["登録済み"]),
    );

    const added = withId(makePlace(), "added-place");
    const addedIds = new Set(["added-place"]);
    expect(getAreaSearchRankingReasons(added, addedIds)).toEqual(
      expect.arrayContaining(["未登録", "追加済み"]),
    );

    const outOfRange = makePlace({ isWithinRadius: false });
    expect(getAreaSearchRankingReasons(outOfRange, NO_ADDED)).toEqual(
      expect.arrayContaining(["範囲外"]),
    );

    const noRatingNoReviews = makePlace({
      place: { rating: null, userRatingsTotal: null } as never,
    });
    const reasons = getAreaSearchRankingReasons(noRatingNoReviews, NO_ADDED);
    expect(reasons.some((r) => r.startsWith("評価"))).toBe(false);
    expect(reasons.some((r) => r.startsWith("口コミ"))).toBe(false);
  });

  it("探索ソースを表示理由として含む (複数ソースは + で連結)", () => {
    const mainOnly = makePlace();
    expect(getAreaSearchRankingReasons(mainOnly, NO_ADDED)).toEqual(
      expect.arrayContaining(["メイン検索"]),
    );

    const multiSource = makePlace({
      discovery: {
        sources: ["mainTextSearch", "keywordExploration"],
        firstSource: "mainTextSearch",
        sourceCount: 2,
      },
    });
    expect(getAreaSearchRankingReasons(multiSource, NO_ADDED)).toEqual(
      expect.arrayContaining(["メイン検索 + 追加キーワード"]),
    );
  });
});
