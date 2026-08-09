/**
 * Stage0: Google Places 軽量再同期(AI 店舗調査再設計 Plan v3.2 §9、
 * fix/ai-research-poc-like-retrieval で新設、feat/ai-research-quality-refinement で
 * Text Search fallback を追加)。
 *
 * `stores.google_place_id` が存在する店舗は既存の Place Details API
 * (`lib/places/google.ts:getPlaceById`)を最大1回呼ぶ。存在しない店舗は
 * Text Search(`searchPlaces`)を最大1回呼び、店舗名・住所・電話番号の
 * strong matchが一意に定まった場合**のみ**採用する(曖昧な場合は不採用、
 * `google_place_id`を持つ経路と同じ信頼性を保つため)。いずれの経路でも
 * Places呼出は1回/runを超えない(Text Search成功時に追加のDetails callは行わない、
 * `SEARCH_FIELD_MASK`が既にrating/userRatingCount/nationalPhoneNumber等を含むため)。
 *
 * 重要な設計判断:
 * - 取得結果は本 run の**in-memoryでの確定根拠としてのみ**使用する。
 *   `stores.basic_info` への恒久書き込みは行わない(呼び出し側が
 *   `lib/domain/basic-info-merge.ts:mergeBasicInfo` で既存basic_infoへin-memoryで
 *   マージし、`derivePlacesVerifiedKeys` に渡すのみ)。
 * - manual値を上書きしない(`mergeBasicInfo` の既存3層防御をそのまま利用)。
 * - Places取得失敗(API エラー・該当なし等)は AI店舗調査全体を failed にしない。
 *   warning を返してWeb調査へ進む(呼び出し側が warnings 配列へ追加する)。
 * - Text Search fallbackは`stores.google_place_id`への書き戻しを行わない
 *   (Stage0はDBへの副作用を持たないbest-effort設計を維持する)。
 */

import "server-only";

import { getPlaceById, searchPlaces } from "@/lib/places/google";
import { placeResultToBasicInfo } from "@/lib/places/to-basic-info";
import type { PlaceResult } from "@/lib/places/types";
import type { BasicInfo } from "@/types/basic-info";
import {
  deriveSearchIdentityName,
  isAddressMatch,
  isNameMatch,
  normalizePhone,
} from "./identity-match";

// deriveSearchIdentityName/isNameMatch/isAddressMatch/normalizePhoneは
// fix/ai-research-source-identity-integrity で `./identity-match.ts` へ切り出した
// (Stage2 source_verifications照合と実装を共有するため)。既存の呼び出し元・
// テストへの影響を避けるため、このモジュールからも re-export して公開APIを維持する。
export { deriveSearchIdentityName, isNameMatch };

export interface Stage0PlacesResult {
  /** 取得できた場合のみ非空。`filled_by: "places"` がスタンプ済み(in-memory専用)。 */
  placesBasicInfo: Partial<BasicInfo>;
  /** 失敗の場合のみ非null。run.warnings へ追加することを想定した平易な文言。 */
  warning: string | null;
}

/**
 * 店舗名一致 + (住所一致 or 電話一致) を満たす候補のみを抽出する
 * (`pickStrongPlaceMatch`/`diagnosePlacesMatch`共通のcore filter)。
 *
 * 電話の一致判定は`identity-match.ts:isTargetStoreMatch`と同じ不変条件に揃える
 * (PR #180 review Finding 2 の hardening)。`normalizePhone`は数字以外を全て除去する
 * ため、「不明」「未掲載」「-」のような数字を含まない文字列は正規化後いずれも ""
 * になる。正規化**前**の非空チェックだけでは `"" === ""` が成立し、電話が実質未確認の
 * 両者を「電話一致」と誤判定してしまう。
 *
 * 現在のGoogle Places入力(`p.phone`は`nationalPhoneNumber ?? ""`)ではこの経路は
 * 顕在化しにくいが、将来の供給元変更・fallback追加で `"" === ""` が identity match に
 * ならないよう、2つの呼び出し箇所で不変条件を統一しておく。
 */
function findStrongMatches(
  candidates: readonly PlaceResult[],
  store: { name: string; address: string; phone: string },
): PlaceResult[] {
  const searchIdentityName = deriveSearchIdentityName(store.name);
  const storePhone = normalizePhone(store.phone);
  return candidates.filter((p) => {
    if (!isNameMatch(p.name, searchIdentityName)) return false;
    const addressMatches = store.address.trim() !== "" && isAddressMatch(p.formattedAddress, store.address);
    const candidatePhone = normalizePhone(p.phone);
    const phoneMatches = storePhone !== "" && candidatePhone !== "" && candidatePhone === storePhone;
    return addressMatches || phoneMatches;
  });
}

/**
 * 候補の中から店舗名一致 + (住所一致 or 電話一致) を満たす候補が**一意に**定まる
 * 場合のみ返す。0件・複数件(曖昧)の場合はnullを返し、採用しない
 * (feat/ai-research-quality-refinement、ユーザー要望どおり曖昧候補は採用禁止)。
 */
export function pickStrongPlaceMatch(
  candidates: readonly PlaceResult[],
  store: { name: string; address: string; phone: string },
): PlaceResult | null {
  const strongMatches = findStrongMatches(candidates, store);
  return strongMatches.length === 1 ? strongMatches[0]! : null;
}

/**
 * `pickStrongPlaceMatch`がnullを返した理由をsanitizedに分類する
 * (feat/ai-research-searchfact-places-match)。候補店舗名等の個別情報は
 * 一切含めず、種別のみを返す(UI/warningへ候補一覧を露出しないため)。
 */
export type PlacesMatchDiagnosticKind = "places_search_no_match" | "places_search_ambiguous";

export function diagnosePlacesMatch(
  candidates: readonly PlaceResult[],
  store: { name: string; address: string; phone: string },
): PlacesMatchDiagnosticKind {
  const strongMatches = findStrongMatches(candidates, store);
  return strongMatches.length > 1 ? "places_search_ambiguous" : "places_search_no_match";
}

/**
 * Places API失敗時の生エラー(`lib/places/google.ts`が投げる`Error`)から、
 * secretや生レスポンス本文を含まないsanitizedな種別文字列を導出する
 * (feat/ai-research-final-quality、PR #187のGemini観測性修正と同じ方針)。
 *
 * `lib/places/google.ts`は`Error("Places API エラー (${status}): ${text}")`
 * 形式で投げるため、ここではstatusコードのみを抽出し、`text`(Google APIの
 * 生レスポンス本文)は一切含めない。判定できない場合は"unknown"。
 */
export function classifyPlacesError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("GOOGLE_PLACES_API_KEY")) return "missing_api_key";
  const statusMatch = message.match(/エラー \((\d{3})\)/);
  if (statusMatch) return `api_error:${statusMatch[1]}`;
  return "unknown";
}

/**
 * `google_place_id` が存在する場合は Place Details を1回取得する。
 * 存在しない場合は Text Search を1回実行し、strong matchが一意に定まった場合のみ採用する
 * (feat/ai-research-quality-refinement)。いずれの経路でもPlaces呼出は1回/runを超えない。
 */
export async function runStage0PlacesResync(params: {
  googlePlaceId: string | null;
  store: { name: string; address: string; phone: string };
  now: string;
}): Promise<Stage0PlacesResult> {
  const { googlePlaceId, store, now } = params;

  if (googlePlaceId !== null && googlePlaceId.trim() !== "") {
    try {
      const place = await getPlaceById(googlePlaceId);
      if (place === null) {
        return {
          placesBasicInfo: {},
          warning: "Google Placesの店舗情報を再取得できませんでした(該当なし)。既存情報のみで調査を続行します。",
        };
      }
      return { placesBasicInfo: placeResultToBasicInfo(place, now), warning: null };
    } catch (err) {
      return {
        placesBasicInfo: {},
        warning: `Google Places再同期に失敗しました (${classifyPlacesError(err)})。既存情報のみで調査を続行します。`,
      };
    }
  }

  try {
    const searchIdentityName = deriveSearchIdentityName(store.name);
    const candidates = await searchPlaces(searchIdentityName, store.address);
    const matched = pickStrongPlaceMatch(candidates, store);
    if (!matched) {
      // 曖昧(0件 or 複数件)の場合は不採用。従来どおりWeb調査へfallbackする
      // (無理に埋めない、Plan v3.2の自動Text Searchスコープ外方針の精神を維持)。
      // API自体は成功しているため、完全silentにせずsanitizedな診断種別のみ記録する
      // (feat/ai-research-searchfact-places-match、候補店舗名等は一切含めない)。
      const diagnostic = diagnosePlacesMatch(candidates, store);
      return {
        placesBasicInfo: {},
        warning: `Google Places候補が一意に特定できませんでした (${diagnostic})。既存情報のみで調査を続行します。`,
      };
    }
    return { placesBasicInfo: placeResultToBasicInfo(matched, now), warning: null };
  } catch (err) {
    return {
      placesBasicInfo: {},
      warning: `Google Places検索に失敗しました (${classifyPlacesError(err)})。既存情報のみで調査を続行します。`,
    };
  }
}

