/**
 * placeResultToBasicInfo 純関数の単体検証 (store-basic-info / task 2.2)
 *
 * 受け入れ基準 (requirements 3.1 / 3.2) と純関数の不変条件を直接検証する。
 */

import { describe, it, expect } from "vitest";
import { placeResultToBasicInfo } from "../to-basic-info";
import type { PlaceResult } from "../types";

const NOW = "2026-06-08T10:00:00.000Z";

function makePlace(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    placeId: "place_001",
    name: "テスト食堂",
    formattedAddress: "日本、〒150-0043 東京都渋谷区道玄坂1-2-3",
    lat: 35.6762,
    lng: 139.6503,
    phone: "03-1234-5678",
    rating: 4.0,
    userRatingsTotal: 50,
    types: ["restaurant", "food"],
    googleMapsUri: "https://maps.google.com/?cid=123",
    ...overrides,
  };
}

// ---- R3.1 取得可能項目の充填 ---------------------------------------------

describe("placeResultToBasicInfo - R3.1 公開地図情報から取得可能項目を充填", () => {
  it("name / formattedAddress / types から store_name / address / cuisine_genre が返る", () => {
    const place = makePlace({
      name: "蕎楽亭",
      formattedAddress: "日本、〒151-0053 東京都渋谷区代々木1-1-1",
      types: ["japanese_restaurant"],
    });

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.store_name?.value).toBe("蕎楽亭");
    expect(result.address?.value).toBe("東京都渋谷区代々木1-1-1");
    expect(result.cuisine_genre?.value).toBe("和食");
  });

  it("PlaceResult に対応フィールドがない 4 項目 (営業時間/公式サイト/立地/最寄り駅) は返さない", () => {
    const place = makePlace();

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.business_hours_holidays).toBeUndefined();
    expect(result.official_site).toBeUndefined();
    expect(result.location_feature).toBeUndefined();
    expect(result.nearest_station).toBeUndefined();
  });

  it("types から業態取得できない場合 (空配列) は cuisine_genre を返さない", () => {
    const place = makePlace({ types: [] });

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.cuisine_genre).toBeUndefined();
  });

  it("formattedAddress の住所ノイズ (郵便番号/日本) は正規化される", () => {
    const place = makePlace({
      formattedAddress: "〒150-0043 東京都渋谷区道玄坂1-2-3",
    });

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.address?.value).toBe("東京都渋谷区道玄坂1-2-3");
  });

  it("types に restaurant / food のみのときは『その他』を充填する (公開情報の事実)", () => {
    const place = makePlace({ types: ["restaurant"] });

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.cuisine_genre?.value).toBe("その他");
  });
});

// ---- R3.2 取得ソース=エリア検索を記録 ------------------------------------

describe("placeResultToBasicInfo - R3.2 filled_by=places を必ず付与", () => {
  it("返す全 field の filled_by が 'places'", () => {
    const place = makePlace();

    const result = placeResultToBasicInfo(place, NOW);

    for (const field of Object.values(result)) {
      expect(field?.filled_by).toBe("places");
    }
  });

  it("返す全 field の updated_at に引数 now がスタンプされる", () => {
    const place = makePlace();

    const result = placeResultToBasicInfo(place, NOW);

    for (const field of Object.values(result)) {
      expect(field?.updated_at).toBe(NOW);
    }
  });

  it("返す全 field の tier は 'A' (高信頼取得)", () => {
    const place = makePlace();

    const result = placeResultToBasicInfo(place, NOW);

    for (const field of Object.values(result)) {
      expect(field?.tier).toBe("A");
    }
  });
});

// ---- 空値の項目は返さない (mergeBasicInfo が誤って "primary 上書き" しないため) ----

describe("placeResultToBasicInfo - 空値項目は返さない", () => {
  it("name が空文字なら store_name は返さない", () => {
    const place = makePlace({ name: "" });

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.store_name).toBeUndefined();
  });

  it("name が空白のみなら store_name は返さない", () => {
    const place = makePlace({ name: "   " });

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.store_name).toBeUndefined();
  });

  it("formattedAddress が空文字なら address は返さない", () => {
    const place = makePlace({ formattedAddress: "" });

    const result = placeResultToBasicInfo(place, NOW);

    expect(result.address).toBeUndefined();
  });
});

// ---- PlaceResult のスカラー専用フィールドは basic_info に射影しない ------

describe("placeResultToBasicInfo - スカラー専用フィールドは射影しない", () => {
  it("phone / rating / userRatingsTotal / lat / lng / googleMapsUri / placeId は basic_info に含めない", () => {
    const place = makePlace();

    const result = placeResultToBasicInfo(place, NOW);
    const keys = Object.keys(result);

    expect(keys).not.toContain("phone");
    expect(keys).not.toContain("rating");
    expect(keys).not.toContain("userRatingsTotal");
    expect(keys).not.toContain("lat");
    expect(keys).not.toContain("lng");
    expect(keys).not.toContain("googleMapsUri");
    expect(keys).not.toContain("placeId");
  });
});

// ---- 入力非変更 ----------------------------------------------------------

describe("placeResultToBasicInfo - 入力 PlaceResult を変更しない", () => {
  it("PlaceResult オブジェクトと types 配列は変更されない", () => {
    const place = makePlace();
    const snapshot = JSON.parse(JSON.stringify(place)) as PlaceResult;

    placeResultToBasicInfo(place, NOW);

    expect(place).toEqual(snapshot);
  });
});
