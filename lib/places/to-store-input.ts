import type { PlaceResult } from "./types";
import type { StoreInput } from "@/types/store";

const PREFECTURE_RE = /^(東京都|北海道|大阪府|京都府|.+?[都道府県])/;
const CITY_RE = /^(.+?[市区町村郡])/;

// 現行 Google Places API は formattedAddress を
// "日本、〒150-0043 東京都渋谷区道玄坂..." の形で返す。
// 古い形式の末尾 " 日本" もあり得るため両方除去する。
const ADDRESS_PREFIX_RE = /^(?:日本[、,\s]*)?(?:〒\d{3}-?\d{4}\s*)?/;
const ADDRESS_SUFFIX_RE = /[、,\s]*日本\s*$/;

/**
 * Google Places `formattedAddress` の周辺ノイズを取り除き、
 * 純粋な「都道府県 + 市区町村 + 番地以降」だけの形に正規化する。
 *
 * 取り除く対象:
 * - 先頭の `日本、` / `日本 ` / `日本,`
 * - 先頭の郵便番号 `〒150-0043` / `〒1500043` (任意でハイフン省略)
 * - 末尾の `日本` (古い形式の suffix)
 */
export function normalizeFormattedAddress(raw: string): string {
  return raw
    .replace(ADDRESS_PREFIX_RE, "")
    .replace(ADDRESS_SUFFIX_RE, "")
    .trim();
}

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

  // formattedAddress を正規化してから prefecture/city を抽出する。
  // address には prefecture/city を除いた残差 (番地 + 建物名) のみを保存し、
  // 表示時に `prefecture + city + address` で再結合する設計と整合させる。
  const normalized = normalizeFormattedAddress(place.formattedAddress);
  const prefecture = extractPrefecture(normalized);
  const city = extractCity(normalized);
  const addressRest = normalized.slice(prefecture.length + city.length).trim();

  return {
    name: place.name,
    prefecture,
    city,
    address: addressRest,
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
