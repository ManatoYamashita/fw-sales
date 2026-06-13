/**
 * area-search-actions のユニットテスト (Issue #129 follow-up, H3)
 *
 * テスト方針:
 * - @/lib/places/google, @/lib/repositories, next/cache をモックして
 *   外部API・DB・Next cache を直接叩かない
 * - vi.hoisted でモック関数を定義し、vi.mock factory から参照する
 * - placeResultToStoreInput / placeResultToBasicInfo / attachStoreMatches /
 *   distanceMeters は純関数のため実装をそのまま使う
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceResult, PlaceSearchPage, SearchCenter } from "@/lib/places/types";
import type { Store } from "@/types/store";
import type { PlaceCandidate } from "@/types/place-candidate";

vi.mock("server-only", () => ({}));

const {
  mockSearchPlacesPage,
  mockResolveSearchCenter,
  mockGetPlaceById,
  mockGetPlaceDetails,
  mockStoreList,
  mockTransaction,
  mockRevalidateTag,
  mockUpsertPlaceCandidates,
  mockFindByGooglePlaceIds,
} = vi.hoisted(() => ({
  mockSearchPlacesPage: vi.fn(),
  mockResolveSearchCenter: vi.fn(),
  mockGetPlaceById: vi.fn(),
  mockGetPlaceDetails: vi.fn(),
  mockStoreList: vi.fn(),
  mockTransaction: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockUpsertPlaceCandidates: vi.fn(),
  mockFindByGooglePlaceIds: vi.fn(),
}));

vi.mock("@/lib/places/google", () => ({
  searchPlacesPage: mockSearchPlacesPage,
  resolveSearchCenter: mockResolveSearchCenter,
  getPlaceById: mockGetPlaceById,
  getPlaceDetails: mockGetPlaceDetails,
  searchPlaces: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { list: mockStoreList },
    placeCandidate: {
      upsertFromAreaSearch: mockUpsertPlaceCandidates,
      findByGooglePlaceIds: mockFindByGooglePlaceIds,
    },
    transaction: mockTransaction,
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

const {
  searchPlacesWithMatchesAction,
  bulkAddStoresFromPlacesAction,
  getPlaceDetailsForAreaSearchAction,
} = await import("../area-search-actions");

const CENTER: SearchCenter = { lat: 35.658, lng: 139.7016 };

function makePlace(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    placeId: "ChIJtest1",
    name: "テスト居酒屋",
    formattedAddress: "東京都渋谷区テスト1-1-1",
    lat: CENTER.lat,
    lng: CENTER.lng,
    phone: "",
    rating: null,
    userRatingsTotal: null,
    types: ["restaurant", "food"],
    googleMapsUri: null,
    ...overrides,
  };
}

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: "store-1",
    name: "既存店舗",
    lat: null,
    lng: null,
    google_place_id: null,
    ...overrides,
  } as Store;
}

function makeSearchPage(overrides: Partial<PlaceSearchPage> = {}): PlaceSearchPage {
  return {
    places: [makePlace()],
    nextPageToken: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockStoreList.mockResolvedValue([]);
  mockUpsertPlaceCandidates.mockResolvedValue({
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
  });
  mockFindByGooglePlaceIds.mockResolvedValue([]);
});

function makePlaceCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    id: "place_candidate_1",
    google_place_id: "ChIJtest1",
    status: "candidate",
    first_seen_at: "2026-06-01",
    last_seen_at: "2026-06-14",
    seen_count: 1,
    discovery_sources: ["mainTextSearch"],
    last_searched_keyword: "居酒屋",
    last_searched_area: "渋谷駅",
    last_center_lat: CENTER.lat,
    last_center_lng: CENTER.lng,
    last_radius_meters: 1000,
    last_distance_meters: 100,
    last_is_within_radius: true,
    matched_store_id: null,
    created_at: "2026-06-01",
    updated_at: "2026-06-14",
    ...overrides,
  };
}

describe("searchPlacesWithMatchesAction", () => {
  it("keyword が空の場合は failure を返す", async () => {
    const result = await searchPlacesWithMatchesAction("", "渋谷駅", 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/キーワード/);
    expect(mockResolveSearchCenter).not.toHaveBeenCalled();
    expect(mockSearchPlacesPage).not.toHaveBeenCalled();
  });

  it("keyword が空白のみの場合も failure を返す", async () => {
    const result = await searchPlacesWithMatchesAction("   ", "渋谷駅", 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/キーワード/);
  });

  it("centerQuery が空の場合は failure を返す", async () => {
    const result = await searchPlacesWithMatchesAction("居酒屋", "", 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/中心地点/);
    expect(mockResolveSearchCenter).not.toHaveBeenCalled();
    expect(mockSearchPlacesPage).not.toHaveBeenCalled();
  });

  it("resolveSearchCenter が null の場合、中心地点が見つからない旨の failure を返す", async () => {
    mockResolveSearchCenter.mockResolvedValue(null);

    const result = await searchPlacesWithMatchesAction("居酒屋", "存在しない場所xyz", 1000);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("中心地点「存在しない場所xyz」が見つかりませんでした");
    }
    expect(mockSearchPlacesPage).not.toHaveBeenCalled();
  });

  it("options.center 指定時は resolveSearchCenter を呼ばない", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    expect(mockResolveSearchCenter).not.toHaveBeenCalled();
  });

  it("searchPlacesPage が pageToken と locationBias={ center, radiusMeters } で呼ばれる", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());

    await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      pageToken: "next-token",
    });

    expect(mockSearchPlacesPage).toHaveBeenCalledWith("居酒屋", "渋谷駅", {
      pageToken: "next-token",
      locationBias: { center: CENTER, radiusMeters: 1000 },
    });
  });

  it("取得した places に distanceMeters が付与される", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    // 中心地点から少しずれた緯度経度 (約100m強)
    mockSearchPlacesPage.mockResolvedValue(
      makeSearchPage({ places: [makePlace({ lat: CENTER.lat + 0.001, lng: CENTER.lng })] }),
    );

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.distanceMeters).toBeGreaterThan(0);
      expect(Number.isFinite(vm?.distanceMeters)).toBe(true);
    }
  });

  it("isWithinRadius は中心地点と同座標・半径0mの境界値で true になる", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockResolvedValue(
      makeSearchPage({ places: [makePlace({ lat: CENTER.lat, lng: CENTER.lng })] }),
    );

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.distanceMeters).toBe(0);
      expect(vm?.isWithinRadius).toBe(true);
    }
  });

  it("isWithinRadius は半径を超える距離では false になる", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    // 緯度を約1.1度ずらす(120km超)ことで半径1000mを確実に超える
    mockSearchPlacesPage.mockResolvedValue(
      makeSearchPage({ places: [makePlace({ lat: CENTER.lat + 1, lng: CENTER.lng })] }),
    );

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.distanceMeters).toBeGreaterThan(1000);
      expect(vm?.isWithinRadius).toBe(false);
    }
  });

  it("searchPlacesPage が throw した場合は failure に変換される", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockRejectedValue(new Error("Places API エラー (500): boom"));

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Places API エラー (500): boom");
  });

  it("repos.store.list の結果から DB登録済み判定 (matchedStore) が反映される", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockResolvedValue(
      makeSearchPage({
        places: [
          makePlace({ placeId: "ChIJregistered", name: "登録済み店舗" }),
          makePlace({ placeId: "ChIJnew", name: "未登録店舗" }),
        ],
      }),
    );
    mockStoreList.mockResolvedValue([
      makeStore({ id: "store-1", name: "登録済み店舗", google_place_id: "ChIJregistered" }),
    ]);

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const registered = result.data.places.find((p) => p.place.placeId === "ChIJregistered");
      const notRegistered = result.data.places.find((p) => p.place.placeId === "ChIJnew");
      expect(registered?.matchedStore).toEqual({ id: "store-1", name: "登録済み店舗" });
      expect(notRegistered?.matchedStore).toBeNull();
    }
  });

  it("nextPageToken が action result に引き継がれる", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage({ nextPageToken: "page-2" }));

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.nextPageToken).toBe("page-2");
  });

  it("nextPageToken が無い場合は null を引き継ぐ", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage({ nextPageToken: null }));

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.nextPageToken).toBeNull();
  });

  it("初回検索 (centerQuery解決あり) の meta は apiCallEstimate=2", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockResolvedValue(
      makeSearchPage({ nextPageToken: "page-2" }),
    );

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.meta.apiCallEstimate).toBe(2);
      expect(result.data.meta.source).toBe("textSearch");
      expect(result.data.meta.provider).toBe("googlePlaces");
      expect(result.data.meta.maxResults).toBe(60);
      expect(result.data.meta.loadedCount).toBe(result.data.places.length);
      expect(result.data.meta.hasNextPage).toBe(true);
    }
  });

  it("options.center 指定 (もっと読み込む) の meta は apiCallEstimate=1, hasNextPage=false (nextPageTokenなし)", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage({ nextPageToken: null }));

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
      pageToken: "page-2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.meta.apiCallEstimate).toBe(1);
      expect(result.data.meta.hasNextPage).toBe(false);
      expect(result.data.meta.currentPageCount).toBe(1);
    }
    expect(mockResolveSearchCenter).not.toHaveBeenCalled();
  });

  it("初回検索 (pageToken/discoverySourceともに未指定) は discovery.sources=['mainTextSearch']", async () => {
    mockResolveSearchCenter.mockResolvedValue(CENTER);
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.discovery).toEqual({
        sources: ["mainTextSearch"],
        firstSource: "mainTextSearch",
        sourceCount: 1,
      });
    }
  });

  it("options.pageToken 指定 (もっと読み込む) は discovery.sources=['loadMore']", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
      pageToken: "page-2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.discovery.firstSource).toBe("loadMore");
    }
  });

  it("options.discoverySource を指定すると追加探索のソースが付与される", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());

    const result = await searchPlacesWithMatchesAction("酒場", "渋谷駅", 1000, {
      center: CENTER,
      discoverySource: "keywordExploration",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.discovery).toEqual({
        sources: ["keywordExploration"],
        firstSource: "keywordExploration",
        sourceCount: 1,
      });
    }
  });

  it("初回検索成功時に候補保存repositoryが呼ばれる", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    expect(mockUpsertPlaceCandidates).toHaveBeenCalledTimes(1);
    expect(mockUpsertPlaceCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: "居酒屋",
        area: "渋谷駅",
        center: CENTER,
        radiusMeters: 1000,
      }),
    );
  });

  it("もっと読み込み成功時に候補保存repositoryが呼ばれる", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
      pageToken: "page-2",
    });

    expect(result.ok).toBe(true);
    expect(mockUpsertPlaceCandidates).toHaveBeenCalledTimes(1);
  });

  it("保存に失敗しても検索自体は失敗させない", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());
    mockUpsertPlaceCandidates.mockRejectedValue(new Error("DB接続エラー"));

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidatePersistence).toBeUndefined();
    }
  });

  it("candidatePersistence がpayloadに含まれる場合は件数が返る", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage());
    mockUpsertPlaceCandidates.mockResolvedValue({
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidatePersistence).toEqual({
        insertedCount: 1,
        updatedCount: 0,
        skippedCount: 0,
      });
    }
  });

  it("検索結果にcandidateInfoが付与される", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage({ places: [makePlace({ placeId: "ChIJtest1" })] }));
    mockFindByGooglePlaceIds.mockResolvedValue([makePlaceCandidate({ google_place_id: "ChIJtest1" })]);

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.candidateInfo).toEqual({
        status: "candidate",
        seenCount: 1,
        firstSeenAt: "2026-06-01",
        lastSeenAt: "2026-06-14",
        discoverySources: ["mainTextSearch"],
      });
      expect(mockFindByGooglePlaceIds).toHaveBeenCalledWith(["ChIJtest1"]);
    }
  });

  it("候補が見つからない場合は candidateInfo: null", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage({ places: [makePlace({ placeId: "ChIJtest1" })] }));
    mockFindByGooglePlaceIds.mockResolvedValue([]);

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.candidateInfo).toBeNull();
    }
  });

  it("保存後に再取得された最新のseenCountがcandidateInfoに反映される", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage({ places: [makePlace({ placeId: "ChIJtest1" })] }));
    mockUpsertPlaceCandidates.mockResolvedValue({
      insertedCount: 0,
      updatedCount: 1,
      skippedCount: 0,
    });
    mockFindByGooglePlaceIds.mockResolvedValue([
      makePlaceCandidate({ google_place_id: "ChIJtest1", seen_count: 5 }),
    ]);

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.candidateInfo?.seenCount).toBe(5);
    }

    const upsertOrder = mockUpsertPlaceCandidates.mock.invocationCallOrder[0]!;
    const findOrder = mockFindByGooglePlaceIds.mock.invocationCallOrder[0]!;
    expect(upsertOrder).toBeLessThan(findOrder);
  });

  it("candidateInfo取得 (findByGooglePlaceIds) 失敗時も検索自体は成功する", async () => {
    mockSearchPlacesPage.mockResolvedValue(makeSearchPage({ places: [makePlace({ placeId: "ChIJtest1" })] }));
    mockFindByGooglePlaceIds.mockRejectedValue(new Error("DB接続エラー"));

    const result = await searchPlacesWithMatchesAction("居酒屋", "渋谷駅", 1000, {
      center: CENTER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [vm] = result.data.places;
      expect(vm?.candidateInfo).toBeNull();
    }
  });
});

describe("bulkAddStoresFromPlacesAction", () => {
  function mockTransactionCreate(name = "新規店舗") {
    mockTransaction.mockImplementation(
      async (fn: (tx: { store: { create: ReturnType<typeof vi.fn>; mergeBasicInfo: ReturnType<typeof vi.fn> } }) => Promise<unknown>) =>
        fn({
          store: {
            create: vi.fn().mockResolvedValue({ id: "new-store-id", name }),
            mergeBasicInfo: vi.fn().mockResolvedValue(undefined),
          },
        }),
    );
  }

  it("placeIds が空配列の場合は failure", async () => {
    const result = await bulkAddStoresFromPlacesAction([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/選択してください/);
    expect(mockGetPlaceById).not.toHaveBeenCalled();
  });

  it("deduplicatePlaceIds 後に0件 (空文字のみ) の場合は failure", async () => {
    const result = await bulkAddStoresFromPlacesAction(["", ""]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/選択してください/);
    expect(mockGetPlaceById).not.toHaveBeenCalled();
  });

  it("全件失敗時 (getPlaceById が null) は added=0 / failed=N で revalidateTag は呼ばれない", async () => {
    mockGetPlaceById.mockResolvedValue(null);

    const result = await bulkAddStoresFromPlacesAction(["ChIJfail1", "ChIJfail2"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.added).toBe(0);
      expect(result.data.failed).toBe(2);
      expect(result.data.failedPlaceIds).toEqual(["ChIJfail1", "ChIJfail2"]);
    }
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("部分失敗時に added / failed / failedPlaceIds / createdIds が正しく返る", async () => {
    mockGetPlaceById.mockImplementation(async (placeId: string) =>
      placeId === "ChIJok" ? makePlace({ placeId: "ChIJok", name: "成功店舗" }) : null,
    );
    mockTransactionCreate("成功店舗");

    const result = await bulkAddStoresFromPlacesAction(["ChIJok", "ChIJfail"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.added).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.createdIds).toEqual(["new-store-id"]);
      expect(result.data.failedPlaceIds).toEqual(["ChIJfail"]);
    }
    expect(mockRevalidateTag).toHaveBeenCalled();
  });

  it("重複する placeId が渡っても getPlaceById は重複除去後の1回だけ呼ばれる", async () => {
    mockGetPlaceById.mockResolvedValue(makePlace({ placeId: "ChIJdup", name: "重複店舗" }));
    mockTransactionCreate("重複店舗");

    const result = await bulkAddStoresFromPlacesAction(["ChIJdup", "ChIJdup", "ChIJdup"]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.added).toBe(1);
    expect(mockGetPlaceById).toHaveBeenCalledTimes(1);
  });

  it("成功時に revalidateTag が呼ばれる", async () => {
    mockGetPlaceById.mockResolvedValue(makePlace({ placeId: "ChIJok", name: "成功店舗" }));
    mockTransactionCreate("成功店舗");

    await bulkAddStoresFromPlacesAction(["ChIJok"]);

    expect(mockRevalidateTag).toHaveBeenCalled();
  });
});

describe("getPlaceDetailsForAreaSearchAction", () => {
  const DETAILS = {
    placeId: "ChIJdetail",
    name: "詳細店舗",
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
  };

  it("getPlaceDetails を呼ぶ", async () => {
    mockGetPlaceDetails.mockResolvedValue(DETAILS);

    await getPlaceDetailsForAreaSearchAction("ChIJdetail");

    expect(mockGetPlaceDetails).toHaveBeenCalledWith("ChIJdetail");
  });

  it("成功時に details を返す", async () => {
    mockGetPlaceDetails.mockResolvedValue(DETAILS);

    const result = await getPlaceDetailsForAreaSearchAction("ChIJdetail");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(DETAILS);
  });

  it("placeId が空文字の場合は failure を返す", async () => {
    const result = await getPlaceDetailsForAreaSearchAction("");

    expect(result.ok).toBe(false);
    expect(mockGetPlaceDetails).not.toHaveBeenCalled();
  });

  it("getPlaceDetails が例外を投げた場合は failure を返す", async () => {
    mockGetPlaceDetails.mockRejectedValue(new Error("Places API エラー (404): not found"));

    const result = await getPlaceDetailsForAreaSearchAction("ChIJdetail");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Places API エラー (404)");
  });
});
