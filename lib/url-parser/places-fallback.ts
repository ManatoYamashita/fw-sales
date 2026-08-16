import "server-only";

import { searchPlaces } from "@/lib/places/google";
import type { PlaceResult } from "@/lib/places/types";
import {
  extractCity,
  extractPrefecture,
  mapGenre,
} from "@/lib/places/to-store-input";

import { needsPlacesFallback, PLACES_API_SCORE } from "./apply";
import type { PlacesFallbackTrigger } from "./apply";
import type { ApplyResult, ParsedUrl } from "./types";

/**
 * Places 補完の発火理由 / 不発理由の閉じた集合。
 *
 * UI 側の文言テーブルをこの union で型付けすることで、
 * **reason の追加・改名と文言の追随漏れを compile time で検出**できる
 * (Issue #207 以前は `string` で、全 reason が同じ文言に潰れていた原因のひとつ)。
 */
export type PlacesFallbackReason =
  /** 発火理由(`used: true` のとき) */
  | PlacesFallbackTrigger["reason"]
  /** 検索語が無く **Places を呼んでいない** */
  | "no_keyword"
  /** `GOOGLE_PLACES_API_KEY` 未設定で呼べなかった */
  | "no_api_key"
  /** Places API の呼び出しが失敗した */
  | "api_error"
  /** 候補 0 件、または名前一致 0 件 */
  | "places_not_found"
  /** 同名候補が複数あり一意に絞れない */
  | "ambiguous";

/**
 * Places API フォールバックの実行結果サマリ。UI 側で toast 文言の出し分けに使う。
 */
export interface PlacesFallbackInfo {
  /** 実際に Places API のレスポンスでフィールドをマージしたか */
  used: boolean;
  /**
   * 発火理由 / 不発理由。`no_keyword` と `places_not_found` を UI で同じ文言に
   * 潰さないこと(Issue #207)。詳細は {@link PlacesFallbackReason}。
   */
  reason: PlacesFallbackReason;
  /** マッチした Place の placeId (UI デバッグ表示や Place ID DB 紐付けに利用) */
  matched_place_id?: string;
}

const NO_OP: PlacesFallbackInfo = { used: false, reason: "none" };

/**
 * 店舗名の比較用正規化 (Issue #207)。
 *
 * **表記ゆれの吸収だけ**を行い、意味的な変形はしない:
 * - `NFKC`(全角英数・全角記号を半角へ畳む)
 * - 前後 trim + 連続空白の 1 個への集約
 * - 英字の case normalization
 *
 * 「本店」「新宿店」「○○店」等の**支店表記は絶対に落とさない**。
 * 落とすと「鮨処 なむら 本店」と「鮨処 なむら 横浜店」が同一視され、
 * まさに防ぎたい別店舗採用が起きる。
 */
function normalizeStoreName(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 候補の中から、対象店舗と**一意に**同定できる 1 件だけを返す (Issue #207)。
 *
 * ## 以前の挙動と、変更した理由
 *
 * 変更前は「名前の完全一致が無ければ `userRatingsTotal` 最多の候補」を採用していた。
 * これは **口コミ件数を identity evidence として使う**ことに等しく、
 * 弱い検索語から複数候補が返ったとき「その地域で最も有名な別の店」を
 * 自動的に登録してしまう経路になっていた。
 *
 * 口コミ件数は「その店が有名か」を表すだけで、「貼られた URL の店か」の根拠にはならない。
 * **autofill 率より wrong-store prevention を優先する**という #207 の方針に従い、
 * この経路を廃止する。
 *
 * ## 現在の判定
 *
 * | 状況 | 戻り値 |
 * | --- | --- |
 * | `targetName` が空 | `null`(照合基準が無い) |
 * | 正規化後の完全一致が 0 件 | `null` |
 * | 正規化後の完全一致が 1 件 | その候補 |
 * | 正規化後の完全一致が 2 件以上 | `null`(ambiguous。人間の判断へ委ねる) |
 *
 * fuzzy match(部分一致・編集距離)も口コミ件数も自動採用条件にしない。
 */
export function pickBestPlace(
  candidates: readonly PlaceResult[],
  targetName: string,
): PlaceResult | null {
  const normalizedTarget = normalizeStoreName(targetName);
  if (normalizedTarget === "") return null;

  const exactMatches = candidates.filter(
    (p) => normalizeStoreName(p.name) === normalizedTarget,
  );
  return exactMatches.length === 1 ? exactMatches[0]! : null;
}

/**
 * `pickBestPlace` が `null` を返した理由を、UI 文言を出し分けられる粒度で分類する。
 * 候補の店舗名等は一切含めず、種別のみを返す。
 */
export function diagnosePickFailure(
  candidates: readonly PlaceResult[],
  targetName: string,
): "places_not_found" | "ambiguous" {
  const normalizedTarget = normalizeStoreName(targetName);
  if (normalizedTarget === "") return "places_not_found";
  const exactMatches = candidates.filter(
    (p) => normalizeStoreName(p.name) === normalizedTarget,
  );
  return exactMatches.length > 1 ? "ambiguous" : "places_not_found";
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
    // 「候補が無かった」と「候補が複数あって一意に絞れなかった」を UI で区別する
    // (Issue #207: 失敗理由を同じ文言に潰さない)。
    return {
      updated: suggested,
      info: { used: false, reason: diagnosePickFailure(candidates, keyword) },
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
