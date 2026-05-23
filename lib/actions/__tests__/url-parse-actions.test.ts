import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceResult } from "@/lib/places/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/url-parser/ogp", () => ({
  fetchOgp: vi.fn(),
}));
vi.mock("@/lib/places/google", () => ({
  searchPlaces: vi.fn(),
}));

const { fetchOgp } = await import("@/lib/url-parser/ogp");
const { searchPlaces } = await import("@/lib/places/google");
const { importFromUrlAction } = await import("../url-parse-actions");

const mockedFetchOgp = vi.mocked(fetchOgp);
const mockedSearchPlaces = vi.mocked(searchPlaces);

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

beforeEach(() => {
  mockedFetchOgp.mockReset();
  mockedSearchPlaces.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("importFromUrlAction + Places フォールバック統合", () => {
  it("食べログ正常パース (高信頼度フルセット) → Places 呼ばれない", async () => {
    mockedFetchOgp.mockResolvedValueOnce({
      ok: true,
      name: "導楽",
      address: "〒2110004 神奈川県 川崎市中原区 新丸子東1-983",
      phone: "044-750-9977",
      rating: 3.4,
      review_count: 12,
    });
    const result = await importFromUrlAction(
      "https://tabelog.com/kanagawa/A1405/A140504/14096697/",
      { fetchOgp: true, recursive: false },
    );
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
    expect(result.placesFallback?.used).toBe(false);
    expect(result.placesFallback?.reason).toBe("none");
    expect(result.suggested.name).toBe("導楽");
  });

  it("Google Maps URL で name 低信頼度 → Places フォールバックが発火し補完", async () => {
    // ?q= 由来は GMAPS_QUERY (50) の低信頼度 → low_name で発火
    mockedFetchOgp.mockResolvedValueOnce({
      ok: true,
      name: "Google マップ", // ブラックリストで弾かれる
    });
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const result = await importFromUrlAction(
      "https://www.google.com/maps?q=導楽",
    );
    expect(mockedSearchPlaces).toHaveBeenCalledOnce();
    expect(result.placesFallback?.used).toBe(true);
    expect(result.placesFallback?.matched_place_id).toBe("ChIJtest");
    expect(result.suggested.name).toBe("導楽");
    expect(result.suggested.confidence.name).toBe(88);
  });

  it("unknown URL (parsed=null 相当の低信頼度) で keyword 空 → searchPlaces 呼ばれない", async () => {
    // unknown 形式の URL → parseStoreUrl は最小限の ParsedUrl を返すが name は空。
    // fetchOgp も name を取れない → keyword 空 → no_keyword で早期 return
    mockedFetchOgp.mockResolvedValueOnce({ ok: true });
    const result = await importFromUrlAction("https://example.com/foo");
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
    expect(result.placesFallback?.reason).toBe("no_keyword");
  });
});
