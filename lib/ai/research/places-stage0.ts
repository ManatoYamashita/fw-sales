/**
 * Stage0: Google Places 軽量再同期(AI 店舗調査再設計 Plan v3.2 §9、
 * fix/ai-research-poc-like-retrieval で新設)。
 *
 * `stores.google_place_id` が存在する店舗についてのみ、既存の Place Details API
 * (`lib/places/google.ts:getPlaceById`)を最大1回呼び、`store_name`/`address`/
 * `cuisine_genre`/`phone`/`review_avg`/`review_count` の最新値を取得する。
 * `google_place_id` が無い店舗については自動Text Searchによる曖昧マッチは行わない
 * (誤同定リスクを増やさないため)。
 *
 * 重要な設計判断:
 * - 取得結果は本 run の**in-memoryでの確定根拠としてのみ**使用する。
 *   `stores.basic_info` への恒久書き込みは行わない(呼び出し側が
 *   `lib/domain/basic-info-merge.ts:mergeBasicInfo` で既存basic_infoへin-memoryで
 *   マージし、`derivePlacesVerifiedKeys` に渡すのみ)。
 * - manual値を上書きしない(`mergeBasicInfo` の既存3層防御をそのまま利用)。
 * - Places取得失敗(API エラー・該当なし等)は AI店舗調査全体を failed にしない。
 *   warning を返してWeb調査へ進む(呼び出し側が warnings 配列へ追加する)。
 */

import "server-only";

import { getPlaceById } from "@/lib/places/google";
import { placeResultToBasicInfo } from "@/lib/places/to-basic-info";
import type { BasicInfo } from "@/types/basic-info";

export interface Stage0PlacesResult {
  /** 取得できた場合のみ非空。`filled_by: "places"` がスタンプ済み(in-memory専用)。 */
  placesBasicInfo: Partial<BasicInfo>;
  /** 失敗・該当なしの場合のみ非null。run.warnings へ追加することを想定した平易な文言。 */
  warning: string | null;
}

/**
 * `google_place_id` が存在する場合のみ Place Details を1回取得する。
 * 存在しない場合は API を呼ばず、空の結果を返す(warningも出さない、正常な設計上の分岐)。
 */
export async function runStage0PlacesResync(
  googlePlaceId: string | null,
  now: string,
): Promise<Stage0PlacesResult> {
  if (googlePlaceId === null || googlePlaceId.trim() === "") {
    return { placesBasicInfo: {}, warning: null };
  }

  try {
    const place = await getPlaceById(googlePlaceId);
    if (place === null) {
      return {
        placesBasicInfo: {},
        warning: "Google Placesの店舗情報を再取得できませんでした(該当なし)。既存情報のみで調査を続行します。",
      };
    }
    return { placesBasicInfo: placeResultToBasicInfo(place, now), warning: null };
  } catch {
    return {
      placesBasicInfo: {},
      warning: "Google Places再同期に失敗しました。既存情報のみで調査を続行します。",
    };
  }
}
