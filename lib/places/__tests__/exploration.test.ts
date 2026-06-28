import { describe, expect, it } from "vitest";
import {
  buildExplorationRunId,
  recomputeViewModel,
  suggestExplorationCenters,
  suggestExplorationKeywords,
  suggestLargerRadii,
} from "../exploration";
import type { AreaSearchCandidateInfo, AreaSearchPlaceViewModel } from "../types";

function makeViewModel(lat: number, lng: number): AreaSearchPlaceViewModel {
  return {
    place: {
      placeId: "p1",
      name: "テスト店舗",
      formattedAddress: "",
      lat,
      lng,
      phone: "",
      rating: null,
      userRatingsTotal: null,
      types: [],
      googleMapsUri: null,
    },
    matchedStore: null,
    distanceMeters: 0,
    isWithinRadius: true,
    discovery: { sources: ["mainTextSearch"], firstSource: "mainTextSearch", sourceCount: 1 },
    candidateInfo: null,
  };
}

describe("suggestExplorationKeywords", () => {
  it("「居酒屋」を含むキーワードは近縁ジャンルを返す", () => {
    const result = suggestExplorationKeywords("居酒屋");
    expect(result).toContain("酒場");
    expect(result).toContain("焼き鳥");
    expect(result).not.toContain("居酒屋");
  });

  it("「居酒屋」を含まないキーワードは汎用候補を返す", () => {
    const result = suggestExplorationKeywords("カフェ");
    expect(result).toContain("居酒屋");
    expect(result).not.toContain("カフェ");
  });

  it("現在のキーワードと完全一致する候補は除外する", () => {
    const result = suggestExplorationKeywords("バー");
    expect(result).not.toContain("バー");
  });
});

describe("suggestExplorationCenters", () => {
  it("「渋谷」を含む中心地点は周辺地点候補を返す", () => {
    const result = suggestExplorationCenters("渋谷駅");
    expect(result).toContain("道玄坂");
    expect(result).toContain("宇田川町");
  });

  it("候補に現在の中心地点と同名のものがあれば除外する", () => {
    const result = suggestExplorationCenters("道玄坂");
    expect(result).not.toContain("道玄坂");
  });

  it("該当エリアが無い中心地点は空配列を返す", () => {
    expect(suggestExplorationCenters("新宿駅")).toEqual([]);
  });
});

describe("suggestLargerRadii", () => {
  it("500mのとき1km/2km/3kmを返す", () => {
    expect(suggestLargerRadii(500)).toEqual([1000, 2000, 3000]);
  });

  it("1kmのとき2km/3kmを返す", () => {
    expect(suggestLargerRadii(1000)).toEqual([2000, 3000]);
  });

  it("2kmのとき3kmを返す", () => {
    expect(suggestLargerRadii(2000)).toEqual([3000]);
  });

  it("3kmのとき空配列を返す", () => {
    expect(suggestLargerRadii(3000)).toEqual([]);
  });
});

describe("buildExplorationRunId", () => {
  it("種別・キーワード・中心地点・半径からIDを組み立てる", () => {
    expect(buildExplorationRunId("keyword", "酒場", "渋谷駅", 1000)).toBe(
      "keyword:酒場:渋谷駅:1000",
    );
  });

  it("前後の空白を取り除く", () => {
    expect(buildExplorationRunId("center", " 道玄坂 ", " 渋谷駅 ", 1000)).toBe(
      "center:道玄坂:渋谷駅:1000",
    );
  });

  it("同じ条件は同じIDになる (重複実行検出に使える)", () => {
    const a = buildExplorationRunId("radius", "居酒屋", "渋谷駅", 2000);
    const b = buildExplorationRunId("radius", "居酒屋", "渋谷駅", 2000);
    expect(a).toBe(b);
  });

  it("種別が異なれば別のIDになる", () => {
    const a = buildExplorationRunId("keyword", "居酒屋", "渋谷駅", 1000);
    const b = buildExplorationRunId("center", "居酒屋", "渋谷駅", 1000);
    expect(a).not.toBe(b);
  });
});

describe("recomputeViewModel", () => {
  it("中心地点と同じ座標なら距離0・範囲内になる", () => {
    const vm = makeViewModel(35.658, 139.7016);
    const result = recomputeViewModel(vm, { lat: 35.658, lng: 139.7016 }, 1000);
    expect(result.distanceMeters).toBeCloseTo(0, 5);
    expect(result.isWithinRadius).toBe(true);
  });

  it("半径を超える距離なら範囲外になる", () => {
    // 渋谷駅(35.658, 139.7016)から新宿駅(35.6896, 139.6917)は約3.4km
    const vm = makeViewModel(35.6896, 139.6917);
    const result = recomputeViewModel(vm, { lat: 35.658, lng: 139.7016 }, 1000);
    expect(result.distanceMeters).toBeGreaterThan(1000);
    expect(result.isWithinRadius).toBe(false);
  });

  it("同じ中心地点で半径だけ広げると範囲内になる場合がある", () => {
    const vm = makeViewModel(35.6896, 139.6917);
    const center = { lat: 35.658, lng: 139.7016 };
    const narrow = recomputeViewModel(vm, center, 1000);
    const wide = recomputeViewModel(vm, center, 5000);
    expect(narrow.isWithinRadius).toBe(false);
    expect(wide.isWithinRadius).toBe(true);
    // 距離自体は中心地点が同じなので変わらない
    expect(wide.distanceMeters).toBeCloseTo(narrow.distanceMeters, 5);
  });

  it("元のオブジェクトを変更せず新しいオブジェクトを返す", () => {
    const vm = makeViewModel(35.6896, 139.6917);
    const result = recomputeViewModel(vm, { lat: 35.658, lng: 139.7016 }, 1000);
    expect(result).not.toBe(vm);
    expect(vm.distanceMeters).toBe(0);
  });

  it("matchedStore が非null の場合でも再計算後に保持される (L8)", () => {
    const matchedStore = { id: "store-1", name: "既存店舗" };
    const vm: AreaSearchPlaceViewModel = {
      ...makeViewModel(35.6896, 139.6917),
      matchedStore,
    };
    const result = recomputeViewModel(vm, { lat: 35.658, lng: 139.7016 }, 1000);
    expect(result.matchedStore).toBe(matchedStore);
    // distanceMeters/isWithinRadius だけ変わり、他フィールドは同一参照で維持される
    expect(result.place).toBe(vm.place);
    expect(result.discovery).toBe(vm.discovery);
  });

  it("candidateInfo が非null の場合でも再計算後に保持される", () => {
    const candidateInfo: AreaSearchCandidateInfo = {
      status: "candidate",
      seenCount: 2,
      firstSeenAt: "2026-01-01",
      lastSeenAt: "2026-06-01",
      discoverySources: ["mainTextSearch"],
    };
    const vm: AreaSearchPlaceViewModel = {
      ...makeViewModel(35.6896, 139.6917),
      candidateInfo,
    };
    const result = recomputeViewModel(vm, { lat: 35.658, lng: 139.7016 }, 1000);
    expect(result.candidateInfo).toBe(candidateInfo);
  });
});
