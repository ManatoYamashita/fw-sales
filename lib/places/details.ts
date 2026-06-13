import type { AreaSearchPlaceViewModel, PlaceDetailsResult } from "./types";

/**
 * Place Detailsオンデマンド取得結果を、エリア検索結果1件分にmergeする。
 *
 * - 元の `result` は破壊しない (常に新しいオブジェクトを返す)。
 * - `placeId` が一致しない場合は `result` をそのまま返す (mergeしない)。
 * - `details` 側の値が無い (空文字/null) フィールドは、既存の有効値を維持する
 *   (Place Detailsが未取得の項目で既存値を不用意に消さないため)。
 * - `discovery` / `matchedStore` / `distanceMeters` / `isWithinRadius` は維持する。
 */
export function mergePlaceDetailsIntoAreaSearchResult(
  result: AreaSearchPlaceViewModel,
  details: PlaceDetailsResult,
): AreaSearchPlaceViewModel {
  if (result.place.placeId !== details.placeId) {
    return result;
  }

  return {
    ...result,
    place: {
      ...result.place,
      phone: details.phone !== "" ? details.phone : result.place.phone,
      rating: details.rating !== null ? details.rating : result.place.rating,
      userRatingsTotal:
        details.userRatingsTotal !== null
          ? details.userRatingsTotal
          : result.place.userRatingsTotal,
    },
    websiteUri: details.websiteUri !== null ? details.websiteUri : result.websiteUri ?? null,
    businessStatus:
      details.businessStatus !== null ? details.businessStatus : result.businessStatus ?? null,
  };
}
