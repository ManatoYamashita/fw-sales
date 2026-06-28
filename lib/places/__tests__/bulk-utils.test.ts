import { describe, expect, it } from "vitest";
import {
  deduplicatePlaceIds,
  mergeUniquePlaces,
  mergeUniquePlacesWithStats,
} from "../bulk-utils";
import { createDiscoveryInfo } from "../discovery";
import type { AreaSearchPlaceViewModel, PlaceWithMatch } from "../types";

function makePlace(placeId: string, name = placeId): PlaceWithMatch {
  return {
    place: {
      placeId,
      name,
      formattedAddress: "",
      lat: 0,
      lng: 0,
      phone: "",
      rating: null,
      userRatingsTotal: null,
      types: [],
      googleMapsUri: null,
    },
    matchedStore: null,
  };
}

function makeViewModel(
  placeId: string,
  source: Parameters<typeof createDiscoveryInfo>[0],
): AreaSearchPlaceViewModel {
  return {
    ...makePlace(placeId),
    distanceMeters: 0,
    isWithinRadius: true,
    discovery: createDiscoveryInfo(source),
    candidateInfo: null,
  };
}

describe("deduplicatePlaceIds", () => {
  it("空配列は空配列を返す", () => {
    expect(deduplicatePlaceIds([])).toEqual([]);
  });

  it("重複した placeId を1件に絞る", () => {
    expect(deduplicatePlaceIds(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("空文字を除外する", () => {
    expect(deduplicatePlaceIds(["a", "", "b", ""])).toEqual(["a", "b"]);
  });

  it("全て重複の場合は1件にまとめる", () => {
    expect(deduplicatePlaceIds(["x", "x", "x"])).toEqual(["x"]);
  });

  it("重複なしの場合は順序を維持して全件返す", () => {
    expect(deduplicatePlaceIds(["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("入力順を維持する (最初に出現した位置を保持)", () => {
    expect(deduplicatePlaceIds(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
});

describe("mergeUniquePlaces", () => {
  it("重複がない場合は current の後ろに incoming を連結する", () => {
    const current = [makePlace("a"), makePlace("b")];
    const incoming = [makePlace("c"), makePlace("d")];
    expect(mergeUniquePlaces(current, incoming)).toEqual([...current, ...incoming]);
  });

  it("incoming 側の重複 placeId は破棄する", () => {
    const current = [makePlace("a"), makePlace("b")];
    const incoming = [makePlace("b"), makePlace("c")];
    expect(mergeUniquePlaces(current, incoming)).toEqual([
      ...current,
      makePlace("c"),
    ]);
  });

  it("incoming が空配列の場合は current をそのまま返す", () => {
    const current = [makePlace("a")];
    expect(mergeUniquePlaces(current, [])).toEqual(current);
  });

  it("current が空配列の場合は incoming をそのまま返す", () => {
    const incoming = [makePlace("a"), makePlace("b")];
    expect(mergeUniquePlaces([], incoming)).toEqual(incoming);
  });
});

describe("mergeUniquePlacesWithStats", () => {
  it("重複がない場合は addedCount=incoming件数, duplicateCount=0", () => {
    const current = [makePlace("a"), makePlace("b")];
    const incoming = [makePlace("c"), makePlace("d")];
    const result = mergeUniquePlacesWithStats(current, incoming);
    expect(result.merged).toEqual([...current, ...incoming]);
    expect(result.addedCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
  });

  it("incoming 側の重複 placeId は除外しつつ件数を集計する", () => {
    const current = [makePlace("a"), makePlace("b")];
    const incoming = [makePlace("b"), makePlace("c"), makePlace("a")];
    const result = mergeUniquePlacesWithStats(current, incoming);
    expect(result.merged).toEqual([...current, makePlace("c")]);
    expect(result.addedCount).toBe(1);
    expect(result.duplicateCount).toBe(2);
  });

  it("incoming が空配列の場合は current をそのまま返し件数は0", () => {
    const current = [makePlace("a")];
    const result = mergeUniquePlacesWithStats(current, []);
    expect(result.merged).toEqual(current);
    expect(result.addedCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
  });

  it("同一placeIdの重複merge時にdiscovery.sourcesが統合される", () => {
    const current = [makeViewModel("a", "mainTextSearch")];
    const incoming = [makeViewModel("a", "keywordExploration")];

    const result = mergeUniquePlacesWithStats(current, incoming);

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.discovery).toEqual({
      sources: ["mainTextSearch", "keywordExploration"],
      firstSource: "mainTextSearch",
      sourceCount: 2,
    });
    expect(result.duplicateCount).toBe(1);
    expect(result.addedCount).toBe(0);
  });

  it("discovery.sourcesは重複しない (同じソースで再度見つかっても増えない)", () => {
    const current = [makeViewModel("a", "mainTextSearch")];
    const incoming = [makeViewModel("a", "mainTextSearch")];

    const result = mergeUniquePlacesWithStats(current, incoming);

    expect(result.merged[0]?.discovery.sources).toEqual(["mainTextSearch"]);
    expect(result.merged[0]?.discovery.sourceCount).toBe(1);
  });

  it("current側の順番を維持し、incomingの新規placeは後ろに追加される", () => {
    const current = [
      makeViewModel("a", "mainTextSearch"),
      makeViewModel("b", "mainTextSearch"),
    ];
    const incoming = [
      makeViewModel("b", "keywordExploration"),
      makeViewModel("c", "keywordExploration"),
    ];

    const result = mergeUniquePlacesWithStats(current, incoming);

    expect(result.merged.map((vm) => vm.place.placeId)).toEqual(["a", "b", "c"]);
    expect(result.merged[1]?.discovery.sourceCount).toBe(2);
    expect(result.merged[2]?.discovery).toEqual(createDiscoveryInfo("keywordExploration"));
    expect(result.addedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
  });

  it("mainTextSearch + nearbyExploration の重複merge時にdiscovery.sourcesが両方残る (sourceCount=2)", () => {
    const current = [makeViewModel("a", "mainTextSearch")];
    const incoming = [makeViewModel("a", "nearbyExploration")];

    const result = mergeUniquePlacesWithStats(current, incoming);

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.discovery).toEqual({
      sources: ["mainTextSearch", "nearbyExploration"],
      firstSource: "mainTextSearch",
      sourceCount: 2,
    });
    expect(result.duplicateCount).toBe(1);
    expect(result.addedCount).toBe(0);
  });

  it("元配列(current/incoming)を破壊しない", () => {
    const current = [makeViewModel("a", "mainTextSearch")];
    const incoming = [makeViewModel("a", "keywordExploration")];
    const currentSnapshot = JSON.parse(JSON.stringify(current));
    const incomingSnapshot = JSON.parse(JSON.stringify(incoming));

    mergeUniquePlacesWithStats(current, incoming);

    expect(current).toEqual(currentSnapshot);
    expect(incoming).toEqual(incomingSnapshot);
  });
});

describe("mergeUniquePlacesWithStats — incoming 内重複・不正入力 (L9)", () => {
  it("incoming 内に同一 placeId が重複し、かつ current に存在しない場合、重複は除去されず両件 merged に追加される (現状の動作を記録)", () => {
    // 実装は incoming 側の内部重複を deduplicate しない。
    // calling side (handleExplore) 側で重複が発生しないことを前提とした設計。
    const current = [makePlace("a")];
    const incoming = [makePlace("b"), makePlace("b")];
    const result = mergeUniquePlacesWithStats(current, incoming);
    expect(result.addedCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.merged).toHaveLength(3);
    expect(result.merged.map((p) => p.place.placeId)).toEqual(["a", "b", "b"]);
  });

  it("incoming 内に同一 placeId が重複し、かつ全件が current に存在する場合、重複は全件 duplicateCount に加算される", () => {
    const current = [makePlace("a")];
    const incoming = [makePlace("a"), makePlace("a")];
    const result = mergeUniquePlacesWithStats(current, incoming);
    expect(result.duplicateCount).toBe(2);
    expect(result.addedCount).toBe(0);
    expect(result.merged).toHaveLength(1);
  });

  it("incoming に placeId が空文字のアイテムが混在しても例外は発生しない", () => {
    const current = [makePlace("a")];
    const incoming = [makePlace("b"), makePlace("")];
    expect(() => mergeUniquePlacesWithStats(current, incoming)).not.toThrow();
    const result = mergeUniquePlacesWithStats(current, incoming);
    // 空文字 placeId は current の "a" にも存在しないため新規として追加される
    expect(result.addedCount).toBe(2);
    expect(result.merged).toHaveLength(3);
  });

  it("current と incoming がともに空配列のとき merged も空配列になる", () => {
    const result = mergeUniquePlacesWithStats([], []);
    expect(result.merged).toEqual([]);
    expect(result.addedCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
  });
});
