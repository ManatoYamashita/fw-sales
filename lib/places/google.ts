import "server-only";
import type { PlaceResult, PlaceSearchPage, SearchCenter } from "./types";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const NEARBY_SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

// Text Search のフィールドマスクは "places.<field>" 形式。
// nextPageToken のみレスポンス直下のフィールドのため "places." プレフィックス無し。
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

// Nearby Search のフィールドマスクは "places.<field>" 形式。
// 手動の深掘り探索用のため、電話番号・評価・営業時間・レビュー等は取得しない (最小限)。
const NEARBY_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.googleMapsUri",
].join(",");

const NEARBY_DEFAULT_INCLUDED_TYPES = ["restaurant", "bar", "cafe"];
const NEARBY_DEFAULT_MAX_RESULT_COUNT = 20;

// Place Details のフィールドマスクは "places." プレフィックスなし
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "nationalPhoneNumber",
  "rating",
  "userRatingCount",
  "types",
  "googleMapsUri",
].join(",");

interface RawDisplayName {
  text: string;
  languageCode?: string;
}

interface RawLocation {
  latitude: number;
  longitude: number;
}

interface RawPlace {
  id: string;
  displayName?: RawDisplayName;
  formattedAddress?: string;
  location?: RawLocation;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  googleMapsUri?: string;
}

interface PlacesResponse {
  places?: RawPlace[];
  nextPageToken?: string;
}

const FOOD_TYPES: ReadonlySet<string> = new Set([
  "restaurant",
  "food",
  "cafe",
  "bar",
  "bakery",
  "ramen_restaurant",
  "sushi_restaurant",
  "japanese_restaurant",
  "italian_restaurant",
  "chinese_restaurant",
  "pizza_restaurant",
  "hamburger_restaurant",
]);

function isFoodPlace(types: string[]): boolean {
  return types.some((t) => FOOD_TYPES.has(t));
}

/**
 * 必須フィールドが揃っている RawPlace のみ PlaceResult に変換する。
 * id / displayName.text / formattedAddress / location のいずれかが欠けている場合は
 * null を返し、呼び出し側でフィルタアウトする。
 */
function toPlaceResult(raw: RawPlace): PlaceResult | null {
  if (
    !raw.id ||
    !raw.displayName?.text ||
    !raw.formattedAddress ||
    raw.location?.latitude === undefined ||
    raw.location?.longitude === undefined
  ) {
    return null;
  }
  return {
    placeId: raw.id,
    name: raw.displayName.text,
    formattedAddress: raw.formattedAddress,
    lat: raw.location.latitude,
    lng: raw.location.longitude,
    phone: raw.nationalPhoneNumber ?? "",
    rating: raw.rating ?? null,
    userRatingsTotal: raw.userRatingCount ?? null,
    types: raw.types ?? [],
    googleMapsUri: raw.googleMapsUri ?? null,
  };
}

export interface SearchPlacesPageOptions {
  /** 1ページあたりの最大件数 (1-20)。未指定時は20。 */
  pageSize?: number;
  /** 前ページのレスポンスで返された `nextPageToken`。未指定時は1ページ目を取得する。 */
  pageToken?: string;
  /**
   * 中心地点・半径による検索バイアス (`locationBias.circle`)。
   * 厳密な範囲制限ではないため、範囲外の候補が返ることがある。呼び出し側で
   * 距離計算による範囲内/範囲外判定を別途行うこと。
   * 「もっと読み込む」(`pageToken` 指定時) でも初回と同じ値を渡すこと
   * (Google側の仕様で検索条件を変えると `pageToken` が無効になる場合がある)。
   */
  locationBias?: {
    center: SearchCenter;
    radiusMeters: number;
  };
}

/**
 * Google Places API (New) Text Search を1ページ分呼び出す。
 *
 * ページングする場合、`textQuery` 等の検索条件は前回と同一のまま `pageToken` のみを
 * 追加してリクエストする (Google側の仕様)。`pageSize`/`pageToken` 以外の条件を変えると
 * `nextPageToken` が無効になる場合があるため、呼び出し側でも検索条件を変えないこと。
 */
export async function searchPlacesPage(
  keyword: string,
  area: string,
  options?: SearchPlacesPageOptions,
): Promise<PlaceSearchPage> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY が設定されていません");
  }

  const textQuery = [keyword.trim(), area.trim()].filter(Boolean).join(" ");

  const body: Record<string, unknown> = {
    textQuery,
    languageCode: "ja",
    pageSize: options?.pageSize ?? 20,
  };
  if (options?.locationBias) {
    body.locationBias = {
      circle: {
        center: {
          latitude: options.locationBias.center.lat,
          longitude: options.locationBias.center.lng,
        },
        radius: options.locationBias.radiusMeters,
      },
    };
  }
  if (options?.pageToken) {
    body.pageToken = options.pageToken;
  }

  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Places API エラー (${response.status}): ${text}`);
  }

  const data = (await response.json()) as PlacesResponse;
  const places: PlaceResult[] = [];
  for (const raw of data.places ?? []) {
    const place = toPlaceResult(raw);
    if (place && isFoodPlace(place.types)) {
      places.push(place);
    }
  }
  return { places, nextPageToken: data.nextPageToken ?? null };
}

/**
 * Google Places API (New) Text Search の1ページ目を呼び出し、`PlaceResult[]` のみを返す。
 * pagination 非対応の既存呼び出し元 (`places-fallback` 等) 向けの後方互換ラッパー。
 */
export async function searchPlaces(
  keyword: string,
  area: string,
): Promise<PlaceResult[]> {
  const { places } = await searchPlacesPage(keyword, area);
  return places;
}

export interface SearchNearbyPlacesOptions {
  /** 検索の中心地点。 */
  center: SearchCenter;
  /** 検索半径 (メートル)。`locationRestriction.circle.radius` に渡す。 */
  radiusMeters: number;
  /** 対象とする Place Type。未指定時は飲食店系のデフォルト3種。 */
  includedTypes?: string[];
  /** 取得件数の上限 (1-20)。未指定時は20。 */
  maxResultCount?: number;
  /** 並び順。未指定時は距離順 (`DISTANCE`)。 */
  rankPreference?: "DISTANCE" | "POPULARITY";
}

/**
 * Google Places API (New) Nearby Search を1回呼び出す (手動の深掘り探索用)。
 *
 * `locationRestriction.circle` で指定した範囲に厳密に絞り込む (Text Search の
 * `locationBias` とは異なり範囲外の候補は返らない)。フィールドマスクは最小限
 * (id/displayName/formattedAddress/location/types/googleMapsUri) のみとし、
 * 電話番号・評価・営業時間・レビュー等は取得しない。
 */
export async function searchNearbyPlaces(
  options: SearchNearbyPlacesOptions,
): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY が設定されていません");
  }

  const body = {
    includedTypes: options.includedTypes ?? NEARBY_DEFAULT_INCLUDED_TYPES,
    maxResultCount: options.maxResultCount ?? NEARBY_DEFAULT_MAX_RESULT_COUNT,
    rankPreference: options.rankPreference ?? "DISTANCE",
    locationRestriction: {
      circle: {
        center: {
          latitude: options.center.lat,
          longitude: options.center.lng,
        },
        radius: options.radiusMeters,
      },
    },
  };

  const response = await fetch(NEARBY_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": NEARBY_FIELD_MASK,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Places API エラー (${response.status}): ${text}`);
  }

  const data = (await response.json()) as PlacesResponse;
  const places: PlaceResult[] = [];
  for (const raw of data.places ?? []) {
    const place = toPlaceResult(raw);
    if (place && isFoodPlace(place.types)) {
      places.push(place);
    }
  }
  return places;
}

/**
 * 「中心地点」入力 (駅名・住所など) から緯度経度を解決する。
 *
 * Places Text Search の最初の候補の `location` を中心地点として採用する
 * (Geocoding API は別途有効化が必要なため、既存の Places API キーのみで完結させる)。
 * 飲食店以外の候補 (駅・ランドマーク等) も対象にするため `isFoodPlace` フィルタは適用しない。
 * `regionCode: "JP"` を指定し、同名の海外候補等への解決を避ける。
 *
 * 候補が見つからない場合は null を返す。
 */
export async function resolveSearchCenter(
  query: string,
): Promise<SearchCenter | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY が設定されていません");
  }

  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.location",
    },
    body: JSON.stringify({
      textQuery: trimmed,
      languageCode: "ja",
      regionCode: "JP",
      pageSize: 1,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Places API エラー (${response.status}): ${text}`);
  }

  const data = (await response.json()) as PlacesResponse;
  const location = data.places?.[0]?.location;
  if (!location) return null;
  return { lat: location.latitude, lng: location.longitude };
}

/**
 * placeId を指定して Google Places API から詳細を取得する。
 * addStoreFromPlaceAction がサーバー側でデータを再取得する際に使用する。
 * 必須フィールドが欠けている場合は null を返す。
 */
export async function getPlaceById(placeId: string): Promise<PlaceResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY が設定されていません");
  }

  const response = await fetch(`${DETAILS_ENDPOINT}/${encodeURIComponent(placeId)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Places API エラー (${response.status}): ${text}`);
  }

  const raw = (await response.json()) as RawPlace;
  return toPlaceResult(raw);
}
