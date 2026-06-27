/**
 * エリア検索で見つかった候補のDB保存用型定義 (Issue #129 follow-up, 候補DB保存の土台)
 *
 * 規約上の理由 (Google Places利用規約) により、保存対象は `googlePlaceId` と
 * 探索メタ情報のみに限定する。店舗名・住所・評価・電話番号等のGoogle由来コンテンツは
 * 保存しない。
 */

/**
 * 候補の状態。
 * - `candidate`: 検索で見つかった未確定の候補 (初期状態)
 * - `added`: 店舗として登録済み
 * - `ignored`: ユーザーが除外した候補
 * - `stale`: 一定期間見つからなくなった候補 (将来拡張用、現在は未使用)
 */
export type PlaceCandidateStatus = "candidate" | "added" | "ignored" | "stale";

/** `place_candidates` テーブルの1レコード。 */
export interface PlaceCandidate {
  id: string;
  google_place_id: string;
  status: PlaceCandidateStatus;
  /** 初回に見つかった日 (YYYY-MM-DD)。以降の保存で更新しない。 */
  first_seen_at: string;
  /** 最後に見つかった日 (YYYY-MM-DD)。保存ごとに更新する。 */
  last_seen_at: string;
  /** 見つかった回数。保存ごとに +1。 */
  seen_count: number;
  /** この候補が見つかった探索ソースの集合 (重複なし)。`AreaSearchDiscoverySource[]` 相当。 */
  discovery_sources: string[];
  last_searched_keyword: string | null;
  last_searched_area: string | null;
  last_center_lat: number | null;
  last_center_lng: number | null;
  last_radius_meters: number | null;
  last_distance_meters: number | null;
  last_is_within_radius: boolean | null;
  /** DB登録済み店舗の `stores.id`。未登録の場合は null。 */
  matched_store_id: string | null;
  created_at: string;
  updated_at: string;
}
