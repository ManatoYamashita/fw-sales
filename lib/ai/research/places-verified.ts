/**
 * Google Places 検証済みキーの導出(AI 店舗調査再設計 Plan v3.2 §9 / PR1 fresh review A)。
 *
 * confirmed の根拠として「(1) 最新Google Placesで検証済み」を認めるための
 * コンテキストを、既存の `stores.basic_info`(jsonb)から導出する。
 *
 * 注意: 本関数は `basic_info` に既に反映されている値を見るだけであり、Places API を
 * 再度呼び出す「Stage0 軽量再同期」自体は行わない(それは別途 orchestration 層が
 * `lib/places/` の既存機能を呼んでから本関数を呼ぶ想定)。したがって
 * 「最新」という言葉は「orchestration層がこの関数を呼ぶ直前の basic_info の状態」を
 * 指し、Stage0 が実際に直近で再同期を行っていることを保証するものではない。
 *
 * Source Registry(Web Source専用)には Places 由来のエントリを混ぜない設計のため、
 * この関数は Source Registry とは独立した第二の confirmed 根拠経路として
 * `validateResearchItemStatus` の `placesVerifiedKeys` にそのまま渡す。
 */

import type { BasicInfo } from "@/types/basic-info";

/**
 * Places が実際に自動取得する6項目(`lib/domain/basic-info-items.ts` の
 * `primary==="places"` のうち、`lib/places/to-basic-info.ts` が実際に埋める項目)。
 * ハードコードしている理由: Places APIのfield maskに存在しない
 * business_hours_holidays/official_site/location_feature/nearest_stationは
 * (primary="places"と定義されていても)Placesでは埋まらないため、これらを
 * 「Places検証済み」と誤認してconfirmedの根拠にしないよう明示的に除外する。
 */
export const PLACES_VERIFIABLE_KEYS = [
  "store_name",
  "address",
  "cuisine_genre",
  "phone",
  "review_avg",
  "review_count",
] as const;

/**
 * `basic_info` から、Places由来かつ値が充足済みのkey集合を導出する。
 * `filled_by==="manual"` の項目(営業担当が手動編集済み)は対象外
 * (Places検証ではなく人間の手動確認であり、意味論が異なるため)。
 */
export function derivePlacesVerifiedKeys(basicInfo: BasicInfo): Set<string> {
  const verified = new Set<string>();
  for (const key of PLACES_VERIFIABLE_KEYS) {
    const field = basicInfo[key];
    if (field?.filled_by === "places" && field.value !== null && field.value.trim() !== "") {
      verified.add(key);
    }
  }
  return verified;
}
