import "server-only";
import type { PlaceResult } from "./types";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

// Text Search のフィールドマスクは "places.<field>" 形式
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

export async function searchPlaces(
  keyword: string,
  area: string,
): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY が設定されていません");
  }

  const textQuery = [keyword.trim(), area.trim()].filter(Boolean).join(" ");

  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, languageCode: "ja" }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Places API エラー (${response.status}): ${text}`);
  }

  const data = (await response.json()) as PlacesResponse;
  const results: PlaceResult[] = [];
  for (const raw of data.places ?? []) {
    const place = toPlaceResult(raw);
    if (place && isFoodPlace(place.types)) {
      results.push(place);
    }
  }
  return results;
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
