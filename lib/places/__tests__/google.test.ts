import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlaceDetails,
  resolveSearchCenter,
  searchNearbyPlaces,
  searchPlacesPage,
} from "../google";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const NEARBY_SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface FetchInit {
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

/** `vi.fn()` でモックした fetch の N 回目の呼び出し引数を取得する。 */
function getFetchCall(
  fetchMock: ReturnType<typeof vi.fn>,
  index = 0,
): [string, FetchInit] {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`fetch was not called (call index: ${index})`);
  return call as [string, FetchInit];
}

function getRequestBody(
  fetchMock: ReturnType<typeof vi.fn>,
  index = 0,
): Record<string, unknown> {
  const [, init] = getFetchCall(fetchMock, index);
  return JSON.parse(init.body ?? "{}") as Record<string, unknown>;
}

const FOOD_PLACE = {
  id: "ChIJfood",
  displayName: { text: "テスト居酒屋" },
  formattedAddress: "東京都渋谷区テスト1-1-1",
  location: { latitude: 35.6595, longitude: 139.7005 },
  types: ["restaurant", "food"],
};

describe("searchPlacesPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [FOOD_PLACE], nextPageToken: "next-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("locationBias.circle に center (latitude/longitude) と radius を正しく設定する", async () => {
    await searchPlacesPage("居酒屋", "渋谷駅", {
      locationBias: { center: { lat: 35.6595, lng: 139.7005 }, radiusMeters: 1000 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = getFetchCall(fetchMock);
    expect(url).toBe(SEARCH_ENDPOINT);
    const body = getRequestBody(fetchMock);
    expect(body.locationBias).toEqual({
      circle: {
        center: { latitude: 35.6595, longitude: 139.7005 },
        radius: 1000,
      },
    });
    expect(body.pageSize).toBe(20);
    expect(body.textQuery).toBe("居酒屋 渋谷駅");
    expect(init.headers["X-Goog-FieldMask"]).toContain("places.location");
    expect(init.headers["X-Goog-FieldMask"]).toContain("nextPageToken");
  });

  it("pageToken 指定時も同じ textQuery/locationBias/pageSize を送る (条件不一致によるINVALID_ARGUMENT回避)", async () => {
    const center = { lat: 35.6595, lng: 139.7005 };

    await searchPlacesPage("居酒屋", "渋谷駅", {
      locationBias: { center, radiusMeters: 1000 },
    });
    const firstBody = getRequestBody(fetchMock, 0);

    await searchPlacesPage("居酒屋", "渋谷駅", {
      pageToken: "next-token",
      locationBias: { center, radiusMeters: 1000 },
    });
    const secondBody = getRequestBody(fetchMock, 1);

    // pageToken 以外は完全に同一であること
    expect(secondBody.pageToken).toBe("next-token");
    expect(firstBody.pageToken).toBeUndefined();
    const firstRest = { ...firstBody };
    const secondRest = { ...secondBody };
    delete firstRest.pageToken;
    delete secondRest.pageToken;
    expect(secondRest).toEqual(firstRest);
  });

  it("locationBias 未指定時はリクエストボディに含めない", async () => {
    await searchPlacesPage("居酒屋", "渋谷駅");
    const body = getRequestBody(fetchMock);
    expect(body.locationBias).toBeUndefined();
  });
});

describe("searchPlacesPage レスポンス解釈", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("food系 place (例: restaurant) は戻り値に含まれる", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [FOOD_PLACE], nextPageToken: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { places } = await searchPlacesPage("居酒屋", "渋谷駅");

    expect(places).toHaveLength(1);
    expect(places[0]?.placeId).toBe("ChIJfood");
  });

  it("lodging など非food typesのみの place は除外される", async () => {
    const LODGING_PLACE = {
      id: "ChIJhotel",
      displayName: { text: "テストホテル" },
      formattedAddress: "東京都渋谷区テスト2-2-2",
      location: { latitude: 35.66, longitude: 139.701 },
      types: ["lodging", "point_of_interest"],
    };
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [FOOD_PLACE, LODGING_PLACE], nextPageToken: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { places } = await searchPlacesPage("居酒屋", "渋谷駅");

    expect(places).toHaveLength(1);
    expect(places.find((p) => p.placeId === "ChIJhotel")).toBeUndefined();
  });

  it("id が欠落した raw place はスキップされる", async () => {
    const NO_ID_PLACE = {
      displayName: { text: "ID無し店舗" },
      formattedAddress: "東京都渋谷区テスト3-3-3",
      location: { latitude: 35.66, longitude: 139.701 },
      types: ["restaurant"],
    };
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [NO_ID_PLACE, FOOD_PLACE], nextPageToken: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { places } = await searchPlacesPage("居酒屋", "渋谷駅");

    expect(places).toHaveLength(1);
    expect(places[0]?.placeId).toBe("ChIJfood");
  });

  it("displayName / formattedAddress / location のいずれかが欠落した raw place は安全にスキップされる", async () => {
    const NO_DISPLAY_NAME = {
      id: "ChIJnoName",
      formattedAddress: "東京都渋谷区テスト4-4-4",
      location: { latitude: 35.66, longitude: 139.701 },
      types: ["restaurant"],
    };
    const NO_ADDRESS = {
      id: "ChIJnoAddress",
      displayName: { text: "住所無し店舗" },
      location: { latitude: 35.66, longitude: 139.701 },
      types: ["restaurant"],
    };
    const NO_LOCATION = {
      id: "ChIJnoLocation",
      displayName: { text: "位置情報無し店舗" },
      formattedAddress: "東京都渋谷区テスト5-5-5",
      types: ["restaurant"],
    };
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [NO_DISPLAY_NAME, NO_ADDRESS, NO_LOCATION, FOOD_PLACE],
        nextPageToken: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { places } = await searchPlacesPage("居酒屋", "渋谷駅");

    expect(places).toHaveLength(1);
    expect(places[0]?.placeId).toBe("ChIJfood");
  });

  it("nextPageToken がレスポンスに無い場合は null に正規化される", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [FOOD_PLACE] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { nextPageToken } = await searchPlacesPage("居酒屋", "渋谷駅");

    expect(nextPageToken).toBeNull();
  });

  it("response.ok=false の場合は例外を投げる", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid" }, false, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchPlacesPage("居酒屋", "渋谷駅")).rejects.toThrow(/Places API エラー \(400\)/);
  });

  it("GOOGLE_PLACES_API_KEY が未設定の場合は例外を投げる", async () => {
    vi.unstubAllEnvs();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchPlacesPage("居酒屋", "渋谷駅")).rejects.toThrow(
      "GOOGLE_PLACES_API_KEY が設定されていません",
    );
  });
});

describe("searchNearbyPlaces", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const CENTER = { lat: 35.6595, lng: 139.7005 };

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [FOOD_PLACE] }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("places:searchNearby に POST する", async () => {
    await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = getFetchCall(fetchMock);
    expect(url).toBe(NEARBY_SEARCH_ENDPOINT);
  });

  it("includedTypes/maxResultCount/rankPreference/locationRestriction.circle をボディに設定する", async () => {
    await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    const body = getRequestBody(fetchMock);
    expect(body.includedTypes).toEqual(["restaurant", "bar", "cafe"]);
    expect(body.maxResultCount).toBe(20);
    expect(body.rankPreference).toBe("DISTANCE");
    expect(body.locationRestriction).toEqual({
      circle: {
        center: { latitude: CENTER.lat, longitude: CENTER.lng },
        radius: 1000,
      },
    });
  });

  it("X-Goog-FieldMask は最小限のフィールドのみ含む", async () => {
    await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    const [, init] = getFetchCall(fetchMock);
    const fieldMask = init.headers["X-Goog-FieldMask"];
    expect(fieldMask).toBe(
      "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri",
    );
    expect(fieldMask).not.toContain("nationalPhoneNumber");
    expect(fieldMask).not.toContain("rating");
    expect(fieldMask).not.toContain("userRatingCount");
    expect(fieldMask).not.toContain("websiteUri");
    expect(fieldMask).not.toContain("currentOpeningHours");
    expect(fieldMask).not.toContain("reviews");
  });

  it("response.ok=false の場合は例外を投げる", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid" }, false, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 }),
    ).rejects.toThrow(/Places API エラー \(400\)/);
  });

  it("GOOGLE_PLACES_API_KEY が未設定の場合は例外を投げる", async () => {
    vi.unstubAllEnvs();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 }),
    ).rejects.toThrow("GOOGLE_PLACES_API_KEY が設定されていません");
  });

  it("必須フィールドが欠落した raw place はスキップされる", async () => {
    const NO_LOCATION = {
      id: "ChIJnoLocation",
      displayName: { text: "位置情報無し店舗" },
      formattedAddress: "東京都渋谷区テスト5-5-5",
      types: ["restaurant"],
    };
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [NO_LOCATION, FOOD_PLACE] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const places = await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    expect(places).toHaveLength(1);
    expect(places[0]?.placeId).toBe("ChIJfood");
  });

  it("food系typesのみ戻り値に含まれる (lodgingなどは除外)", async () => {
    const LODGING_PLACE = {
      id: "ChIJhotel",
      displayName: { text: "テストホテル" },
      formattedAddress: "東京都渋谷区テスト2-2-2",
      location: { latitude: 35.66, longitude: 139.701 },
      types: ["lodging", "point_of_interest"],
    };
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [FOOD_PLACE, LODGING_PLACE] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const places = await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    expect(places).toHaveLength(1);
    expect(places[0]?.placeId).toBe("ChIJfood");
  });

  it("rating/userRatingCountを取得しないため rating=null, userRatingsTotal=null になる", async () => {
    const places = await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    expect(places[0]?.rating).toBeNull();
    expect(places[0]?.userRatingsTotal).toBeNull();
    expect(places[0]?.phone).toBe("");
  });

  it("location が正しく PlaceResult の lat/lng にマッピングされる", async () => {
    const places = await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    expect(places[0]?.lat).toBe(FOOD_PLACE.location.latitude);
    expect(places[0]?.lng).toBe(FOOD_PLACE.location.longitude);
  });

  it("types が無い raw place は food判定できないためスキップされる", async () => {
    const NO_TYPES = {
      id: "ChIJnoTypes",
      displayName: { text: "種別無し店舗" },
      formattedAddress: "東京都渋谷区テスト6-6-6",
      location: { latitude: 35.66, longitude: 139.701 },
    };
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ places: [NO_TYPES, FOOD_PLACE] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const places = await searchNearbyPlaces({ center: CENTER, radiusMeters: 1000 });

    expect(places).toHaveLength(1);
    expect(places[0]?.placeId).toBe("ChIJfood");
  });
});

describe("resolveSearchCenter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("空文字の場合は fetch を呼ばずに null を返す", async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveSearchCenter("")).toBeNull();
    expect(await resolveSearchCenter("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("最初の候補の location を中心地点として返す (pageSize:1, fieldMask: places.location)", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [{ location: { latitude: 35.658, longitude: 139.7016 } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const center = await resolveSearchCenter("渋谷駅");
    expect(center).toEqual({ lat: 35.658, lng: 139.7016 });

    const [url, init] = getFetchCall(fetchMock);
    expect(url).toBe(SEARCH_ENDPOINT);
    expect(init.headers["X-Goog-FieldMask"]).toBe("places.location");
    const body = getRequestBody(fetchMock);
    expect(body.pageSize).toBe(1);
    expect(body.textQuery).toBe("渋谷駅");
    expect(body.regionCode).toBe("JP");
  });

  it("候補が0件の場合は null を返す", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveSearchCenter("存在しない場所xyz")).toBeNull();
  });

  it("places フィールド自体が無い場合も null を返す", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveSearchCenter("存在しない場所xyz")).toBeNull();
  });

  it("APIエラー時は例外を投げる", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "invalid" }, false, 400),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSearchCenter("渋谷駅")).rejects.toThrow(/Places API エラー \(400\)/);
  });

  it("GOOGLE_PLACES_API_KEY が未設定の場合は例外を投げる", async () => {
    vi.unstubAllEnvs();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSearchCenter("渋谷駅")).rejects.toThrow(
      "GOOGLE_PLACES_API_KEY が設定されていません",
    );
  });
});

const DETAILS_PLACE = {
  id: "ChIJfood",
  displayName: { text: "テスト居酒屋" },
  formattedAddress: "東京都渋谷区テスト1-1-1",
  location: { latitude: 35.6595, longitude: 139.7005 },
  types: ["restaurant", "food"],
  googleMapsUri: "https://maps.google.com/?cid=123",
  nationalPhoneNumber: "03-1234-5678",
  rating: 4.1,
  userRatingCount: 120,
  websiteUri: "https://example.com",
  businessStatus: "OPERATIONAL",
};

describe("getPlaceDetails", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("places/{PLACE_ID} にGETする", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceDetails("ChIJfood");

    const [url, init] = getFetchCall(fetchMock);
    expect(url).toBe(`${DETAILS_ENDPOINT}/ChIJfood`);
    expect(init.method).toBe("GET");
  });

  it("placeId が 'places/xxx' 形式の場合は二重に 'places/' を付けない", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceDetails("places/ChIJfood");

    const [url] = getFetchCall(fetchMock);
    expect(url).toBe(`${DETAILS_ENDPOINT}/ChIJfood`);
  });

  it("X-Goog-FieldMask が正しい", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceDetails("ChIJfood");

    const [, init] = getFetchCall(fetchMock);
    const fieldMask = init.headers["X-Goog-FieldMask"];
    expect(fieldMask).toBe(
      "id,displayName,formattedAddress,location,types,googleMapsUri,nationalPhoneNumber,rating,userRatingCount,websiteUri,businessStatus",
    );
  });

  it("FieldMask に nationalPhoneNumber / rating / userRatingCount / websiteUri / businessStatus が含まれる", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceDetails("ChIJfood");

    const [, init] = getFetchCall(fetchMock);
    const fields = (init.headers["X-Goog-FieldMask"] ?? "").split(",");
    expect(fields).toEqual(
      expect.arrayContaining([
        "nationalPhoneNumber",
        "rating",
        "userRatingCount",
        "websiteUri",
        "businessStatus",
      ]),
    );
  });

  it("FieldMask に reviews / photos / currentOpeningHours / regularOpeningHours が含まれない", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceDetails("ChIJfood");

    const [, init] = getFetchCall(fetchMock);
    const fields = (init.headers["X-Goog-FieldMask"] ?? "").split(",");
    expect(fields).not.toContain("reviews");
    expect(fields).not.toContain("photos");
    expect(fields).not.toContain("currentOpeningHours");
    expect(fields).not.toContain("regularOpeningHours");
  });

  it("GOOGLE_PLACES_API_KEY が未設定の場合は例外を投げる", async () => {
    vi.unstubAllEnvs();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlaceDetails("ChIJfood")).rejects.toThrow(
      "GOOGLE_PLACES_API_KEY が設定されていません",
    );
  });

  it("response.ok=false の場合は例外を投げる", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid" }, false, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlaceDetails("ChIJfood")).rejects.toThrow(/Places API エラー \(404\)/);
  });

  it("必須フィールド (location) が欠けている場合は例外を投げる", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ChIJfood",
        displayName: { text: "テスト居酒屋" },
        formattedAddress: "東京都渋谷区テスト1-1-1",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlaceDetails("ChIJfood")).rejects.toThrow();
  });

  it("nationalPhoneNumber がない場合 phone は空文字になる", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ChIJfood",
        displayName: { text: "テスト居酒屋" },
        formattedAddress: "東京都渋谷区テスト1-1-1",
        location: { latitude: 35.6595, longitude: 139.7005 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const details = await getPlaceDetails("ChIJfood");
    expect(details.phone).toBe("");
  });

  it("rating/userRatingCount がない場合 null になる", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ChIJfood",
        displayName: { text: "テスト居酒屋" },
        formattedAddress: "東京都渋谷区テスト1-1-1",
        location: { latitude: 35.6595, longitude: 139.7005 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const details = await getPlaceDetails("ChIJfood");
    expect(details.rating).toBeNull();
    expect(details.userRatingsTotal).toBeNull();
  });

  it("websiteUri/businessStatus がない場合 null になる", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ChIJfood",
        displayName: { text: "テスト居酒屋" },
        formattedAddress: "東京都渋谷区テスト1-1-1",
        location: { latitude: 35.6595, longitude: 139.7005 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const details = await getPlaceDetails("ChIJfood");
    expect(details.websiteUri).toBeNull();
    expect(details.businessStatus).toBeNull();
  });

  it("取得した値をPlaceDetailsResultにマッピングする", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    const details = await getPlaceDetails("ChIJfood");
    expect(details).toEqual({
      placeId: "ChIJfood",
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
    });
  });
});
