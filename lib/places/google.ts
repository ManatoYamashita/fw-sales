import "server-only";
import type { PlaceResult } from "./types";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
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

function toPlaceResult(raw: RawPlace): PlaceResult {
  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? "",
    formattedAddress: raw.formattedAddress ?? "",
    lat: raw.location?.latitude ?? 0,
    lng: raw.location?.longitude ?? 0,
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

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, languageCode: "ja" }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Places API エラー (${response.status}): ${text}`);
  }

  const data = (await response.json()) as PlacesResponse;
  return (data.places ?? [])
    .map(toPlaceResult)
    .filter((p) => isFoodPlace(p.types));
}
