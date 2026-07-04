import { describe, expect, it } from "vitest";
import {
  PIN_COLORS,
  markerColorFor,
  zoomForRadius,
  type PlaceMarkerState,
} from "../area-search-map-utils";

// ---- zoomForRadius --------------------------------------------------------

describe("zoomForRadius", () => {
  it("returns 16 for radius <= 500m", () => {
    expect(zoomForRadius(1)).toBe(16);
    expect(zoomForRadius(500)).toBe(16);
  });

  it("returns 15 for radius 501m-1000m (boundary)", () => {
    expect(zoomForRadius(501)).toBe(15);
    expect(zoomForRadius(1000)).toBe(15);
  });

  it("returns 14 for radius 1001m-2000m (boundary)", () => {
    expect(zoomForRadius(1001)).toBe(14);
    expect(zoomForRadius(2000)).toBe(14);
  });

  it("returns 13 for radius >= 2001m", () => {
    expect(zoomForRadius(2001)).toBe(13);
    expect(zoomForRadius(3000)).toBe(13);
    expect(zoomForRadius(50_000)).toBe(13);
  });
});

// ---- markerColorFor -------------------------------------------------------

function makeState(overrides: Partial<PlaceMarkerState> = {}): PlaceMarkerState {
  return { matchedStore: null, isWithinRadius: true, ...overrides };
}

describe("markerColorFor", () => {
  it("returns PIN_COLORS.added when isAdded is true", () => {
    expect(markerColorFor(makeState(), true)).toBe(PIN_COLORS.added);
  });

  it("returns PIN_COLORS.registered when matchedStore is non-null", () => {
    expect(
      markerColorFor(makeState({ matchedStore: { id: "s1", name: "Store" } }), false),
    ).toBe(PIN_COLORS.registered);
  });

  it("returns PIN_COLORS.outOfRange when isWithinRadius is false", () => {
    expect(markerColorFor(makeState({ isWithinRadius: false }), false)).toBe(
      PIN_COLORS.outOfRange,
    );
  });

  it("returns PIN_COLORS.eligible for a normal eligible store", () => {
    expect(markerColorFor(makeState(), false)).toBe(PIN_COLORS.eligible);
  });

  it("isAdded takes priority over non-null matchedStore", () => {
    expect(
      markerColorFor(makeState({ matchedStore: { id: "s1", name: "Store" } }), true),
    ).toBe(PIN_COLORS.added);
  });

  it("isAdded takes priority over isWithinRadius=false", () => {
    expect(markerColorFor(makeState({ isWithinRadius: false }), true)).toBe(
      PIN_COLORS.added,
    );
  });

  it("non-null matchedStore takes priority over isWithinRadius=false", () => {
    expect(
      markerColorFor(
        makeState({ matchedStore: { id: "s1", name: "Store" }, isWithinRadius: false }),
        false,
      ),
    ).toBe(PIN_COLORS.registered);
  });
});
