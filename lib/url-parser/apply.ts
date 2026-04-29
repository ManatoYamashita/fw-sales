import type { ApplyResult, OgpResult, ParsedUrl } from "./types";

const PREFECTURE_PATTERN =
  /(東京都|大阪府|京都府|北海道|.+?[都道府県])/;

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
    if (parsed.name) fields.name = parsed.name;
    if (parsed.genre) fields.genre = parsed.genre;
    if (parsed.map_url) fields.map_url = parsed.map_url;
    if (parsed.instagram_url) fields.instagram_url = parsed.instagram_url;
    if (parsed.station_area) fields.address = `${parsed.station_area}周辺`;
    if (parsed.tabelog_url) fields.memo = `食べログURL: ${parsed.tabelog_url}`;
  }

  if (ogp?.ok) {
    if (ogp.name) fields.name = ogp.name;
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

  return fields;
}
