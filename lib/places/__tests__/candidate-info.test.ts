import { describe, expect, it } from "vitest";
import {
  attachCandidateInfo,
  formatCandidateInfoLine,
  toAreaSearchCandidateInfo,
} from "../candidate-info";
import { createDiscoveryInfo } from "../discovery";
import type { AreaSearchPlaceViewModel } from "../types";
import type { PlaceCandidate } from "@/types/place-candidate";

function makeCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    id: "place_candidate_1",
    google_place_id: "ChIJtarget",
    status: "candidate",
    first_seen_at: "2026-06-01",
    last_seen_at: "2026-06-14",
    seen_count: 3,
    discovery_sources: ["mainTextSearch", "loadMore"],
    last_searched_keyword: "居酒屋",
    last_searched_area: "渋谷駅",
    last_center_lat: 35.658,
    last_center_lng: 139.7016,
    last_radius_meters: 1000,
    last_distance_meters: 100,
    last_is_within_radius: true,
    matched_store_id: null,
    created_at: "2026-06-01",
    updated_at: "2026-06-14",
    ...overrides,
  };
}

function makeViewModel(
  overrides: Partial<AreaSearchPlaceViewModel> = {},
): AreaSearchPlaceViewModel {
  const { place: placeOverrides, ...rest } = overrides;
  return {
    place: {
      placeId: "ChIJtarget",
      name: "テスト居酒屋",
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
    discovery: createDiscoveryInfo("mainTextSearch"),
    candidateInfo: null,
    ...rest,
  };
}

describe("toAreaSearchCandidateInfo", () => {
  it("PlaceCandidate を AreaSearchCandidateInfo に変換する", () => {
    const candidate = makeCandidate();

    expect(toAreaSearchCandidateInfo(candidate)).toEqual({
      status: "candidate",
      seenCount: 3,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch", "loadMore"],
    });
  });
});

describe("attachCandidateInfo", () => {
  it("google_place_id が一致する候補の情報を付与する", () => {
    const viewModels = [makeViewModel()];
    const candidates = [makeCandidate({ google_place_id: "ChIJtarget" })];

    const result = attachCandidateInfo(viewModels, candidates);

    expect(result[0]?.candidateInfo).toEqual({
      status: "candidate",
      seenCount: 3,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch", "loadMore"],
    });
  });

  it("一致する候補が無い場合は candidateInfo: null", () => {
    const viewModels = [makeViewModel({ place: { placeId: "ChIJother" } as never })];
    const candidates = [makeCandidate({ google_place_id: "ChIJtarget" })];

    const result = attachCandidateInfo(viewModels, candidates);

    expect(result[0]?.candidateInfo).toBeNull();
  });

  it("candidates が空配列の場合は全件 candidateInfo: null", () => {
    const viewModels = [makeViewModel(), makeViewModel({ place: { placeId: "ChIJother" } as never })];

    const result = attachCandidateInfo(viewModels, []);

    expect(result.every((vm) => vm.candidateInfo === null)).toBe(true);
  });

  it("元のviewModelを破壊しない", () => {
    const viewModels = [makeViewModel()];
    const candidates = [makeCandidate({ google_place_id: "ChIJtarget" })];

    attachCandidateInfo(viewModels, candidates);

    expect(viewModels[0]?.candidateInfo).toBeNull();
  });
});

describe("formatCandidateInfoLine", () => {
  it("candidateInfo が null の場合は null を返す", () => {
    expect(formatCandidateInfoLine(null)).toBeNull();
  });

  it("status が candidate の場合は発見回数・最終発見日を含む", () => {
    const line = formatCandidateInfoLine({
      status: "candidate",
      seenCount: 3,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch"],
    });

    expect(line).toContain("過去発見済み");
    expect(line).toContain("発見3回");
    expect(line).toContain("2026/06/14");
  });

  it("status が added の場合は「候補DB: 追加済み」を含む", () => {
    const line = formatCandidateInfoLine({
      status: "added",
      seenCount: 1,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch"],
    });

    expect(line).toContain("候補DB: 追加済み");
  });

  it("status が ignored の場合は「過去に除外済み」を返す", () => {
    const line = formatCandidateInfoLine({
      status: "ignored",
      seenCount: 1,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch"],
    });

    expect(line).toBe("過去に除外済み");
  });

  it("status が ignored の場合はseenCountに関係なく「過去に除外済み」を返す", () => {
    const line = formatCandidateInfoLine({
      status: "ignored",
      seenCount: 5,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch"],
    });

    expect(line).toBe("過去に除外済み");
  });

  it("status が added の場合はseenCountに関係なく「候補DB: 追加済み」を返す", () => {
    const line = formatCandidateInfoLine({
      status: "added",
      seenCount: 5,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch"],
    });

    expect(line).toBe("候補DB: 追加済み");
  });

  it("status が stale の場合は「候補DB: 期限切れ」を返す", () => {
    const line = formatCandidateInfoLine({
      status: "stale",
      seenCount: 5,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch"],
    });

    expect(line).toBe("候補DB: 期限切れ");
  });

  it("status が candidate かつ seenCount === 1 の場合は「候補DB保存済み」を返す", () => {
    const line = formatCandidateInfoLine({
      status: "candidate",
      seenCount: 1,
      firstSeenAt: "2026-06-01",
      lastSeenAt: "2026-06-14",
      discoverySources: ["mainTextSearch"],
    });

    expect(line).toBe("候補DB保存済み");
  });
});
