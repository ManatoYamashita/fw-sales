import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceResult } from "@/lib/places/types";

import {
  diagnosePickFailure,
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

/**
 * wrong-store prevention (Issue #207)。
 *
 * 変更前は「名前の完全一致が無ければ `userRatingsTotal` 最多の候補」を採用しており、
 * 口コミ件数を identity evidence として使っていた。弱い検索語から複数候補が返ると
 * 「その地域で最も有名な別の店」を自動登録する経路になるため廃止した。
 * autofill 率より wrong-store prevention を優先する。
 */
describe("pickBestPlace — 一意な完全一致のみ採用する", () => {
  it("正規化後の完全一致が 1 件だけならその候補を返す", () => {
    const places = [
      makePlace({ placeId: "A", name: "導楽 別店舗", userRatingsTotal: 100 }),
      makePlace({ placeId: "B", name: "導楽", userRatingsTotal: 10 }),
    ];
    expect(pickBestPlace(places, "導楽")?.placeId).toBe("B");
  });

  it("口コミ件数が桁違いに多くても、名前が一致しない候補は採用しない", () => {
    const places = [
      makePlace({ placeId: "FAMOUS", name: "全然ちがう有名店", userRatingsTotal: 10000 }),
      makePlace({ placeId: "TARGET", name: "導楽", userRatingsTotal: 10 }),
    ];
    expect(pickBestPlace(places, "導楽")?.placeId).toBe("TARGET");
  });

  it("完全一致が 0 件なら null(口コミ最多へフォールバックしない)", () => {
    const places = [
      makePlace({ placeId: "A", name: "導楽 新丸子店", userRatingsTotal: 5 }),
      makePlace({ placeId: "B", name: "導楽 二号店", userRatingsTotal: 50 }),
    ];
    expect(pickBestPlace(places, "導楽")).toBeNull();
  });

  it("完全一致が 2 件以上なら ambiguous として null", () => {
    const places = [
      makePlace({ placeId: "A", name: "導楽", userRatingsTotal: 5 }),
      makePlace({ placeId: "B", name: "導楽", userRatingsTotal: 500 }),
    ];
    expect(pickBestPlace(places, "導楽")).toBeNull();
  });

  it("targetName が空なら null(照合基準が無い)", () => {
    expect(pickBestPlace([makePlace()], "")).toBeNull();
    expect(pickBestPlace([makePlace()], "   ")).toBeNull();
  });

  it("空配列なら null", () => {
    expect(pickBestPlace([], "導楽")).toBeNull();
  });

  describe("name normalization は表記ゆれのみ吸収する", () => {
    it("前後空白・連続空白・全角英数・英字 case を吸収する", () => {
      expect(
        pickBestPlace([makePlace({ name: "ＳＯＬＥ  Trattoria" })], " sole trattoria ")?.placeId,
      ).toBe("ChIJtest");
    });

    it("支店表記は落とさない(別店舗の誤採用を防ぐ)", () => {
      const places = [makePlace({ placeId: "HONTEN", name: "なむら 本店" })];
      expect(pickBestPlace(places, "なむら 新宿店")).toBeNull();
      expect(pickBestPlace(places, "なむら")).toBeNull();
    });

    it("部分一致では採用しない(fuzzy match を使わない)", () => {
      expect(pickBestPlace([makePlace({ name: "居酒屋 導楽 新丸子" })], "導楽")).toBeNull();
    });
  });
});

describe("diagnosePickFailure", () => {
  it("完全一致 0 件は places_not_found", () => {
    expect(diagnosePickFailure([makePlace({ name: "別店舗" })], "導楽")).toBe(
      "places_not_found",
    );
    expect(diagnosePickFailure([], "導楽")).toBe("places_not_found");
  });

  it("完全一致 2 件以上は ambiguous", () => {
    const places = [
      makePlace({ placeId: "A", name: "導楽" }),
      makePlace({ placeId: "B", name: "導楽" }),
    ];
    expect(diagnosePickFailure(places, "導楽")).toBe("ambiguous");
  });

  it("targetName が空なら places_not_found", () => {
    expect(diagnosePickFailure([makePlace()], "")).toBe("places_not_found");
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

  it("ヒット 1 件かつ名前が一致 → name 上書き + 信頼度 88 + matched_place_id 設定", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const applied = makeApplied({
      name: "導楽",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(TABELOG_PARSED, applied);
    expect(result.info.used).toBe(true);
    expect(result.info.matched_place_id).toBe("ChIJtest");
    expect(result.updated.name).toBe("導楽");
    expect(result.updated.confidence.name).toBe(88);
  });

  it("ヒット 1 件でも名前が一致しなければ採用しない (Issue #207)", async () => {
    // 変更前は「候補が 1 件しかないから」という理由だけで採用していた。
    // 部分的な検索語 (「ど」) に対して別店舗を確定させうるため廃止した。
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const applied = makeApplied({
      name: "ど",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(TABELOG_PARSED, applied);
    expect(result.info.used).toBe(false);
    expect(result.info.reason).toBe("places_not_found");
    expect(result.updated.name).toBe("ど");
  });

  it("複数候補 → 完全一致が一意な候補のみ選択", async () => {
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

  it("完全一致なし → 口コミ最多へフォールバックせず places_not_found (Issue #207)", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([
      makePlace({ placeId: "A", name: "導楽 新丸子店", userRatingsTotal: 5 }),
      makePlace({ placeId: "B", name: "導楽 二号店", userRatingsTotal: 50 }),
    ]);
    const applied = makeApplied({
      name: "導楽",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(null, applied);
    expect(result.info.used).toBe(false);
    expect(result.info.reason).toBe("places_not_found");
    expect(result.info.matched_place_id).toBeUndefined();
  });

  it("同名候補が複数 → ambiguous として採用しない (Issue #207)", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([
      makePlace({ placeId: "A", name: "導楽", userRatingsTotal: 5 }),
      makePlace({ placeId: "B", name: "導楽", userRatingsTotal: 5000 }),
    ]);
    const applied = makeApplied({
      name: "導楽",
      confidence: { name: 50 },
    });
    const result = await enrichWithPlacesFallback(null, applied);
    expect(result.info.used).toBe(false);
    expect(result.info.reason).toBe("ambiguous");
    expect(result.info.matched_place_id).toBeUndefined();
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
