import type { Store } from "@/types/store";
import type { PlaceResult, MatchedStoreSummary, PlaceWithMatch } from "./types";
import { distanceMeters } from "@/lib/utils/geo";

const PROXIMITY_THRESHOLD_M = 50;

/**
 * 1件の PlaceResult に対して、既存 Store[] の中から一致する店舗を返す。
 *
 * 判定順序:
 * 1. google_place_id 完全一致 (第一優先)
 * 2. 店名完全一致 + 50m以内 (補助。store.lat/lng が null の場合はスキップ)
 *
 * どちらも一致しない場合は null を返す。
 */
export function findMatchedStore(
  place: PlaceResult,
  stores: readonly Store[],
): MatchedStoreSummary | null {
  // 第一優先: google_place_id 完全一致
  const byPlaceId = stores.find(
    (s) => s.google_place_id !== null && s.google_place_id === place.placeId,
  );
  if (byPlaceId) {
    return { id: byPlaceId.id, name: byPlaceId.name };
  }

  // 第二優先: 店名一致 + 50m以内 (google_place_id が null の手動登録店舗を拾う)
  const byProximity = stores.find((s) => {
    if (s.lat === null || s.lng === null) return false;
    if (s.name !== place.name) return false;
    return distanceMeters(s.lat, s.lng, place.lat, place.lng) <= PROXIMITY_THRESHOLD_M;
  });

  return byProximity ? { id: byProximity.id, name: byProximity.name } : null;
}

/**
 * PlaceResult[] の各要素に DB照合結果を付与して PlaceWithMatch[] を返す。
 */
export function attachStoreMatches(
  places: readonly PlaceResult[],
  stores: readonly Store[],
): PlaceWithMatch[] {
  return places.map((place) => ({
    place,
    matchedStore: findMatchedStore(place, stores),
  }));
}
