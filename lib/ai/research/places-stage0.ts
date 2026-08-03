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

export interface Stage0PlacesResult {
  /** 取得できた場合のみ非空。`filled_by: "places"` がスタンプ済み(in-memory専用)。 */
  placesBasicInfo: Partial<BasicInfo>;
  /** 失敗の場合のみ非null。run.warnings へ追加することを想定した平易な文言。 */
  warning: string | null;
}

/**
 * 店舗名先頭の営業管理タグ(例:「（Rアポハマロスト）」「（7月1日NEW）」等、表記統一されない
 * 自由記述の営業ステータスメモ)を除去し、Google Places検索に使う実店舗名相当の
 * 文字列を返す(feat/ai-research-quality-refinement)。
 *
 * fw-salesの実データ調査により、営業管理タグは常に店舗名の**先頭**に括弧で囲まれる形で
 * 追加されることを確認した(例:「（Rアポハマロスト）炉端ジュン」→実店舗名は
 * 「炉端ジュン」)。一方、フリガナ等の正当な括弧表記(例:「川端 （かわばた）」)は
 * 名前の途中・末尾に現れるため、先頭の括弧グループのみを除去対象とすることで
 * 誤って正当な店名表記を壊さない。除去後に空文字になる場合(異常系)は
 * rawをそのまま返す(検索クエリが空になることを避ける)。
 */
const LEADING_MANAGEMENT_TAG_RE = /^[（(]([^（）()]*)[）)]\s*(.+)$/;

export function deriveSearchIdentityName(rawName: string): string {
  const match = rawName.match(LEADING_MANAGEMENT_TAG_RE);
  const remainder = match?.[2]?.trim();
  return remainder && remainder !== "" ? remainder : rawName.trim();
}

function normalizeForNameMatch(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/**
 * 正規化後の完全一致、またはどちらかがもう一方を含む場合にマッチとみなす
 * (Google Places上の表記(例:「東北メシ 炉端ジュン」)とfw-sales内の実店舗名
 * (例:「炉端ジュン」)の表記ゆれを許容するため)。ただし名前一致のみでは
 * 採用しない(`pickStrongPlaceMatch`が住所or電話の一致を別途必須とする)。
 * 極端に短い名前(2文字未満)での誤マッチを防ぐため、包含判定には長さ下限を設ける。
 */
export function isNameMatch(placeName: string, searchIdentityName: string): boolean {
  const a = normalizeForNameMatch(placeName);
  const b = normalizeForNameMatch(searchIdentityName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length < 2) return false;
  return a.includes(b) || b.includes(a);
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
  const searchIdentityName = deriveSearchIdentityName(store.name);
  const strongMatches = candidates.filter((p) => {
    if (!isNameMatch(p.name, searchIdentityName)) return false;
    const addressMatches = store.address.trim() !== "" && isAddressMatch(p.formattedAddress, store.address);
    const phoneMatches =
      store.phone.trim() !== "" && p.phone.trim() !== "" && normalizePhone(p.phone) === normalizePhone(store.phone);
    return addressMatches || phoneMatches;
  });
  return strongMatches.length === 1 ? strongMatches[0]! : null;
}

function isAddressMatch(placeAddress: string, storeAddress: string): boolean {
  const a = placeAddress.replace(/\s+/g, "");
  const b = storeAddress.replace(/\s+/g, "");
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
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
    } catch {
      return {
        placesBasicInfo: {},
        warning: "Google Places再同期に失敗しました。既存情報のみで調査を続行します。",
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
      return { placesBasicInfo: {}, warning: null };
    }
    return { placesBasicInfo: placeResultToBasicInfo(matched, now), warning: null };
  } catch {
    return {
      placesBasicInfo: {},
      warning: "Google Places検索に失敗しました。既存情報のみで調査を続行します。",
    };
  }
}

