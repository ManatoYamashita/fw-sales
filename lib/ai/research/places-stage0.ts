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
import { normalizeFormattedAddress } from "@/lib/places/to-store-input";
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
 * 店舗名一致 + (住所一致 or 電話一致) を満たす候補のみを抽出する
 * (`pickStrongPlaceMatch`/`diagnosePlacesMatch`共通のcore filter)。
 */
function findStrongMatches(
  candidates: readonly PlaceResult[],
  store: { name: string; address: string; phone: string },
): PlaceResult[] {
  const searchIdentityName = deriveSearchIdentityName(store.name);
  return candidates.filter((p) => {
    if (!isNameMatch(p.name, searchIdentityName)) return false;
    const addressMatches = store.address.trim() !== "" && isAddressMatch(p.formattedAddress, store.address);
    const phoneMatches =
      store.phone.trim() !== "" && p.phone.trim() !== "" && normalizePhone(p.phone) === normalizePhone(store.phone);
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
 * ハイフン様Unicode文字(全角ハイフン・各種ダッシュ・MINUS SIGN等)をASCIIハイフンへ
 * 統一する(feat/ai-research-final-trust-boundary)。
 *
 * 実際のGoogle Places Text Search応答を実APIで確認した結果、Google側の住所区切り文字が
 * `U+2212`(MINUS SIGN、数学記号)であり、`NFKC`正規化では変換されない
 * (`NFKC`が変換するのは全角ハイフン`U+FF0D`等の互換分解対象のみで、`U+2212`は対象外)
 * ことが判明した。この結果、`NFKC`だけでは正規化後も
 * `候補側:"...1-1−12..."`(末尾がU+2212混入)と`店舗側:"...1-1-12..."`(全てASCII)が
 * 一致しなかった(実データで確認済み、以前の実装ではここが原因で住所不一致になっていた)。
 */
function unifyDashLikeChars(raw: string): string {
  return raw.replace(/[‐‑‒–—−－]/g, "-");
}

/**
 * 日本住所の最小限の表記ゆれ吸収(feat/ai-research-searchfact-places-match、
 * feat/ai-research-final-trust-boundaryでダッシュ文字統一を追加)。
 *
 * 実際のGoogle Places候補データで検証済み: Google側`formattedAddress`
 * (例:「日本、〒277-0852 千葉県柏市旭町１丁目１−１２」全角数字・「丁目」表記・
 * MINUS SIGN区切り)と fw-sales側`stores.address`
 * (例:「〒2770852 千葉県 柏市 旭町1-1-12」半角ハイフン区切り)は、以下を行わない限り
 * 単純な部分一致では一致しない:
 * 1. `normalizeFormattedAddress`(既存、`lib/places/to-store-input.ts`)で
 *    先頭の「日本、」・郵便番号prefixを除去
 * 2. `NFKC`正規化で全角数字を半角化
 * 3. ハイフン様Unicode文字(`unifyDashLikeChars`)をASCIIハイフンへ統一
 * 4. 空白除去
 * 5. 「丁目」「番地」「番」「号」をハイフンへ統一(住所の意味的同一性推定等の
 *    過剰な曖昧化はしない、表記統一のみ)
 */
function normalizeJapaneseAddressForMatch(raw: string): string {
  return unifyDashLikeChars(normalizeFormattedAddress(raw).normalize("NFKC"))
    .replace(/\s+/g, "")
    .replace(/[丁目番地号]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isAddressMatch(placeAddress: string, storeAddress: string): boolean {
  const a = normalizeJapaneseAddressForMatch(placeAddress);
  const b = normalizeJapaneseAddressForMatch(storeAddress);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
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

