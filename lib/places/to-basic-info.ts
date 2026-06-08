/**
 * Google Places の検索結果 (`PlaceResult`) を `basic_info` の部分更新に変換する純関数。
 *
 * 既存 `placeResultToStoreInput` (`lib/places/to-store-input.ts`) は `StoreInput` の
 * フラットなスカラー列(name, address, genre, phone, review_avg, review_count, lat, lng, google_place_id)を組む
 * 用途で残置する。本ファイルは `basic_info` (jsonb 50 項目) の **primary="places" 項目**
 * のうち、PlaceResult API から直接取得できるものだけを `Partial<BasicInfo>` として返す。
 *
 * primary="places" の項目は計 7 つだが、PlaceResult が直接供給できるのは現状 3 項目:
 * - store_name              ← place.name
 * - address                 ← normalizeFormattedAddress(place.formattedAddress)
 * - cuisine_genre           ← mapGenre(place.types)
 *
 * 以下 4 項目は PlaceResult に対応するフィールドがないため本関数では返さず未充足のまま:
 * business_hours_holidays / official_site / location_feature / nearest_station
 * (将来 PlaceResult が拡張された際に本関数へ追加すればよい)。
 *
 * `BasicInfoField.filled_by` は `"places"` を、`updated_at` は引数 `now` を付してスタンプする
 * (design.md §Places L259 通り)。マージ採否は `store-repository.mergeBasicInfo` 経由で
 * `mergeBasicInfo` 純関数 (`lib/domain/basic-info-merge.ts`) が決定する。
 *
 * 関連: design.md §Places / placeResultToBasicInfo, requirements.md §3.1 §3.2
 */

import type { BasicInfo, BasicInfoField } from "@/types/basic-info";
import type { PlaceResult } from "./types";
import { mapGenre, normalizeFormattedAddress } from "./to-store-input";

/** `BasicInfoField` を組み、`filled_by="places"` と `updated_at=now` を必ずスタンプする。 */
function makePlacesField(
  value: string,
  tier: "A" | "B" | "C",
  now: string,
): BasicInfoField {
  return {
    value,
    tier,
    filled_by: "places",
    updated_at: now,
  };
}

/**
 * PlaceResult を `Partial<BasicInfo>` に変換する。
 *
 * - 値が空 (空文字 / 空配列) の項目は出力に含めない (`mergeBasicInfo` が「未充足のみ補完」と
 *   「primary 上書き」の判定を行うため、空値を渡すと意味のある既存値を空値で上書きする
 *   リスクがある)。
 * - 戻り値のキーはすべて `BASIC_INFO_ITEMS` の primary="places" 項目。
 *
 * @param place 取得した PlaceResult。
 * @param now   採用される `BasicInfoField.updated_at` に書き込む ISO 8601 文字列。
 *              決定性のため呼出側 (action 層) で現在時刻を生成して渡す。
 */
export function placeResultToBasicInfo(
  place: PlaceResult,
  now: string,
): Partial<BasicInfo> {
  const partial: Partial<BasicInfo> = {};

  // store_name (tier A, primary=places)
  if (typeof place.name === "string" && place.name.trim() !== "") {
    partial.store_name = makePlacesField(place.name, "A", now);
  }

  // address (tier A, primary=places) — 正規化済み単一文字列(分解はスカラー列が担う)
  if (
    typeof place.formattedAddress === "string" &&
    place.formattedAddress.trim() !== ""
  ) {
    const normalized = normalizeFormattedAddress(place.formattedAddress);
    if (normalized !== "") {
      partial.address = makePlacesField(normalized, "A", now);
    }
  }

  // cuisine_genre (tier A, primary=places) — types から日本語業態
  // mapGenre は未一致時に空文字、`restaurant`/`food` フォールバックで "その他" を返す。
  // "その他" も「公開情報がそう」という事実情報として返す (より具体的な手動値が後で
  // 入れば mergeBasicInfo が "manual" 不可侵で保護する)。
  if (Array.isArray(place.types)) {
    const genre = mapGenre(place.types);
    if (genre !== "") {
      partial.cuisine_genre = makePlacesField(genre, "A", now);
    }
  }

  return partial;
}
