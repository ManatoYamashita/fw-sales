import "server-only";
import type { PlaceDetailsResult, PlaceResult, PlaceSearchPage, SearchCenter } from "./types";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
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

// Place Details オンデマンド取得用のフィールドマスク (Issue #104 follow-up)。
// 一覧検索やNearby Searchでは取得しない電話番号・Webサイト・評価・口コミ数・営業状態を追加で取得する。
// reviews/photos/currentOpeningHours/regularOpeningHours等の重いフィールドは含めない。
const PLACE_DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "googleMapsUri",
  "nationalPhoneNumber",
  "rating",
  "userRatingCount",
  "websiteUri",
  "businessStatus",
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
  websiteUri?: string;
  businessStatus?: string;
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
 * RawPlace が PlaceResult/PlaceDetailsResult への変換に必要な必須フィールド
 * (id / displayName.text / formattedAddress / location) を持っているかを判定する。
 */
function hasRequiredPlaceFields(raw: RawPlace): boolean {
  return (
    !!raw.id &&
    !!raw.displayName?.text &&
    !!raw.formattedAddress &&
    raw.location?.latitude !== undefined &&
    raw.location?.longitude !== undefined
  );
}

/**
 * 必須フィールドが揃っている RawPlace のみ PlaceResult に変換する。
 * id / displayName.text / formattedAddress / location のいずれかが欠けている場合は
 * null を返し、呼び出し側でフィルタアウトする。
 */
function toPlaceResult(raw: RawPlace): PlaceResult | null {
  if (!hasRequiredPlaceFields(raw)) {
    return null;
  }
  return {
    placeId: raw.id,
    name: raw.displayName!.text,
    formattedAddress: raw.formattedAddress!,
    lat: raw.location!.latitude,
    lng: raw.location!.longitude,
    phone: raw.nationalPhoneNumber ?? "",
    rating: raw.rating ?? null,
    userRatingsTotal: raw.userRatingCount ?? null,
    types: raw.types ?? [],
    googleMapsUri: raw.googleMapsUri ?? null,
  };
}

/**
 * Places API 呼び出しの明示 timeout (runtime reliability hardening、F5)。
 *
 * 従来 `fetch` に `AbortSignal` が無く、Google Places が応答しない場合に呼び出し元が
 * platform の Function 上限まで占有されうる状態だった。特に AI 店舗調査の Stage0 は
 * **best-effort の補助処理**であり、応答が遅いときは早く諦めて Gemini 側の Stage1 へ
 * 進む方がよい(`lib/ai/research/run-timing.ts:STAGE0_PLACES_TIMEOUT_MS`)。
 *
 * **未指定時は `signal` を渡さない**(既存呼び出し元の挙動を変えないため)。
 */
export interface PlacesRequestOptions {
  /** 指定した場合のみ `AbortSignal.timeout(timeoutMs)` を fetch へ渡す。 */
  timeoutMs?: number;
}

/**
 * `options.timeoutMs` が指定されているときだけ `signal` を含む部分オブジェクトを返す。
 * spread して `fetch` の init に混ぜる想定(未指定なら空 = 従来と同一のリクエスト)。
 */
function abortSignalInit(options?: PlacesRequestOptions): { signal?: AbortSignal } {
  return options?.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(options.timeoutMs) };
}

export interface SearchPlacesPageOptions extends PlacesRequestOptions {
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
    ...abortSignalInit(options),
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
  options?: PlacesRequestOptions,
): Promise<PlaceResult[]> {
  const { places } = await searchPlacesPage(keyword, area, options);
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
 * Place Details の URL を組み立てる。
 * placeId が "places/xxx" 形式で渡ってきた場合は、二重に "places/" を付けないよう
 * プレフィックスを取り除いてから encodeURIComponent する。
 */
function buildPlaceDetailsUrl(placeId: string): string {
  const id = placeId.startsWith("places/") ? placeId.slice("places/".length) : placeId;
  return `${DETAILS_ENDPOINT}/${encodeURIComponent(id)}`;
}

/**
 * Place Details API (GET) を1回呼び出し、RawPlace を返す共通処理。
 * `getPlaceById` / `getPlaceDetails` で共有する (フィールドマスクのみ呼び出し側で変える)。
 */
async function fetchRawPlaceDetails(
  placeId: string,
  fieldMask: string,
  options?: PlacesRequestOptions,
): Promise<RawPlace> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY が設定されていません");
  }

  const response = await fetch(buildPlaceDetailsUrl(placeId), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    cache: "no-store",
    ...abortSignalInit(options),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Places API エラー (${response.status}): ${text}`);
  }

  return (await response.json()) as RawPlace;
}

/**
 * placeId を指定して Google Places API から詳細を取得する。
 * addStoreFromPlaceAction がサーバー側でデータを再取得する際に使用する。
 * 必須フィールドが欠けている場合は null を返す。
 */
export async function getPlaceById(
  placeId: string,
  options?: PlacesRequestOptions,
): Promise<PlaceResult | null> {
  const raw = await fetchRawPlaceDetails(placeId, DETAILS_FIELD_MASK, options);
  return toPlaceResult(raw);
}

/**
 * エリア検索の「Place Detailsオンデマンド取得」用 (Issue #104 follow-up)。
 *
 * 一覧検索やNearby Searchでは取得しない電話番号・Webサイト・評価・口コミ数・営業状態を、
 * ユーザーが選んだ1店舗分だけ取得する。reviews/photos/営業時間等は取得しない。
 * 必須フィールド (id/displayName.text/formattedAddress/location) が欠けている場合は例外を投げる。
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetailsResult> {
  const raw = await fetchRawPlaceDetails(placeId, PLACE_DETAILS_FIELD_MASK);

  if (!hasRequiredPlaceFields(raw)) {
    throw new Error("店舗情報が不足しているため詳細を取得できませんでした");
  }

  return {
    placeId: raw.id,
    name: raw.displayName!.text,
    address: raw.formattedAddress!,
    lat: raw.location!.latitude,
    lng: raw.location!.longitude,
    googleMapsUri: raw.googleMapsUri ?? "",
    types: raw.types ?? [],
    phone: raw.nationalPhoneNumber ?? "",
    rating: raw.rating ?? null,
    userRatingsTotal: raw.userRatingCount ?? null,
    websiteUri: raw.websiteUri ?? null,
    businessStatus: raw.businessStatus ?? null,
  };
}
