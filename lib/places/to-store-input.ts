import type { PlaceResult } from "./types";
import type { StoreInput } from "@/types/store";

const PREFECTURE_RE = /^(東京都|北海道|大阪府|京都府|.+?[都道府県])/;
const CITY_RE = /^(.+?[市区町村郡])/;

export function extractPrefecture(address: string): string {
  return PREFECTURE_RE.exec(address)?.[1] ?? "";
}

export function extractCity(address: string): string {
  const pref = extractPrefecture(address);
  const rest = address.slice(pref.length);
  return CITY_RE.exec(rest)?.[1] ?? "";
}

const GENRE_MAP: ReadonlyArray<readonly [string, string]> = [
  ["ramen_restaurant", "ラーメン"],
  ["sushi_restaurant", "寿司"],
  ["cafe", "カフェ"],
  ["bar", "バー"],
  ["bakery", "ベーカリー"],
  ["italian_restaurant", "イタリアン"],
  ["chinese_restaurant", "中華"],
  ["japanese_restaurant", "和食"],
  ["hamburger_restaurant", "ハンバーガー"],
  ["pizza_restaurant", "ピザ"],
  ["restaurant", "その他"],
  ["food", "その他"],
] as const;

export function mapGenre(types: string[]): string {
  for (const [key, label] of GENRE_MAP) {
    if (types.includes(key)) return label;
  }
  return "";
}

export function placeResultToStoreInput(place: PlaceResult): StoreInput {
  const map_url =
    place.googleMapsUri ??
    `https://www.google.com/maps/search/?api=1&query_place_id=${place.placeId}`;

  return {
    name: place.name,
    prefecture: extractPrefecture(place.formattedAddress),
    city: extractCity(place.formattedAddress),
    address: place.formattedAddress,
    genre: mapGenre(place.types),
    priority: "中",
    stage: "未調査",
    channel: "未判定",
    has_contact_form: "未確認",
    map_url,
    site_url: "",
    instagram_url: "",
    phone: place.phone,
    target_service: "",
    review_count: place.userRatingsTotal ?? 0,
    review_avg: place.rating ?? 0,
    memo: "",
    assigned_planner_user_id: null,
    assigned_sales_user_id: null,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: place.lat,
    lng: place.lng,
    business_hours: "",
    google_place_id: place.placeId,
  };
}
