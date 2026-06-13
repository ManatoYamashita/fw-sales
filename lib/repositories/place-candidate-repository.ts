/**
 * PlaceCandidateRepository interface (エリア検索 候補DB保存の土台 / Issue #129 follow-up)
 *
 * `place_candidates` テーブルへのアクセス契約。
 *
 * 設計上の不変条件:
 * - `google_place_id` 単位で1レコードに統合する (UNIQUE 制約)
 * - `first_seen_at` は初回保存時のみ設定し、以降の保存では更新しない
 * - `last_seen_at` / `seen_count` は保存ごとに更新・加算する
 * - `discovery_sources` は既存ソースと新規ソースを重複なく統合する
 * - `status` が `added` / `ignored` の場合、保存によって `candidate` に戻さない
 * - `place.placeId` が空の候補は保存をスキップする (skippedCount に計上)
 *
 * 関連: types/place-candidate.ts, lib/db/place-candidate-repository.ts
 */

import type { AreaSearchPlaceViewModel, SearchCenter } from "@/lib/places/types";

export interface UpsertPlaceCandidatesFromAreaSearchParams {
  places: readonly AreaSearchPlaceViewModel[];
  /** 検索に使用したキーワード。`last_searched_keyword` に保存する。 */
  keyword: string;
  /** 検索に使用した中心地点の入力値 (駅名・住所など)。`last_searched_area` に保存する。 */
  area: string;
  /** 検索に使用した中心地点の緯度経度。 */
  center: SearchCenter;
  /** 検索に使用した半径 (メートル)。 */
  radiusMeters: number;
}

export interface UpsertPlaceCandidatesFromAreaSearchResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
}

export interface PlaceCandidateRepository {
  /**
   * エリア検索結果 (`AreaSearchPlaceViewModel[]`) を候補として upsert 保存する。
   *
   * - `places[].place.placeId` が空の要素はスキップする
   * - 既存の `google_place_id` はレコードを更新する (insert しない)
   * - 新規の `google_place_id` はレコードを新規作成する
   */
  upsertFromAreaSearch(
    params: UpsertPlaceCandidatesFromAreaSearchParams,
  ): Promise<UpsertPlaceCandidatesFromAreaSearchResult>;
}
