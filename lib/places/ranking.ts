import { formatDistanceMeters } from "@/lib/utils/geo";
import { formatDiscoverySources } from "./discovery";
import type { AreaSearchPlaceViewModel } from "./types";

/**
 * エリア検索結果一覧の表示順。
 * - `salesCandidate`: 営業候補順 (デフォルト)
 * - `google`: Googleおすすめ順 (Text Search の返却順)
 * - `distance`: 距離が近い順
 * - `unregistered`: 未登録優先
 * - `rating`: 評価が高い順
 * - `reviews`: 口コミ数が多い順
 */
export type AreaSearchSortMode =
  | "salesCandidate"
  | "google"
  | "distance"
  | "unregistered"
  | "rating"
  | "reviews";

export const AREA_SEARCH_SORT_MODE_LABELS: Record<AreaSearchSortMode, string> = {
  salesCandidate: "営業候補順",
  google: "Googleおすすめ順",
  distance: "距離が近い順",
  unregistered: "未登録優先",
  rating: "評価が高い順",
  reviews: "口コミ数が多い順",
};

export const AREA_SEARCH_SORT_MODES: readonly AreaSearchSortMode[] = [
  "salesCandidate",
  "google",
  "distance",
  "unregistered",
  "rating",
  "reviews",
];

export const DEFAULT_AREA_SEARCH_SORT_MODE: AreaSearchSortMode = "salesCandidate";

/** 一括追加対象 (登録候補): DB未登録 かつ まだ追加していない店舗 */
export function isEligiblePlace(
  { matchedStore, place }: AreaSearchPlaceViewModel,
  addedIds: ReadonlySet<string>,
): boolean {
  return matchedStore === null && !addedIds.has(place.placeId);
}

type Comparator = (
  a: AreaSearchPlaceViewModel,
  b: AreaSearchPlaceViewModel,
) => number;

/** 真 (優先) を 0、偽を 1 にする。`Array.sort` の昇順比較に使う。 */
function rankBool(value: boolean): number {
  return value ? 0 : 1;
}

/** 昇順 (近い/小さい方を優先)。 */
function compareAscending(a: number, b: number): number {
  return a - b;
}

/**
 * 降順 (大きい方を優先)。`null` は「不明」として常に最下位に回す
 * (0として上位に来てしまわないようにする)。
 */
function compareDescendingNullsLast(
  a: number | null,
  b: number | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

const byUnregisteredFirst: Comparator = (a, b) =>
  rankBool(a.matchedStore === null) - rankBool(b.matchedStore === null);

function byNotAddedFirst(addedIds: ReadonlySet<string>): Comparator {
  return (a, b) =>
    rankBool(!addedIds.has(a.place.placeId)) -
    rankBool(!addedIds.has(b.place.placeId));
}

function byEligibleFirst(addedIds: ReadonlySet<string>): Comparator {
  return (a, b) =>
    rankBool(isEligiblePlace(a, addedIds)) -
    rankBool(isEligiblePlace(b, addedIds));
}

const byInRangeFirst: Comparator = (a, b) =>
  rankBool(a.isWithinRadius) - rankBool(b.isWithinRadius);

const byDistanceAscending: Comparator = (a, b) =>
  compareAscending(a.distanceMeters, b.distanceMeters);

const byRatingDescending: Comparator = (a, b) =>
  compareDescendingNullsLast(a.place.rating, b.place.rating);

const byReviewsDescending: Comparator = (a, b) =>
  compareDescendingNullsLast(a.place.userRatingsTotal, b.place.userRatingsTotal);

/**
 * 複数の比較関数を順に適用し、最初に差が出た結果を返す合成comparatorを作る。
 * 全て同点の場合は 0 (呼び出し側で元配列順を維持するための index tie-break を行う)。
 */
function combineComparators(...comparators: Comparator[]): Comparator {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

// `combineComparators` の比較関数を1つ追加するだけで、`discovery.sourceCount`
// (複数探索で見つかった候補を優先するルール) を将来 salesCandidate 等に組み込める。
// 今回はデフォルトの並び順を変えないため未追加。
function comparatorForMode(
  mode: AreaSearchSortMode,
  addedIds: ReadonlySet<string>,
): Comparator | null {
  switch (mode) {
    case "google":
      // Google返却順 (元配列順) を維持するため、追加の並び替えは行わない。
      return null;
    case "salesCandidate":
      return combineComparators(
        byUnregisteredFirst,
        byNotAddedFirst(addedIds),
        byInRangeFirst,
        byDistanceAscending,
        byRatingDescending,
        byReviewsDescending,
      );
    case "unregistered":
      return combineComparators(
        byEligibleFirst(addedIds),
        byInRangeFirst,
        byDistanceAscending,
        byRatingDescending,
        byReviewsDescending,
      );
    case "distance":
      return combineComparators(byDistanceAscending);
    case "rating":
      return combineComparators(
        byRatingDescending,
        byReviewsDescending,
        byDistanceAscending,
      );
    case "reviews":
      return combineComparators(
        byReviewsDescending,
        byRatingDescending,
        byDistanceAscending,
      );
    default:
      return null;
  }
}

/**
 * エリア検索結果を指定の表示順で並び替える。
 *
 * - 元配列 (`results`) は破壊しない (常に新しい配列を返す)。
 * - 同点の場合は元の配列順 (= Google返却順) を維持する (安定ソート)。
 * - `mode === "google"` の場合は単純なコピーを返す (並び替えなし)。
 */
export function sortAreaSearchResults(
  results: readonly AreaSearchPlaceViewModel[],
  mode: AreaSearchSortMode,
  addedIds: ReadonlySet<string>,
): AreaSearchPlaceViewModel[] {
  const comparator = comparatorForMode(mode, addedIds);
  if (!comparator) {
    return [...results];
  }

  // 同点時に元の配列順を維持するため、index を tie-break として明示的に使う
  // (Array.sort のエンジン依存の安定性に頼らない)。
  return results
    .map((vm, index) => ({ vm, index }))
    .sort((a, b) => comparator(a.vm, b.vm) || a.index - b.index)
    .map(({ vm }) => vm);
}

/**
 * 店舗カードに表示する「上位理由」を返す。
 * 登録状況・追加状況・範囲内外・距離・評価・口コミ数を、表示順に応じた優先度に
 * かかわらず一定の順序で並べる。
 */
export function getAreaSearchRankingReasons(
  result: AreaSearchPlaceViewModel,
  addedIds: ReadonlySet<string>,
): string[] {
  const reasons: string[] = [];

  reasons.push(result.matchedStore !== null ? "登録済み" : "未登録");

  if (addedIds.has(result.place.placeId)) {
    reasons.push("追加済み");
  }

  reasons.push(result.isWithinRadius ? "範囲内" : "範囲外");

  reasons.push(formatDistanceMeters(result.distanceMeters));

  if (result.place.rating !== null) {
    reasons.push(`評価${result.place.rating.toFixed(1)}`);
  }

  if (result.place.userRatingsTotal !== null) {
    reasons.push(`口コミ${result.place.userRatingsTotal.toLocaleString()}件`);
  }

  // 取得元 (どの探索で見つかったか)。例: "メイン検索" / "メイン検索 + 追加キーワード"。
  reasons.push(formatDiscoverySources(result.discovery));

  return reasons;
}
