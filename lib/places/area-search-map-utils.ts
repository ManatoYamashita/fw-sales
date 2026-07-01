/**
 * Pure view utilities for the area-search map (no DOM dependencies).
 * Extracted from area-search-map.tsx so that zoomForRadius and markerColorFor
 * can be unit-tested independently.
 */

import type { MatchedStoreSummary } from "./types";

export const PIN_COLORS = {
  eligible: "#2563eb",   // unregistered candidate: blue
  registered: "#9ca3af", // already in DB: gray
  added: "#16a34a",      // added in this session: green
  outOfRange: "#d1d5db", // outside search radius: light gray
} as const;

/** Subset of AreaSearchPlaceViewModel containing only the fields markerColorFor reads. */
export interface PlaceMarkerState {
  matchedStore: MatchedStoreSummary | null;
  isWithinRadius: boolean;
}

/**
 * Returns an appropriate Google Maps zoom level for a given search radius.
 * 500m -> 16 / 1km -> 15 / 2km -> 14 / larger -> 13
 */
export function zoomForRadius(radiusMeters: number): number {
  if (radiusMeters <= 500) return 16;
  if (radiusMeters <= 1000) return 15;
  if (radiusMeters <= 2000) return 14;
  return 13;
}

/**
 * Returns the marker color for a place based on its current state.
 * Priority: isAdded > matchedStore != null > !isWithinRadius > eligible
 */
export function markerColorFor(place: PlaceMarkerState, isAdded: boolean): string {
  if (isAdded) return PIN_COLORS.added;
  if (place.matchedStore !== null) return PIN_COLORS.registered;
  if (!place.isWithinRadius) return PIN_COLORS.outOfRange;
  return PIN_COLORS.eligible;
}
