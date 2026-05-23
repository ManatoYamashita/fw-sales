import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceResult } from "@/lib/places/types";

import {
  enrichWithPlacesFallback,
  mergePlaceIntoApply,
  pickBestPlace,
} from "../places-fallback";
import type { ApplyResult, ParsedUrl } from "../types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/places/google", () => ({
  searchPlaces: vi.fn(),
}));

const { searchPlaces } = await import("@/lib/places/google");
const mockedSearchPlaces = vi.mocked(searchPlaces);

function makeApplied(overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    name: "",
    prefecture: "",
    city: "",
    phone: "",
    site_url: "",
    map_url: "",
    instagram_url: "",
    genre: "",
    address: "",
    review_avg: null,
    review_count: null,
    memo: "",
    operator_type: "未設定",
    operator_name: "",
    confidence: {},
    ...overrides,
  };
}

function makePlace(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    placeId: "ChIJtest",
    name: "導楽",
    formattedAddress: "神奈川県川崎市中原区新丸子東1-983",
    lat: 35.5,
    lng: 139.6,
    phone: "044-750-9977",
    rating: 3.4,
    userRatingsTotal: 12,
    types: ["restaurant", "food"],
    googleMapsUri: "https://maps.google.com/?cid=123",
    ...overrides,
  };
}

const TABELOG_PARSED: ParsedUrl = {
  type: "tabelog",
  source_url: "https://tabelog.com/kanagawa/A1405/A140504/14096697/",
  station_area: "新丸子",
  confidence: {},
};

beforeEach(() => {
  mockedSearchPlaces.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pickBestPlace", () => {
  it("完全一致 (name 完全一致) を最優先", () => {
    const places = [
      makePlace({ placeId: "A", name: "導楽 別店舗", userRatingsTotal: 100 }),
      makePlace({ placeId: "B", name: "導楽", userRatingsTotal: 10 }),
    ];
    expect(pickBestPlace(places, "導楽")?.placeId).toBe("B");
  });

  it("完全一致なしのとき userRatingsTotal 最多を選択", () => {
    const places = [
      makePlace({ placeId: "A", name: "導楽 新丸子店", userRatingsTotal: 5 }),
      makePlace({ placeId: "B", name: "導楽 二号店", userRatingsTotal: 50 }),
    ];
    expect(pickBestPlace(places, "導楽")?.placeId).toBe("B");
  });

  it("空配列なら null", () => {
    expect(pickBestPlace([], "導楽")).toBeNull();
  });
});

describe("mergePlaceIntoApply", () => {
  it("既存 phone (信頼度 90) は Places の値で上書きされない", () => {
    const base = makeApplied({
      name: "導楽",
      phone: "044-XXX-XXXX",
      confidence: { name: 88, phone: 90 },
    });
    const merged = mergePlaceIntoApply(base, makePlace());
    expect(merged.phone).toBe("044-XXX-XXXX");
    expect(merged.confidence.phone).toBe(90);
  });

  it("既存 phone (信頼度 75) は Places の値で上書きされ信頼度 88 になる", () => {
    const base = makeApplied({
      name: "導楽",
      phone: "044-OLD-VALUE",
      confidence: { name: 88, phone: 75 },
    });
    const merged = mergePlaceIntoApply(base, makePlace());
    expect(merged.phone).toBe("044-750-9977");
    expect(merged.confidence.phone).toBe(88);
  });

  it("PLACES_API_SCORE で確定値を入れる", () => {
    const base = makeApplied();
    const merged = mergePlaceIntoApply(base, makePlace());
    expect(merged.name).toBe("導楽");
    expect(merged.confidence.name).toBe(88);
    expect(merged.address).toBe("神奈川県川崎市中原区新丸子東1-983");
    expect(merged.prefecture).toBe("神奈川県");
    expect(merged.city).toBe("川崎市");
    expect(merged.confidence.address).toBe(88);
  });
});

describe("enrichWithPlacesFallback", () => {
  it("reason=none のとき searchPlaces を呼ばない (高信頼度フルセット)", async () => {
    const applied = makeApplied({
      name: "導楽",
      prefecture: "神奈川県",
      city: "川崎市",
      address: "神奈川県川崎市中原区新丸子東1-983",
      confidence: { name: 90, prefecture: 95, city: 95, address: 90 },
    });
    const result = await enrichWithPlacesFallback(null, applied);
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
    expect(result.info.used).toBe(false);
    expect(result.info.reason).toBe("none");
  });

  it("API キー未設定で例外 → silently skip (no_api_key)", async () => {
    mockedSearchPlaces.mockRejectedValueOnce(
      new Error("GOOGLE_PLACES_API_KEY が設定されていません"),
    );
    const parsedWithName: ParsedUrl = {
      ...TABELOG_PARSED,
      name: "導楽",
    };
    const applied = makeApplied({ name: "", confidence: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await enrichWithPlacesFallback(parsedWithName, applied);
    expect(result.info.used).toBe(false);
    expect(result.info.reason).toBe("no_api_key");
    expect(warnSpy).toHaveBeenCalled();
    expect(result.updated).toBe(applied); // 元 ApplyResult をそのまま返す
  });

  it("ネットワーク例外 → silently skip (api_error)", async () => {
    mockedSearchPlaces.mockRejectedValueOnce(
      new Error("Places API エラー (503): service unavailable"),
    );
    const applied = makeApplied({
      name: "導楽",
      confidence: { name: 50 },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await enrichWithPlacesFallback(null, applied);
    expect(result.info.used).toBe(false);
    expect(result.info.reason).toBe("api_error");
  });

  it("ヒット 0 件 → used=false, reason=places_not_found", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([]);
    const applied = makeApplied({
      name: "存在しない店",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(null, applied);
    expect(mockedSearchPlaces).toHaveBeenCalledOnce();
    expect(result.info.used).toBe(false);
    expect(result.info.reason).toBe("places_not_found");
  });

  it("ヒット 1 件 → name 上書き + 信頼度 88 + matched_place_id 設定", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const applied = makeApplied({
      name: "ど",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(TABELOG_PARSED, applied);
    expect(result.info.used).toBe(true);
    expect(result.info.matched_place_id).toBe("ChIJtest");
    expect(result.updated.name).toBe("導楽");
    expect(result.updated.confidence.name).toBe(88);
  });

  it("複数候補 → 完全一致を優先選択", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([
      makePlace({ placeId: "A", name: "導楽 新丸子店", userRatingsTotal: 100 }),
      makePlace({ placeId: "B", name: "導楽", userRatingsTotal: 10 }),
    ]);
    const applied = makeApplied({
      name: "導楽",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(null, applied);
    expect(result.info.matched_place_id).toBe("B");
  });

  it("完全一致なし → userRatingsTotal 最多を選択", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([
      makePlace({ placeId: "A", name: "導楽 新丸子店", userRatingsTotal: 5 }),
      makePlace({ placeId: "B", name: "導楽 二号店", userRatingsTotal: 50 }),
    ]);
    const applied = makeApplied({
      name: "導楽",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(null, applied);
    expect(result.info.matched_place_id).toBe("B");
  });

  it("既存 phone (信頼度 90) は Places の値で上書きされない (統合)", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const applied = makeApplied({
      name: "ど",
      phone: "044-KEEP-ME",
      confidence: { name: 50, phone: 90 },
    });
    const result = await enrichWithPlacesFallback(null, applied);
    expect(result.updated.phone).toBe("044-KEEP-ME");
    expect(result.updated.confidence.phone).toBe(90);
  });
});
