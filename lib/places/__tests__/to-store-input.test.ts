import { describe, expect, it } from "vitest";
import {
  normalizeFormattedAddress,
  placeResultToStoreInput,
} from "../to-store-input";
import type { PlaceResult } from "../types";

function makePlace(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    placeId: "ChIJ_test_place_id",
    name: "テスト食堂",
    formattedAddress: "東京都渋谷区道玄坂1-2-3 日本",
    lat: 35.6595,
    lng: 139.6993,
    phone: "03-1234-5678",
    rating: 4.2,
    userRatingsTotal: 150,
    types: ["restaurant", "food", "establishment"],
    googleMapsUri: "https://maps.google.com/?cid=1234567890",
    ...overrides,
  };
}

describe("normalizeFormattedAddress", () => {
  it("先頭の `日本、〒xxx-xxxx ` プレフィックスを除去する", () => {
    expect(
      normalizeFormattedAddress(
        "日本、〒150-0043 東京都渋谷区道玄坂２丁目３−１",
      ),
    ).toBe("東京都渋谷区道玄坂２丁目３−１");
  });

  it("ハイフンなし郵便番号 `〒1500043 ` も除去する", () => {
    expect(
      normalizeFormattedAddress("日本、〒1500043 東京都新宿区西新宿1-1-1"),
    ).toBe("東京都新宿区西新宿1-1-1");
  });

  it("末尾の ` 日本` (古い形式) を除去する", () => {
    expect(
      normalizeFormattedAddress("東京都渋谷区道玄坂1-2-3 日本"),
    ).toBe("東京都渋谷区道玄坂1-2-3");
  });

  it("末尾の `、日本` も除去する", () => {
    expect(
      normalizeFormattedAddress("東京都渋谷区道玄坂1-2-3、日本"),
    ).toBe("東京都渋谷区道玄坂1-2-3");
  });

  it("ノイズなし住所はそのまま返す", () => {
    expect(normalizeFormattedAddress("東京都新宿区西新宿1-1-1")).toBe(
      "東京都新宿区西新宿1-1-1",
    );
  });
});

describe("placeResultToStoreInput", () => {
  describe("住所分解", () => {
    it("東京都アドレスから prefecture が抽出される", () => {
      const input = placeResultToStoreInput(makePlace());
      expect(input.prefecture).toBe("東京都");
    });

    it("東京都アドレスから city が抽出される", () => {
      const input = placeResultToStoreInput(makePlace());
      expect(input.city).toBe("渋谷区");
    });

    it("address は prefecture / city を除いた残差のみ", () => {
      const input = placeResultToStoreInput(makePlace());
      // makePlace のデフォルト formattedAddress: "東京都渋谷区道玄坂1-2-3 日本"
      expect(input.address).toBe("道玄坂1-2-3");
    });

    it("神奈川県アドレスから prefecture / city が抽出される", () => {
      const input = placeResultToStoreInput(
        makePlace({ formattedAddress: "神奈川県川崎市中原区新丸子東3-1-1 日本" }),
      );
      expect(input.prefecture).toBe("神奈川県");
      expect(input.city).toBe("川崎市");
      expect(input.address).toBe("中原区新丸子東3-1-1");
    });

    it("北海道アドレスから prefecture が抽出される", () => {
      const input = placeResultToStoreInput(
        makePlace({ formattedAddress: "北海道札幌市中央区大通西1 日本" }),
      );
      expect(input.prefecture).toBe("北海道");
      expect(input.city).toBe("札幌市");
      expect(input.address).toBe("中央区大通西1");
    });

    it("大阪府アドレスから prefecture / city が抽出される", () => {
      const input = placeResultToStoreInput(
        makePlace({ formattedAddress: "大阪府大阪市北区梅田1-1-3 日本" }),
      );
      expect(input.prefecture).toBe("大阪府");
      expect(input.city).toBe("大阪市");
      expect(input.address).toBe("北区梅田1-1-3");
    });

    it("マッチしないアドレスは prefecture / city が空文字", () => {
      const input = placeResultToStoreInput(
        makePlace({ formattedAddress: "123 Main St, Anytown" }),
      );
      expect(input.prefecture).toBe("");
      expect(input.city).toBe("");
    });

    // ---- regression guard: 現行 Google Places の `日本、〒xxx-xxxx ` プレフィックス形式 ----

    it("現行 Places API 形式: `日本、〒150-0043 東京都渋谷区...` を正しく分解する", () => {
      const input = placeResultToStoreInput(
        makePlace({
          formattedAddress:
            "日本、〒150-0043 東京都渋谷区道玄坂２丁目３−１ 渋谷駅前ビル 2-3階",
        }),
      );
      expect(input.prefecture).toBe("東京都");
      expect(input.city).toBe("渋谷区");
      expect(input.address).toBe("道玄坂２丁目３−１ 渋谷駅前ビル 2-3階");
    });

    it("現行形式: 大阪府も同様に分解できる", () => {
      const input = placeResultToStoreInput(
        makePlace({
          formattedAddress: "日本、〒530-0001 大阪府大阪市北区梅田1-1-3",
        }),
      );
      expect(input.prefecture).toBe("大阪府");
      expect(input.city).toBe("大阪市");
      expect(input.address).toBe("北区梅田1-1-3");
    });

    it("prefecture / city / address を再結合してもプレフィックス重複が起きない", () => {
      const input = placeResultToStoreInput(
        makePlace({
          formattedAddress:
            "日本、〒150-0043 東京都渋谷区道玄坂２丁目３−１ 渋谷駅前ビル 2-3階",
        }),
      );
      const reconstructed = `${input.prefecture}${input.city}${input.address}`;
      expect(reconstructed).not.toMatch(/東京都.*東京都/);
      expect(reconstructed).not.toMatch(/渋谷区.*渋谷区/);
      expect(reconstructed).not.toMatch(/日本/);
      expect(reconstructed).not.toMatch(/〒/);
    });
  });

  describe("genre マッピング", () => {
    it("ramen_restaurant が ラーメン になる", () => {
      const input = placeResultToStoreInput(
        makePlace({ types: ["ramen_restaurant", "restaurant", "food"] }),
      );
      expect(input.genre).toBe("ラーメン");
    });

    it("cafe が カフェ になる", () => {
      const input = placeResultToStoreInput(
        makePlace({ types: ["cafe", "food"] }),
      );
      expect(input.genre).toBe("カフェ");
    });

    it("types の優先順位: ramen_restaurant は restaurant より先にマッチする", () => {
      const input = placeResultToStoreInput(
        makePlace({ types: ["restaurant", "ramen_restaurant", "food"] }),
      );
      // GENRE_MAP の順序で ramen_restaurant が restaurant より先に定義されている
      expect(input.genre).toBe("ラーメン");
    });

    it("restaurant のみの場合は その他 になる", () => {
      const input = placeResultToStoreInput(
        makePlace({ types: ["restaurant", "establishment"] }),
      );
      expect(input.genre).toBe("その他");
    });

    it("food のみの場合は その他 になる", () => {
      const input = placeResultToStoreInput(
        makePlace({ types: ["food", "point_of_interest"] }),
      );
      expect(input.genre).toBe("その他");
    });

    it("一致しない types の場合は 空文字 になる", () => {
      const input = placeResultToStoreInput(
        makePlace({ types: ["point_of_interest", "establishment"] }),
      );
      expect(input.genre).toBe("");
    });
  });

  describe("map_url", () => {
    it("googleMapsUri がある場合はそれを map_url に使う", () => {
      const uri = "https://maps.google.com/?cid=9999";
      const input = placeResultToStoreInput(makePlace({ googleMapsUri: uri }));
      expect(input.map_url).toBe(uri);
    });

    it("googleMapsUri が null の場合は placeId から fallback URL を生成する", () => {
      const input = placeResultToStoreInput(
        makePlace({ googleMapsUri: null, placeId: "ChIJ_abc123" }),
      );
      expect(input.map_url).toBe(
        "https://www.google.com/maps/search/?api=1&query_place_id=ChIJ_abc123",
      );
    });
  });

  describe("評価・口コミ", () => {
    it("rating が null のとき review_avg が 0 になる", () => {
      const input = placeResultToStoreInput(makePlace({ rating: null }));
      expect(input.review_avg).toBe(0);
    });

    it("userRatingsTotal が null のとき review_count が 0 になる", () => {
      const input = placeResultToStoreInput(makePlace({ userRatingsTotal: null }));
      expect(input.review_count).toBe(0);
    });

    it("rating / userRatingsTotal が値を持つ場合はそのまま反映される", () => {
      const input = placeResultToStoreInput(
        makePlace({ rating: 4.2, userRatingsTotal: 150 }),
      );
      expect(input.review_avg).toBe(4.2);
      expect(input.review_count).toBe(150);
    });
  });

  describe("固定値", () => {
    it("stage が 未調査 になる", () => {
      expect(placeResultToStoreInput(makePlace()).stage).toBe("未調査");
    });

    it("google_place_id が placeId になる", () => {
      const input = placeResultToStoreInput(makePlace({ placeId: "ChIJ_xyz" }));
      expect(input.google_place_id).toBe("ChIJ_xyz");
    });

    it("lat / lng がそのまま引き継がれる", () => {
      const input = placeResultToStoreInput(makePlace({ lat: 35.1, lng: 139.2 }));
      expect(input.lat).toBe(35.1);
      expect(input.lng).toBe(139.2);
    });

    it("phone がそのまま引き継がれる", () => {
      const input = placeResultToStoreInput(makePlace({ phone: "03-9999-8888" }));
      expect(input.phone).toBe("03-9999-8888");
    });
  });
});
