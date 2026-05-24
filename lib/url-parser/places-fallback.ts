import "server-only";

import { searchPlaces } from "@/lib/places/google";
import type { PlaceResult } from "@/lib/places/types";
import {
  extractCity,
  extractPrefecture,
  mapGenre,
} from "@/lib/places/to-store-input";

import { needsPlacesFallback, PLACES_API_SCORE } from "./apply";
import type { ApplyResult, ParsedUrl } from "./types";

/**
 * Places API フォールバックの実行結果サマリ。UI 側で toast 文言の出し分けに使う。
 */
export interface PlacesFallbackInfo {
  /** 実際に Places API のレスポンスでフィールドをマージしたか */
  used: boolean;
  /** 発火理由 / 不発理由 (none / missing_name / low_name / no_address / low_region / places_not_found / no_api_key / api_error / no_keyword) */
  reason: string;
  /** マッチした Place の placeId (UI デバッグ表示や Place ID DB 紐付けに利用) */
  matched_place_id?: string;
}

const NO_OP: PlacesFallbackInfo = { used: false, reason: "none" };

/**
 * 複数候補の中から「最も入力意図に近い 1 件」を選ぶ。
 * 完全一致 (name 完全一致) を最優先、次点で口コミ件数が多い順。
 */
export function pickBestPlace(
  candidates: readonly PlaceResult[],
  targetName: string,
): PlaceResult | null {
  if (candidates.length === 0) return null;

  const normalized = targetName.trim();
  if (normalized) {
    const exact = candidates.find((p) => p.name.trim() === normalized);
    if (exact) return exact;
  }

  // userRatingsTotal が多い順 (null は最下位)
  const sorted = [...candidates].sort((a, b) => {
    const ra = a.userRatingsTotal ?? -1;
    const rb = b.userRatingsTotal ?? -1;
    return rb - ra;
  });
  return sorted[0] ?? null;
}

/**
 * 既存 ApplyResult に PlaceResult をマージする。
 *
 * マージ規則: 各フィールドについて「既存値が空」または「既存信頼度 < PLACES_API_SCORE (88)」のときのみ上書き。
 * 既存値が JSON-LD (90) や TABELOG_DICT (95) 由来で確定済の場合は触らない。
 */
export function mergePlaceIntoApply(
  base: ApplyResult,
  place: PlaceResult,
): ApplyResult {
  const merged: ApplyResult = {
    ...base,
    confidence: { ...base.confidence },
  };

  const shouldOverwrite = (field: keyof ApplyResult): boolean => {
    const currentScore = merged.confidence[field as keyof typeof merged.confidence];
    if (currentScore === undefined) return true;
    return currentScore < PLACES_API_SCORE;
  };

  if (place.name && shouldOverwrite("name")) {
    merged.name = place.name;
    merged.confidence.name = PLACES_API_SCORE;
  }

  if (place.formattedAddress && shouldOverwrite("address")) {
    merged.address = place.formattedAddress;
    merged.confidence.address = PLACES_API_SCORE;
  }

  const prefFromPlace = extractPrefecture(place.formattedAddress);
  if (prefFromPlace && shouldOverwrite("prefecture")) {
    merged.prefecture = prefFromPlace;
    merged.confidence.prefecture = PLACES_API_SCORE;
  }

  const cityFromPlace = extractCity(place.formattedAddress);
  if (cityFromPlace && shouldOverwrite("city")) {
    merged.city = cityFromPlace;
    merged.confidence.city = PLACES_API_SCORE;
  }

  if (place.phone && shouldOverwrite("phone")) {
    merged.phone = place.phone;
    merged.confidence.phone = PLACES_API_SCORE;
  }

  if (place.googleMapsUri && shouldOverwrite("map_url")) {
    merged.map_url = place.googleMapsUri;
    merged.confidence.map_url = PLACES_API_SCORE;
  }

  if (typeof place.rating === "number" && shouldOverwrite("review_avg")) {
    merged.review_avg = place.rating;
    merged.confidence.review_avg = PLACES_API_SCORE;
  }

  if (typeof place.userRatingsTotal === "number" && shouldOverwrite("review_count")) {
    merged.review_count = place.userRatingsTotal;
    merged.confidence.review_count = PLACES_API_SCORE;
  }

  const genreFromPlace = mapGenre(place.types);
  if (genreFromPlace && shouldOverwrite("genre")) {
    merged.genre = genreFromPlace;
    merged.confidence.genre = PLACES_API_SCORE;
  }

  return merged;
}

/**
 * URL Parser の結果に対し、低信頼度フィールドを Google Places Text Search で補完する。
 *
 * - API キー未設定 / ネットワーク例外は silently catch して `used: false` を返す。
 *   UI には toast を出さず、`console.warn` でログのみ残す。
 * - 1 リクエスト (Text Search) のみ。Place Details は呼ばない (コスト抑制)。
 */
export async function enrichWithPlacesFallback(
  parsed: ParsedUrl | null,
  suggested: ApplyResult,
): Promise<{ updated: ApplyResult; info: PlacesFallbackInfo }> {
  const trigger = needsPlacesFallback(parsed, suggested);
  if (trigger.reason === "none" || !trigger.query) {
    return { updated: suggested, info: NO_OP };
  }

  const keyword = trigger.query.keyword.trim();
  if (!keyword) {
    return {
      updated: suggested,
      info: { used: false, reason: "no_keyword" },
    };
  }

  let candidates: PlaceResult[];
  try {
    candidates = await searchPlaces(keyword, trigger.query.area);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("GOOGLE_PLACES_API_KEY")) {
      console.warn("[places-fallback] API キー未設定のため Places フォールバックをスキップ");
      return { updated: suggested, info: { used: false, reason: "no_api_key" } };
    }
    console.warn(`[places-fallback] Places API 呼び出しに失敗: ${message}`);
    return { updated: suggested, info: { used: false, reason: "api_error" } };
  }

  const best = pickBestPlace(candidates, keyword);
  if (!best) {
    return {
      updated: suggested,
      info: { used: false, reason: "places_not_found" },
    };
  }

  const merged = mergePlaceIntoApply(suggested, best);
  return {
    updated: merged,
    info: {
      used: true,
      reason: trigger.reason,
      matched_place_id: best.placeId,
    },
  };
}
