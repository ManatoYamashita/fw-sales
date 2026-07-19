import type { Store } from "@/types/store";
import type { PlaceResult, MatchedStoreSummary, PlaceWithMatch } from "./types";
import { distanceMeters } from "@/lib/utils/geo";

/** Lat/lng bounding box used to narrow the store DB query for area search. */
export interface PlacesBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Degrees added as a safety margin around the places bbox.
 * 0.001° is about 111 m in latitude; longitude distance becomes shorter as
 * latitude increases. In Japan's practical latitude range it still safely
 * covers the 50 m proximity threshold. This is a coarse candidate-fetching
 * margin, not an exact degrees-to-distance conversion.
 */
const BBOX_MARGIN_DEGREES = 0.001;

/**
 * Computes a padded bounding box that encloses all place coordinates.
 * Returns null when places is empty (caller should skip the DB query).
 */
export function computePlacesBounds(
  places: readonly { lat: number; lng: number }[],
): PlacesBounds | null {
  if (places.length === 0) return null;
  let minLat = places[0]!.lat;
  let maxLat = places[0]!.lat;
  let minLng = places[0]!.lng;
  let maxLng = places[0]!.lng;
  for (const p of places) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return {
    minLat: minLat - BBOX_MARGIN_DEGREES,
    maxLat: maxLat + BBOX_MARGIN_DEGREES,
    minLng: minLng - BBOX_MARGIN_DEGREES,
    maxLng: maxLng + BBOX_MARGIN_DEGREES,
  };
}

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

  // 第二優先: 店名一致 + 50m以内 (Place ID の有無・新旧を問わない)
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
