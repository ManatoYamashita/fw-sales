import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlaceById,
  getPlaceDetails,
  resolveSearchCenter,
  searchPlaces,
  searchPlacesPage,
} from "../google";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

/**
 * Place Details の URL からクエリを除いた部分を取り出す。
 * `buildPlaceDetailsUrl` は `languageCode` / `regionCode` をクエリで付けるため、
 * エンドポイントと placeId の検証はクエリと分けて行う。
 */
function detailsEndpointOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

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
    expect(detailsEndpointOf(url)).toBe(`${DETAILS_ENDPOINT}/ChIJfood`);
    expect(init.method).toBe("GET");
  });

  it("placeId が 'places/xxx' 形式の場合は二重に 'places/' を付けない", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceDetails("places/ChIJfood");

    const [url] = getFetchCall(fetchMock);
    expect(detailsEndpointOf(url)).toBe(`${DETAILS_ENDPOINT}/ChIJfood`);
  });

  /**
   * Place Details は GET のため body を持てず、以前は言語指定がどこにも無かった。
   * その結果、一覧に出る候補 (Text Search 由来、日本語) と `addStoreFromPlaceAction`
   * が保存する `stores` 行 (Place Details 由来、英語) が食い違い、ローマ字の
   * 店名・住所が DB に入っていた (2026-08-15 実測、1店舗)。
   * ローマ字住所は `extractPrefecture` / `extractCity` を空にし、さらに AI 店舗調査の
   * 店舗同定で店名・住所を**同時に**不一致にする common-mode failure を起こす。
   */
  it("languageCode=ja / regionCode=JP をクエリに付ける (ローマ字の店名・住所が保存されるのを防ぐ)", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceDetails("places/ChIJfood");

    const [url] = getFetchCall(fetchMock);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("languageCode")).toBe("ja");
    expect(parsed.searchParams.get("regionCode")).toBe("JP");
    // prefix 除去とクエリ付与が両立していること (id 側にクエリが埋もれない)。
    expect(detailsEndpointOf(url)).toBe(`${DETAILS_ENDPOINT}/ChIJfood`);
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

  it("必須フィールド (location) が欠けている場合は型付きエラーを投げる (#221 review)", async () => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ChIJfood",
        displayName: { text: "テスト居酒屋" },
        formattedAddress: "東京都渋谷区テスト1-1-1",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await getPlaceDetails("ChIJfood").then(
      () => {
        throw new Error("should have thrown");
      },
      (e: unknown) => e as Error,
    );

    // 素の `Error` で投げると上位の分類器が "unknown" へ落とし、再試行を促す
    // fallback 文言になってしまう (決定的な失敗なので誤誘導)。
    expect(err.name).toBe("PlacesIncompleteDataError");
    expect(err.message).toBe("店舗情報が不足しているため詳細を取得できませんでした");
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

/**
 * 呼び出し側から指定できる明示 timeout (runtime reliability hardening、F5)。
 *
 * 従来 `fetch` に `AbortSignal` が一切無く、Places が応答しない場合に呼び出し元
 * (特に AI 店舗調査の Stage0) が platform の Function 上限まで占有されうる状態だった。
 *
 * **後方互換が要件**: `timeoutMs` を渡さない既存呼び出し元 (`area-search-actions.ts` /
 * `url-parser/places-fallback.ts`) の挙動は 1 ミリも変えない = `signal` を渡さない。
 */
describe("timeoutMs オプション", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("getPlaceById: 未指定なら signal を渡さない(既存呼び出し元の挙動不変)", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceById("ChIJfood");

    const [, init] = getFetchCall(fetchMock);
    expect((init as { signal?: unknown }).signal).toBeUndefined();
  });

  it("getPlaceById: 指定すると AbortSignal を渡す", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(DETAILS_PLACE));
    vi.stubGlobal("fetch", fetchMock);

    await getPlaceById("ChIJfood", { timeoutMs: 15_000 });

    const [, init] = getFetchCall(fetchMock);
    expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
  });

  it("searchPlaces: 未指定なら signal を渡さない", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [FOOD_PLACE] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchPlaces("居酒屋", "渋谷");

    const [, init] = getFetchCall(fetchMock);
    expect((init as { signal?: unknown }).signal).toBeUndefined();
  });

  it("searchPlaces: 指定すると AbortSignal を渡す", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [FOOD_PLACE] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchPlaces("居酒屋", "渋谷", { timeoutMs: 15_000 });

    const [, init] = getFetchCall(fetchMock);
    expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
  });

  it("timeout 経過で fetch が abort される", async () => {
    // fetch 側は signal の abort をそのまま拒否として伝播する実装を模す。
    fetchMock = vi.fn().mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlaceById("ChIJfood", { timeoutMs: 1 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});

/**
 * Issue #201: Google の生レスポンス本文を Error へ載せない。
 *
 * 本文は `[places] request failed` の構造化ログが唯一の記録点で、そこから先
 * (Server Action の戻り値 → ユーザー UI) へは status のみが伝わる。
 */
describe("Places API エラーの sanitize (#201)", () => {
  const SECRET_BODY =
    '{"error":{"code":403,"message":"The caller does not have permission","details":["internal-project-42"]}}';
  const API_KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";

  let consoleSpy: ReturnType<typeof vi.spyOn>;

  function errorResponse(status: number, body: string): Response {
    return {
      ok: false,
      status,
      json: async () => JSON.parse(body),
      text: async () => body,
    } as unknown as Response;
  }

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    consoleSpy.mockRestore();
  });

  it.each([
    ["searchText", () => searchPlacesPage("居酒屋", "渋谷駅")],
    ["resolveCenter", () => resolveSearchCenter("渋谷駅")],
    ["placeDetails", () => getPlaceDetails("ChIJdetail")],
  ] as const)("%s: 生レスポンス本文が Error.message に含まれない", async (scope, call) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(403, SECRET_BODY)));

    const err = await call().then(
      () => {
        throw new Error("should have thrown");
      },
      (e: unknown) => e as Error,
    );

    expect(err.name).toBe("PlacesApiError");
    expect((err as Error & { status: number }).status).toBe(403);
    expect(err.message).toBe("Places API エラー (403)");
    expect(err.message).not.toContain("internal-project-42");
    expect(err.message).not.toContain("permission");

    // 本文はログにだけ残る (scope 付きで、どの呼び出しかを判別できる)
    expect(consoleSpy).toHaveBeenCalledWith(
      "[places] request failed",
      expect.objectContaining({ scope, status: 403 }),
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).toContain("internal-project-42");
  });

  it("ログへ載せる本文から API キーを伏せる", async () => {
    const body = `{"error":{"message":"API key ${API_KEY} is not valid"}}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(400, body)));

    await expect(searchPlacesPage("居酒屋", "渋谷駅")).rejects.toThrow("Places API エラー (400)");

    const logged = JSON.stringify(consoleSpy.mock.calls);
    expect(logged).not.toContain("AIzaSy");
    expect(logged).toContain("[REDACTED]");
    // 秘匿値以外の診断情報は残す
    expect(logged).toContain("is not valid");
  });

  it("ログへ載せる本文は 200 文字で切り詰める", async () => {
    const body = "x".repeat(5000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(500, body)));

    await expect(searchPlacesPage("居酒屋", "渋谷駅")).rejects.toThrow("Places API エラー (500)");

    const [, diagnostics] = consoleSpy.mock.calls[0] as [string, { bodyHead: string }];
    expect(diagnostics.bodyHead.endsWith("…(5000)")).toBe(true);
    expect(diagnostics.bodyHead.length).toBeLessThan(250);
  });

  it("本文の読み取りに失敗しても status 付きで throw する", async () => {
    const unreadable = {
      ok: false,
      status: 502,
      text: async () => {
        throw new Error("stream closed");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unreadable));

    await expect(searchPlacesPage("居酒屋", "渋谷駅")).rejects.toThrow("Places API エラー (502)");
    expect(consoleSpy).toHaveBeenCalledWith(
      "[places] request failed",
      expect.objectContaining({ status: 502, bodyHead: "" }),
    );
  });

  it("API キー未設定は専用のエラー型で、message は従来文言を保つ", async () => {
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", vi.fn());

    const err = await searchPlacesPage("居酒屋", "渋谷駅").then(
      () => {
        throw new Error("should have thrown");
      },
      (e: unknown) => e as Error,
    );

    expect(err.name).toBe("PlacesApiKeyMissingError");
    expect(err.message).toBe("GOOGLE_PLACES_API_KEY が設定されていません");
  });
});
