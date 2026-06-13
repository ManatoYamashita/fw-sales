/**
 * scalarToBasicInfo 純関数の単体検証 (task 3.4)
 *
 * 既存スカラー → basic_info partial の射影ルールが design / requirements 通りであること、
 * および空値防御・filled_by="manual" スタンプを直接検証する。
 */

import { describe, it, expect } from "vitest";
import { scalarToBasicInfo } from "../_basic-info-mapping";

const NOW = "2026-06-08T10:00:00.000Z";

function makeScalars(overrides: Partial<Parameters<typeof scalarToBasicInfo>[0]> = {}) {
  return {
    name: "蕎楽亭",
    prefecture: "東京都",
    city: "渋谷区",
    address: "代々木1-2-3",
    genre: "和食",
    site_url: "https://example.com",
    instagram_url: "https://instagram.com/sorakutei",
    phone: "03-1234-5678",
    review_avg: 4.0,
    review_count: 50,
    ...overrides,
  };
}

describe("scalarToBasicInfo - 射影マッピング", () => {
  it("name → store_name (tier A, filled_by=manual)", () => {
    const partial = scalarToBasicInfo(makeScalars(), NOW);
    expect(partial.store_name).toBeDefined();
    expect(partial.store_name?.value).toBe("蕎楽亭");
    expect(partial.store_name?.tier).toBe("A");
    expect(partial.store_name?.filled_by).toBe("manual");
    expect(partial.store_name?.updated_at).toBe(NOW);
  });

  it("prefecture + city + address を結合し address に格納", () => {
    const partial = scalarToBasicInfo(makeScalars(), NOW);
    expect(partial.address?.value).toBe("東京都渋谷区代々木1-2-3");
  });

  it("genre → cuisine_genre", () => {
    const partial = scalarToBasicInfo(makeScalars(), NOW);
    expect(partial.cuisine_genre?.value).toBe("和食");
  });

  it("site_url → official_site", () => {
    const partial = scalarToBasicInfo(makeScalars(), NOW);
    expect(partial.official_site?.value).toBe("https://example.com");
  });

  it("instagram_url → sns_accounts", () => {
    const partial = scalarToBasicInfo(makeScalars(), NOW);
    expect(partial.sns_accounts?.value).toBe(
      "https://instagram.com/sorakutei",
    );
  });

  it("射影される 8 項目を返す (phone/review を一級市民化 #134。lat/lng は含まない)", () => {
    const partial = scalarToBasicInfo(makeScalars(), NOW);
    const keys = Object.keys(partial).sort();
    expect(keys).toEqual(
      [
        "store_name",
        "address",
        "cuisine_genre",
        "official_site",
        "sns_accounts",
        "phone",
        "review_avg",
        "review_count",
      ].sort(),
    );
  });

  it("phone → phone、review_avg → 小数第1位文字列、review_count → 整数文字列 (#134)", () => {
    const partial = scalarToBasicInfo(
      makeScalars({ phone: "03-1234-5678", review_avg: 4, review_count: 120 }),
      NOW,
    );
    expect(partial.phone?.value).toBe("03-1234-5678");
    expect(partial.review_avg?.value).toBe("4.0");
    expect(partial.review_count?.value).toBe("120");
  });

  it("review_avg / review_count が 0 (未評価) なら射影しない (#134)", () => {
    const partial = scalarToBasicInfo(
      makeScalars({ review_avg: 0, review_count: 0 }),
      NOW,
    );
    expect(partial.review_avg).toBeUndefined();
    expect(partial.review_count).toBeUndefined();
  });
});

describe("scalarToBasicInfo - 空値防御", () => {
  it("name が空文字なら store_name を返さない", () => {
    const partial = scalarToBasicInfo(makeScalars({ name: "" }), NOW);
    expect(partial.store_name).toBeUndefined();
  });

  it("name が空白のみなら store_name を返さない", () => {
    const partial = scalarToBasicInfo(makeScalars({ name: "   " }), NOW);
    expect(partial.store_name).toBeUndefined();
  });

  it("住所スカラーが全て空なら address を返さない", () => {
    const partial = scalarToBasicInfo(
      makeScalars({ prefecture: "", city: "", address: "" }),
      NOW,
    );
    expect(partial.address).toBeUndefined();
  });

  it("住所スカラーの一部だけ埋まっていれば address に結合される", () => {
    const partial = scalarToBasicInfo(
      makeScalars({ prefecture: "東京都", city: "", address: "" }),
      NOW,
    );
    expect(partial.address?.value).toBe("東京都");
  });

  it("全スカラーが空なら空オブジェクトを返す", () => {
    const partial = scalarToBasicInfo(
      {
        name: "",
        prefecture: "",
        city: "",
        address: "",
        genre: "",
        site_url: "",
        instagram_url: "",
        phone: "",
        review_avg: 0,
        review_count: 0,
      },
      NOW,
    );
    expect(partial).toEqual({});
  });
});

describe("scalarToBasicInfo - filled_by は常に manual", () => {
  it("全ての返却 field に filled_by='manual' がスタンプされる", () => {
    const partial = scalarToBasicInfo(makeScalars(), NOW);
    for (const field of Object.values(partial)) {
      expect(field?.filled_by).toBe("manual");
    }
  });
});

describe("scalarToBasicInfo - 純関数性", () => {
  it("入力を変更しない", () => {
    const input = makeScalars();
    const snapshot = JSON.parse(JSON.stringify(input));
    scalarToBasicInfo(input, NOW);
    expect(input).toEqual(snapshot);
  });
});
