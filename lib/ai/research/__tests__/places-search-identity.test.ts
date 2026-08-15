/**
 * Stage0 Google Places 専用 identity 構築の単体検証
 * (PR #180 pre-merge fix: Stage0 Places Identity Recovery)。
 *
 * 純関数のみを検証する(Places API・DB・Gemini のいずれにも依存しない)。
 */

import { describe, it, expect } from "vitest";

// `places-search-identity.ts` は純関数モジュール(`server-only` を import しない。
// 依存は `normalizeFormattedAddress` のみで、これも純関数)のため、
// `url-normalize.test.ts` と同じく静的 import で足りる。
import { buildBestStoreAddress, buildPlacesSearchIdentity } from "../places-search-identity";

/**
 * `buildBestStoreAddress` は**住所を推測しない**。
 * 既存文字列の安全な結合と重複回避だけを行う。
 */
describe("buildBestStoreAddress", () => {
  it("residual address(エリア検索経路)は prefecture + city + address で結合する", () => {
    // lib/places/to-store-input.ts:69-78 は formattedAddress を
    // prefecture / city / 残差 の3つに分解して保存するため、address は番地以降のみ。
    expect(
      buildBestStoreAddress({
        prefecture: "千葉県",
        city: "柏市",
        address: "旭町1-1-12",
      }),
    ).toBe("千葉県柏市旭町1-1-12");
  });

  it("address が既に full address(URLインポート経路)ならそのまま返す", () => {
    // lib/url-parser/places-fallback.ts:80 は formattedAddress を丸ごと address へ入れる。
    // 素朴に連結すると「千葉県柏市千葉県柏市旭町1-1-12」になる。
    expect(
      buildBestStoreAddress({
        prefecture: "千葉県",
        city: "柏市",
        address: "千葉県柏市旭町1-1-12",
      }),
    ).toBe("千葉県柏市旭町1-1-12");
  });

  it("address が city から始まる場合は city を二重付与しない", () => {
    expect(
      buildBestStoreAddress({
        prefecture: "千葉県",
        city: "柏市",
        address: "柏市旭町1-1-12",
      }),
    ).toBe("千葉県柏市旭町1-1-12");
  });

  it("city が既に prefecture を含む場合は prefecture を二重付与しない(address 空)", () => {
    // 告膳の実機ケース。「埼玉県埼玉県所沢市...」を絶対に作らない。
    expect(
      buildBestStoreAddress({
        prefecture: "埼玉県",
        city: "埼玉県所沢市日吉町19-12",
        address: "",
      }),
    ).toBe("埼玉県所沢市日吉町19-12");
  });

  it("city が既に prefecture を含み、address が残差の場合も二重付与しない", () => {
    expect(
      buildBestStoreAddress({
        prefecture: "埼玉県",
        city: "埼玉県所沢市",
        address: "日吉町19-12",
      }),
    ).toBe("埼玉県所沢市日吉町19-12");
  });

  it("address が空なら prefecture + city を返す", () => {
    expect(
      buildBestStoreAddress({ prefecture: "埼玉県", city: "所沢市", address: "" }),
    ).toBe("埼玉県所沢市");
  });

  it("市区町村までしか無い場合も合成はする(具体性の判定は isAddressMatch 側の責務)", () => {
    // ここで空文字へ倒すと、Places の textQuery から市区町村が消えて候補の質が下がる。
    // 番地が無いことによる strong match 不成立は `hasBanchiLevelSpecificity` が担保する。
    const composed = buildBestStoreAddress({
      prefecture: "埼玉県",
      city: "所沢市",
      address: "",
    });
    expect(composed).toBe("埼玉県所沢市");
    expect(/\d+-\d+/.test(composed)).toBe(false);
  });

  it("すべて空なら空文字を返す", () => {
    expect(buildBestStoreAddress({ prefecture: "", city: "", address: "" })).toBe("");
  });

  it("前後の空白は trim する", () => {
    expect(
      buildBestStoreAddress({
        prefecture: " 千葉県 ",
        city: " 柏市 ",
        address: " 旭町1-1-12 ",
      }),
    ).toBe("千葉県柏市旭町1-1-12");
  });

  it("空白のみのフィールドは空として扱う", () => {
    expect(
      buildBestStoreAddress({ prefecture: "千葉県", city: "   ", address: "   " }),
    ).toBe("千葉県");
  });

  it("prefecture が空でも city / address は失われない", () => {
    expect(
      buildBestStoreAddress({ prefecture: "", city: "柏市", address: "旭町1-1-12" }),
    ).toBe("柏市旭町1-1-12");
  });

  it("prefecture / city が空で address だけある場合は address をそのまま返す", () => {
    expect(
      buildBestStoreAddress({ prefecture: "", city: "", address: "千葉県柏市旭町1-1-12" }),
    ).toBe("千葉県柏市旭町1-1-12");
  });

  it("住所を推測・補完しない(郵便番号や番地を勝手に足さない)", () => {
    const composed = buildBestStoreAddress({
      prefecture: "埼玉県",
      city: "所沢市",
      address: "",
    });
    expect(composed).not.toMatch(/〒/);
    expect(composed).toBe("埼玉県所沢市");
  });

  /**
   * PR #180 post-merge smoke、Finding C。
   *
   * 本番実データの **8割強** の `address` が `〒NNNNNNN 都道府県 市区町村 …` の形
   * (郵便番号 + スペース区切りのフル住所)で、さらに **3割強** の `city` に
   * 行政区名ではなく営業テリトリー名が入っていた。当初の
   * `address.startsWith(prefecture)` 判定は `〒` 始まりの住所で常に false になるため、
   * これら全件で areaPrefix が無条件に前置されていた。
   *
   * 以下の fixture は実データの**形**だけを再現した架空の店舗情報で、
   * このファイルの他のテストと同じ「千葉県柏市旭町」を題材に揃えている。
   */
  describe("〒 始まりのフル住所(手動登録・一括インポート経路)", () => {
    it("prefecture を二重付与しない", () => {
      expect(
        buildBestStoreAddress({
          prefecture: "千葉県",
          city: "",
          address: "〒2770852 千葉県 柏市 旭町1-1-12 サンプルビル 2F",
        }),
      ).toBe("〒2770852 千葉県 柏市 旭町1-1-12 サンプルビル 2F");
    });

    it("city が行政区名でない(営業テリトリー名)場合も前置しない", () => {
      // `city` は担当エリアの「柏市・我孫子市」だが、実際の所在地は市川市。
      // 前置すると Places の textQuery に無関係な市区名が2つ混入する。
      const composed = buildBestStoreAddress({
        prefecture: "千葉県",
        city: "柏市・我孫子市",
        address: "〒2720021 千葉県 市川市八幡1-2-3",
      });
      expect(composed).toBe("〒2720021 千葉県 市川市八幡1-2-3");
      expect(composed).not.toMatch(/柏市/);
    });

    it("city が prefecture を含むテリトリー名でも前置しない", () => {
      const composed = buildBestStoreAddress({
        prefecture: "千葉県",
        city: "千葉県柏市・我孫子市",
        address: "〒2720021 千葉県 市川市八幡1-2-3",
      });
      expect(composed).toBe("〒2720021 千葉県 市川市八幡1-2-3");
      expect(composed).not.toMatch(/我孫子市/);
    });

    it("郵便番号を除いた先頭が市区町村の場合は prefecture だけを前置する", () => {
      expect(
        buildBestStoreAddress({
          prefecture: "千葉県",
          city: "柏市",
          address: "〒2770852 柏市旭町1-1-12",
        }),
      ).toBe("千葉県〒2770852 柏市旭町1-1-12");
    });

    it("〒 始まりでも都道府県・市区町村を含まない残差なら従来どおり結合する", () => {
      // 郵便番号だけが付いた残差住所。`probe` は「旭町1-1-12」になり、
      // prefecture も city も含まないため rule 6 へ落ちる。
      expect(
        buildBestStoreAddress({
          prefecture: "千葉県",
          city: "柏市",
          address: "〒2770852 旭町1-1-12",
        }),
      ).toBe("千葉県柏市〒2770852 旭町1-1-12");
    });
  });
});

describe("buildPlacesSearchIdentity", () => {
  const STORE = {
    name: "告膳",
    prefecture: "埼玉県",
    city: "所沢市",
    address: "日吉町19-12",
    phone: "04-2998-6543",
  };

  it("name / phone はスカラー列をそのまま使い、address だけ合成する", () => {
    expect(buildPlacesSearchIdentity(STORE)).toEqual({
      name: "告膳",
      address: "埼玉県所沢市日吉町19-12",
      phone: "04-2998-6543",
    });
  });

  it("store.address が空でも prefecture / city から住所を組み立てる(告膳の再現)", () => {
    const identity = buildPlacesSearchIdentity({
      ...STORE,
      address: "",
      phone: "",
      city: "所沢市日吉町19-12",
    });
    expect(identity.address).toBe("埼玉県所沢市日吉町19-12");
    expect(identity.phone).toBe("");
  });

  it("戻り値は name / address / phone の3キーのみ(genre を持たない)", () => {
    // `StoreIdentity` は `genre` を必須とするため、`PlacesSearchIdentity` は
    // 構造的に `StoreIdentity` へ代入できない。これが Stage1/Stage2 へ
    // 誤って渡らないことのコンパイル時保証になる(F1 を悪化させない担保)。
    expect(Object.keys(buildPlacesSearchIdentity(STORE)).sort()).toEqual([
      "address",
      "name",
      "phone",
    ]);
  });

  it("basic_info を一切参照しない(引数がスカラー5列のみ)", () => {
    // 過去の AI 調査結果を人間が採用した値(filled_by:"manual")が identity source に
    // なると、AI-derived identity → Places strong match → deterministic confirmed
    // という弱い循環が生じるため、今回は basic_info を使わない。
    const identity = buildPlacesSearchIdentity(STORE);
    expect(identity.name).toBe(STORE.name);
    expect(identity.phone).toBe(STORE.phone);
  });

  it("すべて空の店舗でも例外を投げず空文字を返す", () => {
    expect(
      buildPlacesSearchIdentity({
        name: "",
        prefecture: "",
        city: "",
        address: "",
        phone: "",
      }),
    ).toEqual({ name: "", address: "", phone: "" });
  });
});
