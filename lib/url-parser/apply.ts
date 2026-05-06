import type { ApplyResult, OgpResult, ParsedSource, ParsedUrl } from "./types";

const PREFECTURE_PATTERN =
  /(東京都|大阪府|京都府|北海道|.+?[都道府県])/;

/**
 * OGP の name 値が「ジェネリックなサイトタイトル」(店舗名ではない)である場合の判定。
 * 完全一致 + 包含チェックで広めに弾く。
 */
const NAME_BLACKLIST: readonly string[] = [
  "Google マップ",
  "Google Maps",
  "Googleマップ",
  "Google マップ ",
  "食べログ",
  "Tabelog",
];

function isBlacklistedName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  for (const bad of NAME_BLACKLIST) {
    if (trimmed === bad) return true;
    // 「Google マップ - Google」のような単純合成にも対応(包含判定)
    if (trimmed === bad.trim()) return true;
  }
  return false;
}

/**
 * URL 由来の name と OGP 由来の name の優先度を解決する。
 * - Google Maps の場合: URL 由来を常に優先(OGP の <title> は "Google マップ" 固定で汚染源)
 * - 食べログ等の場合: OGP > URL(支店名等の詳細を OGP の方が含む)が原則だが、
 *   OGP がブラックリストに該当する値なら破棄して URL 由来にフォールバック
 */
export function pickName(
  parsedName: string | undefined,
  ogpName: string | undefined,
  parsedType: ParsedSource | undefined,
): string {
  const parsed = (parsedName ?? "").trim();
  const ogp = (ogpName ?? "").trim();

  // OGP がブラックリストなら捨てる
  const ogpClean = ogp && !isBlacklistedName(ogp) ? ogp : "";

  // Google Maps は URL 由来を優先
  if (parsedType === "google_maps") {
    return parsed || ogpClean;
  }

  // それ以外は OGP > parsed
  return ogpClean || parsed;
}

export function applyParsedData(
  parsed: ParsedUrl | null,
  ogp: OgpResult | null = null,
): ApplyResult {
  const fields: ApplyResult = {
    name: "",
    prefecture: "",
    city: "",
    phone: "",
    site_url: "",
    map_url: "",
    instagram_url: "",
    genre: "",
    address: "",
    review_avg: null,
    review_count: null,
    memo: "",
  };

  if (parsed) {
    if (parsed.prefecture) fields.prefecture = parsed.prefecture;
    if (parsed.city) fields.city = parsed.city;
    if (parsed.genre) fields.genre = parsed.genre;
    if (parsed.map_url) fields.map_url = parsed.map_url;
    if (parsed.instagram_url) fields.instagram_url = parsed.instagram_url;
    if (parsed.station_area) fields.address = `${parsed.station_area}周辺`;
    if (parsed.tabelog_url) fields.memo = `食べログURL: ${parsed.tabelog_url}`;
  }

  if (ogp?.ok) {
    if (ogp.genre && !fields.genre) fields.genre = ogp.genre;
    if (ogp.phone) fields.phone = ogp.phone;
    if (typeof ogp.rating === "number") fields.review_avg = ogp.rating;
    if (typeof ogp.review_count === "number")
      fields.review_count = ogp.review_count;
    if (ogp.address_hint && !fields.prefecture) {
      const m = ogp.address_hint.match(PREFECTURE_PATTERN);
      if (m?.[1]) fields.prefecture = m[1];
    }
    if (ogp.description && parsed?.type === "tabelog") {
      const tail = `概要: ${ogp.description.slice(0, 100)}`;
      fields.memo = fields.memo ? `${fields.memo}\n${tail}` : tail;
    }
  }

  // name は最後に優先度ルールで決定(parsed.type を見るため、parsed/ogp 両方適用後)
  fields.name = pickName(parsed?.name, ogp?.ok ? ogp.name : undefined, parsed?.type);

  return fields;
}
