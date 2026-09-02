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
import { toPlacesDiagnosticKind } from "@/lib/places/errors";
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

/** Stage0 がどちらの経路を通ったか。 */
export type Stage0Path = "place_id" | "text_search";

/** Stage0 の結末。値そのものは含めず種別のみ。 */
export type Stage0Outcome = "matched" | "no_match" | "ambiguous" | "timeout" | "api_error";

/**
 * strong match の2つのゲート(住所一致 / 電話一致)へ、そもそも入力が届いていたか
 * (PR #180 pre-merge fix: Stage0 Places Identity Recovery)。
 *
 * `findStrongMatches` は `store.address.trim() !== ""` と
 * `normalizePhone(store.phone) !== ""` を前提条件にしており、どちらも空だと
 * **候補が正しくても strong match が構造的に成立しない**。この2つの boolean が無いと、
 * `places_search_no_match` を見たときに
 *
 * - 住所は届いたが候補と一致しなかった(= Places 側 or 住所データの問題)
 * - そもそも住所が届いていなかった(= data plumbing の問題)
 *
 * を実機ログから切り分けられない。実際 `stores.prefecture` / `stores.city` が
 * Stage0 へ渡っていなかった bug は、この観測点が無かったために発見が遅れた。
 *
 * **住所・電話番号・place_id の値そのものは絶対に含めない**(boolean のみ)。
 */
export interface Stage0IdentityInputs {
  /** `trim` 後に非空の住所が渡されたか。 */
  has_address: boolean;
  /**
   * `normalizePhone` 後に数字が1桁以上残る電話番号が渡されたか。
   *
   * 生の非空判定ではなく正規化後で見るのは、`stores.phone` が `text().notNull()` で
   * フォーマット検証を持たず「不明」「未掲載」「-」のような値が実在しうるため。
   * これらは `findStrongMatches` の電話一致でも使われない(正規化後に "" になる)ので、
   * 診断も同じ基準に揃える。
   */
  has_phone: boolean;
}

/**
 * Stage0 の sanitized な診断情報(feat/ai-research-quality-ux-hardening、Plan §6.3)。
 *
 * 従来は失敗時の `warning` しか残らず、**成功時は何も観測できなかった**。
 * `google_place_id=null` の店舗で Text Search が strong match したのかどうかを
 * 後から判断する手段が無く、実機事象の切り分けで DB を直接開く必要があった。
 *
 * **店舗名・place_id・住所・評価値などの個別情報は一切含めない。**
 * DBへは保存せず、structured log へのみ出す(migration 不要)。
 */
export interface Stage0Diagnostic {
  path: Stage0Path;
  outcome: Stage0Outcome;
  /** `rating` / `userRatingCount` を実際に取得できたか(**値そのものは載せない**)。 */
  review_fields_present: boolean;
  /** strong match のゲートへ住所/電話が届いていたか(**値そのものは載せない**)。 */
  identity_inputs: Stage0IdentityInputs;
}

/**
 * Stage0 の Text Search で strong match が**一意に**成立した Place の
 * 住所・電話番号(PR #180 Sparse Store Source Identity Recovery)。
 *
 * ## 用途
 *
 * Stage2 完了**後**の `applySourceIdentityVerification` で、モデルが Web 本文から
 * 報告した `observed_address` / `observed_phone` と突き合わせる **anchor** としてのみ使う。
 *
 * ## なぜ必要か
 *
 * `isTargetStoreMatch`(`identity-match.ts`)は
 * 「名前一致 AND (住所一致 OR 電話一致)」を要求し、比較相手が空文字の場合は
 * `target.address.trim() !== ""` / `normalizePhone(target.phone) !== ""` のガードで
 * **必ず false** になる。`stores.address` と `stores.phone` が両方空の店舗
 * (実機: 告膳)では、Web ページが正しくても `target_match` が**構造的に成立しない**。
 * 実機 run では 10 source 中 9 件が `url_context_status="success"` でありながら
 * `target_match` が 0 件、53 項目中 19 項目が not_found へ降格していた。
 *
 * ## 安全上の制約(必ず守ること)
 *
 * - **`Stage1` / `Stage2` の prompt へ絶対に渡さない。** Gemini が見ていない値と
 *   post-hoc に照合することが目的であり、prompt へ入れると F1(モデルが target identity を
 *   observed_* へコピーして自己申告で昇格する問題)を悪化させる
 * - **`text_search` かつ `outcome === "matched"` の分岐でのみ非 null にする。**
 *   `place_id` 経路は `getPlaceById` の結果に独立した identity 検証が無いため対象外
 * - **name / place_id / rating / userRatingCount / genre / raw API response を含めない。**
 *   型として持てないようフィールドを 2 つに限定する
 * - **structured log へ spread しない。** ログへ出すのは従来どおり `diagnostic` のみ
 */
export interface VerifiedPlacesIdentity {
  /** Places の `formattedAddress`(生値)。正規化は `isAddressMatch` 側が行う。 */
  address: string;
  /** Places の `nationalPhoneNumber`。未取得時は空文字(捏造しない)。 */
  phone: string;
}

export interface Stage0PlacesResult {
  /** 取得できた場合のみ非空。`filled_by: "places"` がスタンプ済み(in-memory専用)。 */
  placesBasicInfo: Partial<BasicInfo>;
  /** 失敗の場合のみ非null。run.warnings へ追加することを想定した平易な文言。 */
  warning: string | null;
  /** 成功・失敗を問わず必ず埋まる sanitized な診断情報(structured log 用)。 */
  diagnostic: Stage0Diagnostic;
  /**
   * **`text_search` で strong match が一意成立した場合のみ**非 null。
   *
   * `place_id` 経路 / `no_match` / `ambiguous` / `timeout` / `api_error` では必ず `null`。
   * この「安全な経路でのみ非 null」は呼び出し側の責任ではなく、
   * `runStage0PlacesResync` の**構築時の不変条件**として保証する。
   */
  verifiedIdentity: VerifiedPlacesIdentity | null;
}

/** `classifyPlacesError` の分類から診断 outcome を導く(timeout だけを区別する)。 */
function outcomeFromErrorKind(kind: string): Stage0Outcome {
  return kind === "timeout" ? "timeout" : "api_error";
}

/**
 * `review_avg` / `review_count` が実際に埋まったかを判定する。
 * `placeResultToBasicInfo` は rating/userRatingsTotal が無い場合これらを射影しない。
 */
function hasReviewFields(placesBasicInfo: Partial<BasicInfo>): boolean {
  return (
    placesBasicInfo.review_avg?.value != null || placesBasicInfo.review_count?.value != null
  );
}

/**
 * `findStrongMatches` が住所一致 / 電話一致で使う前提条件と**同じ判定**で、
 * 入力が届いていたかだけを boolean 化する(値は載せない)。
 */
function deriveIdentityInputs(store: {
  address: string;
  phone: string;
}): Stage0IdentityInputs {
  return {
    has_address: store.address.trim() !== "",
    has_phone: normalizePhone(store.phone) !== "",
  };
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
 * Places API失敗時のエラーから、secretや生レスポンス本文を含まないsanitizedな
 * 種別文字列を導出する (feat/ai-research-final-quality、PR #187のGemini観測性修正と
 * 同じ方針)。戻り値は `"timeout"` / `"missing_api_key"` / `"api_error:<status>"` /
 * `"unknown"`。
 *
 * 実装は `lib/places/errors.ts` の `toPlacesDiagnosticKind` に一本化した (Issue #201)。
 * 従来はここで `Error.message` を正規表現パースしていたが、`lib/places/google.ts` が
 * status を持つ型付きエラー (`PlacesApiError`) を投げるようになったため、分類ロジックを
 * Places モジュール側へ寄せ、同じ判定が2箇所に存在する状態を解消している。
 * 本 export は既存呼び出し元 (本ファイル内および回帰テスト) の互換のために残す。
 */
export function classifyPlacesError(err: unknown): string {
  return toPlacesDiagnosticKind(err);
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
  /**
   * Places 呼び出しの明示 timeout(runtime reliability hardening、F5)。
   * 未指定なら従来どおり timeout 無しで呼ぶ。Workflow からは
   * `run-timing.ts:STAGE0_PLACES_TIMEOUT_MS` を渡す。
   */
  timeoutMs?: number;
}): Promise<Stage0PlacesResult> {
  const { googlePlaceId, store, now, timeoutMs } = params;
  // 未指定時は `undefined` を渡す = `lib/places/google.ts` 側で `signal` を付けない。
  const requestOptions = timeoutMs === undefined ? undefined : { timeoutMs };
  // 成功・失敗・経路を問わず全ての return で同じ値を載せる(観測の欠損を作らない)。
  const identityInputs = deriveIdentityInputs(store);

  if (googlePlaceId !== null && googlePlaceId.trim() !== "") {
    try {
      const place = await getPlaceById(googlePlaceId, requestOptions);
      if (place === null) {
        return {
          placesBasicInfo: {},
          warning: "Google Placesの店舗情報を再取得できませんでした(該当なし)。既存情報のみで調査を続行します。",
          diagnostic: {
            path: "place_id",
            outcome: "no_match",
            review_fields_present: false,
            identity_inputs: identityInputs,
          },
          verifiedIdentity: null,
        };
      }
      const placesBasicInfo = placeResultToBasicInfo(place, now);
      return {
        placesBasicInfo,
        warning: null,
        diagnostic: {
          path: "place_id",
          outcome: "matched",
          review_fields_present: hasReviewFields(placesBasicInfo),
          identity_inputs: identityInputs,
        },
        verifiedIdentity: null,
      };
    } catch (err) {
      const kind = classifyPlacesError(err);
      return {
        placesBasicInfo: {},
        warning: `Google Places再同期に失敗しました (${kind})。既存情報のみで調査を続行します。`,
        diagnostic: {
          path: "place_id",
          outcome: outcomeFromErrorKind(kind),
          review_fields_present: false,
          identity_inputs: identityInputs,
        },
        verifiedIdentity: null,
      };
    }
  }

  try {
    const searchIdentityName = deriveSearchIdentityName(store.name);
    const candidates = await searchPlaces(searchIdentityName, store.address, requestOptions);
    const matched = pickStrongPlaceMatch(candidates, store);
    if (!matched) {
      // 曖昧(0件 or 複数件)の場合は不採用。従来どおりWeb調査へfallbackする
      // (無理に埋めない、Plan v3.2の自動Text Searchスコープ外方針の精神を維持)。
      // API自体は成功しているため、完全silentにせずsanitizedな診断種別のみ記録する
      // (feat/ai-research-searchfact-places-match、候補店舗名等は一切含めない)。
      const matchKind = diagnosePlacesMatch(candidates, store);
      return {
        placesBasicInfo: {},
        warning: `Google Places候補が一意に特定できませんでした (${matchKind})。既存情報のみで調査を続行します。`,
        diagnostic: {
          path: "text_search",
          outcome: matchKind === "places_search_ambiguous" ? "ambiguous" : "no_match",
          review_fields_present: false,
          identity_inputs: identityInputs,
        },
        verifiedIdentity: null,
      };
    }
    const placesBasicInfo = placeResultToBasicInfo(matched, now);
    return {
      placesBasicInfo,
      warning: null,
      diagnostic: {
        path: "text_search",
        outcome: "matched",
        review_fields_present: hasReviewFields(placesBasicInfo),
        identity_inputs: identityInputs,
      },
      // strong match が一意成立したこの分岐**だけ**が anchor を返す(構築時の不変条件)。
      // 判定材料は `pickStrongPlaceMatch` の成立のみで、`BasicInfoField.filled_by` 等は使わない。
      verifiedIdentity: { address: matched.formattedAddress, phone: matched.phone },
    };
  } catch (err) {
    const kind = classifyPlacesError(err);
    return {
      placesBasicInfo: {},
      warning: `Google Places検索に失敗しました (${kind})。既存情報のみで調査を続行します。`,
      diagnostic: {
        path: "text_search",
        outcome: outcomeFromErrorKind(kind),
        review_fields_present: false,
        identity_inputs: identityInputs,
      },
      verifiedIdentity: null,
    };
  }
}

