/**
 * Google 口コミ評価・件数が Stage0 strong match から confirmed へ到達することの
 * integration 検証(PR #180 pre-merge fix: Stage0 Places Identity Recovery)。
 *
 * これまで `runStage0PlacesResync` / `buildDeterministicItems` /
 * `finalizeResearchItems` はそれぞれ単体テストを持っていたが、
 *
 * ```
 * PlaceResult.rating / userRatingsTotal
 *   → placeResultToBasicInfo(review_avg / review_count, filled_by:"places")
 *   → deriveFreshPlacesVerifiedKeys
 *   → buildDeterministicPlacesItems
 *   → deriveDeterministicPlacesConfirmedKeys(BLOCKER2 の絞り込み)
 *   → validateResearchItemStatus の path1
 *   → confirmed
 * ```
 *
 * という**経路全体**を1本で固定するテストが無く、途中のどこかが壊れても
 * 「星が取れない」実機事象としてしか現れなかった。
 *
 * `@/lib/places/google` のみをモックし、それ以外(住所合成 / Stage0 / basic_info 変換 /
 * deterministic item 合成 / trust boundary)は**すべて実コード**を通す。
 * Gemini は1度も呼ばない(`aiItems` に Stage2 出力を混ぜない)。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BasicInfo } from "@/types/basic-info";

vi.mock("server-only", () => ({}));

const { mockGetPlaceById, mockSearchPlaces } = vi.hoisted(() => ({
  mockGetPlaceById: vi.fn(),
  mockSearchPlaces: vi.fn(),
}));

vi.mock("@/lib/places/google", () => ({
  getPlaceById: mockGetPlaceById,
  searchPlaces: mockSearchPlaces,
}));

// Gemini クライアントは経路上使わないが、`pipeline.ts` の静的 import を満たすためモックする。
vi.mock("../client", () => ({
  createResearchGeminiClient: () => ({
    runSourceDiscovery: vi.fn(),
    runStructuredUrlContext: vi.fn(),
  }),
}));

const { runStage0PlacesResync } = await import("../places-stage0");
const { buildPlacesSearchIdentity } = await import("../places-search-identity");
const { buildDeterministicItems, finalizeResearchItems } = await import("../pipeline");

const NOW = "2026-08-14T00:00:00.000Z";

/** 告膳の実機ケース: スカラー住所・電話が空で、prefecture/city 側に番地がある。 */
const SPARSE_STORE = {
  name: "告膳",
  prefecture: "埼玉県",
  city: "所沢市日吉町19-12",
  address: "",
  phone: "",
};

const PLACE = {
  placeId: "places/kokuzen",
  name: "告膳",
  formattedAddress: "日本、〒359-1123 埼玉県所沢市日吉町１９−１２",
  lat: 35.79,
  lng: 139.46,
  phone: "",
  rating: 4.3,
  userRatingsTotal: 87,
  types: ["japanese_restaurant", "restaurant"],
  googleMapsUri: null,
};

beforeEach(() => {
  mockGetPlaceById.mockReset();
  mockSearchPlaces.mockReset();
});

/** Store → 最終 ResearchItem までを実コードで通す。 */
async function runRatingPath(
  store: typeof SPARSE_STORE,
  canonicalBasicInfo: BasicInfo = {} as BasicInfo,
) {
  const placesSearchIdentity = buildPlacesSearchIdentity(store);
  const stage0 = await runStage0PlacesResync({
    googlePlaceId: null,
    store: placesSearchIdentity,
    now: NOW,
  });
  const deterministic = buildDeterministicItems({
    freshPlacesBasicInfo: stage0.placesBasicInfo,
    canonicalBasicInfo,
  });
  const items = finalizeResearchItems({
    aiItems: deterministic.items,
    nonAiItems: [],
    sourceRegistry: [],
    placesVerifiedKeys: deterministic.placesConfirmedKeys,
    canonicalVerifiedKeys: deterministic.canonicalConfirmedKeys,
  });
  return { placesSearchIdentity, stage0, deterministic, items };
}

describe("Google rating path: Stage0 strong match → review_avg / review_count confirmed", () => {
  it("rating=4.3 / userRatingCount=87 が confirmed な ResearchItem になる", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE]);

    const { items } = await runRatingPath(SPARSE_STORE);

    const reviewAvg = items.find((i) => i.key === "review_avg");
    expect(reviewAvg).toBeDefined();
    expect(reviewAvg!.status).toBe("confirmed");
    expect(reviewAvg!.value).toBe("4.3");
    expect(reviewAvg!.evidence_basis).toBe("places");
    expect(reviewAvg!.confidence).toBe(100);
    expect(reviewAvg!.evidence).toBe("今回の調査時点のGoogle Placesで確認した値です。");

    const reviewCount = items.find((i) => i.key === "review_count");
    expect(reviewCount).toBeDefined();
    expect(reviewCount!.status).toBe("confirmed");
    expect(reviewCount!.value).toBe("87");
    expect(reviewCount!.evidence_basis).toBe("places");
    expect(reviewCount!.confidence).toBe(100);
  });

  it("Places 由来の item は出典URLを持たない(source_ids が空)", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE]);
    const { items } = await runRatingPath(SPARSE_STORE);
    for (const key of ["review_avg", "review_count"]) {
      expect(items.find((i) => i.key === key)!.source_ids).toEqual([]);
    }
  });

  it("この2 key は Stage2 の対象から除外される(excludeKeys)", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE]);
    const { deterministic } = await runRatingPath(SPARSE_STORE);
    expect(deterministic.deterministicKeys).toEqual(
      expect.arrayContaining(["review_avg", "review_count"]),
    );
  });

  it("trust boundary へ渡る placesVerifiedKeys は review_avg / review_count だけ(BLOCKER2 の絞り込み維持)", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE]);
    const { deterministic } = await runRatingPath(SPARSE_STORE);
    // Places 応答には store_name / address / cuisine_genre も含まれるが、
    // これらを trust boundary へ渡すと「値の中身を見ずに key 一致だけで confirmed」に
    // なるため意図的に除外されている。今回この絞り込みは拡張していない。
    expect([...deterministic.placesConfirmedKeys].sort()).toEqual(["review_avg", "review_count"]);
  });

  it("canonical に古い値があっても fresh を採用し、差異を warning で提示する", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE]);
    const canonical = {
      review_avg: {
        value: "4.0",
        tier: "A" as const,
        filled_by: "manual" as const,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    } as unknown as BasicInfo;

    const { items } = await runRatingPath(SPARSE_STORE, canonical);
    const reviewAvg = items.find((i) => i.key === "review_avg")!;
    expect(reviewAvg.value).toBe("4.3");
    expect(reviewAvg.status).toBe("confirmed");
    expect(reviewAvg.warning).toContain("4.0");
    expect(reviewAvg.warning).toContain("4.3");
  });

  it("strong match しなければ deterministic item は作られない(修正前の状態)", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE]);
    // prefecture / city を空にして「Stage0 へ具体的住所が届かない」状況を再現する。
    const { stage0, deterministic } = await runRatingPath({
      ...SPARSE_STORE,
      prefecture: "",
      city: "",
    });
    expect(stage0.diagnostic.outcome).toBe("no_match");
    expect(stage0.diagnostic.identity_inputs).toEqual({
      has_address: false,
      has_phone: false,
    });
    expect(deterministic.items).toEqual([]);
    expect(deterministic.placesConfirmedKeys.size).toBe(0);
  });

  it("rating が未評価(null)なら item を作らない(0.0 を confirmed にしない)", async () => {
    mockSearchPlaces.mockResolvedValue([{ ...PLACE, rating: null, userRatingsTotal: null }]);
    const { stage0, deterministic } = await runRatingPath(SPARSE_STORE);
    expect(stage0.diagnostic.outcome).toBe("matched");
    expect(stage0.diagnostic.review_fields_present).toBe(false);
    expect(deterministic.items).toEqual([]);
  });

  it("Places API が失敗しても例外を投げず、item が作られないだけになる", async () => {
    mockSearchPlaces.mockRejectedValue(new Error("Places API エラー (500): boom"));
    const { stage0, deterministic } = await runRatingPath(SPARSE_STORE);
    expect(stage0.diagnostic.outcome).toBe("api_error");
    expect(deterministic.items).toEqual([]);
  });
});
