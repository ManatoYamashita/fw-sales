/**
 * 店舗名・住所・電話番号match/normalizeロジックの単体検証
 * (fix/ai-research-source-identity-integrity で `places-stage0.ts` から切り出し)。
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isNameMatch, isAddressMatch, normalizePhone, isTargetStoreMatch, deriveSearchIdentityName } =
  await import("../identity-match");

const TARGET_STORE = {
  name: "東北メシ 炉端ジュン",
  address: "千葉県柏市旭町1-1-12",
  phone: "04-7199-7985",
};

describe("isTargetStoreMatch (fix/ai-research-source-identity-integrity、FIX3)", () => {
  it("名前一致 + 住所一致ならtrue", () => {
    expect(
      isTargetStoreMatch(
        { name: "炉端ジュン", address: "千葉県柏市旭町1-1-12", phone: null },
        TARGET_STORE,
      ),
    ).toBe(true);
  });

  it("名前一致 + 電話一致ならtrue(住所が無くても)", () => {
    expect(
      isTargetStoreMatch({ name: "炉端ジュン", address: null, phone: "04-7199-7985" }, TARGET_STORE),
    ).toBe(true);
  });

  it("CASE A(実機smoke事故の再現): 名前だけ一致していても住所・電話が別店舗ならfalse", () => {
    // 実機事故: entry titleは「東北メシ 炉端ジュン」で正しそうに見えたが、実際に
    // observed_nameとして本文から取得した値は全く別店舗だった、というケースを模す。
    expect(
      isTargetStoreMatch(
        { name: "カフェ&民泊 三喜遊", address: "香川県三豊市仁尾町仁尾丙795", phone: null },
        TARGET_STORE,
      ),
    ).toBe(false);
  });

  it("名前一致のみ(住所・電話ともに確認できず)はfalse(false positiveよりfalse negativeを優先)", () => {
    expect(isTargetStoreMatch({ name: "炉端ジュン", address: null, phone: null }, TARGET_STORE)).toBe(
      false,
    );
  });

  it("名前が一致していても住所・電話が両方とも異なるならfalse", () => {
    expect(
      isTargetStoreMatch(
        { name: "炉端ジュン", address: "東京都渋谷区道玄坂1-2-3", phone: "03-1234-5678" },
        TARGET_STORE,
      ),
    ).toBe(false);
  });

  it("observed_nameがnull/空文字ならfalse", () => {
    expect(isTargetStoreMatch({ name: null, address: "千葉県柏市旭町1-1-12", phone: null }, TARGET_STORE)).toBe(
      false,
    );
    expect(isTargetStoreMatch({ name: "", address: "千葉県柏市旭町1-1-12", phone: null }, TARGET_STORE)).toBe(
      false,
    );
  });

  it("店舗名先頭の営業管理タグを除去してから照合する(deriveSearchIdentityNameの再利用)", () => {
    const taggedTarget = { ...TARGET_STORE, name: "（Rアポハマロスト）東北メシ 炉端ジュン" };
    expect(
      isTargetStoreMatch(
        { name: "炉端ジュン", address: "千葉県柏市旭町1-1-12", phone: null },
        taggedTarget,
      ),
    ).toBe(true);
  });

  describe("数字を含まない電話番号表記のfalse positive防止(PR #180 review Finding 2)", () => {
    // `stores.phone` は `text().notNull()` でフォーマット検証が無く、営業リストのCSV取込等で
    // 「不明」「未掲載」「-」のような数字を含まない値が実在しうる。`normalizePhone` は
    // 数字以外を全て除去するため、これらは正規化後いずれも "" になる。正規化**前**の
    // 非空チェックしか無いと `"" === ""` が成立し、名前さえ緩く一致すれば
    // 全く無関係のページが `target_match` として採用されてしまう。
    it("observed/target双方が数字なし文字列でも電話一致とみなさない", () => {
      expect(
        isTargetStoreMatch(
          { name: "炉端ジュン", address: null, phone: "不明" },
          { ...TARGET_STORE, phone: "未掲載" },
        ),
      ).toBe(false);
    });

    it("記号のみの電話番号表記同士も一致とみなさない", () => {
      expect(
        isTargetStoreMatch(
          { name: "炉端ジュン", address: null, phone: "-" },
          { ...TARGET_STORE, phone: "―" },
        ),
      ).toBe(false);
    });

    it("observed側だけが数字なしなら一致しない(target側は正規の番号)", () => {
      expect(
        isTargetStoreMatch({ name: "炉端ジュン", address: null, phone: "非公開" }, TARGET_STORE),
      ).toBe(false);
    });

    it("target側だけが数字なしなら一致しない(observed側は正規の番号)", () => {
      expect(
        isTargetStoreMatch(
          { name: "炉端ジュン", address: null, phone: "04-7199-7985" },
          { ...TARGET_STORE, phone: "不明" },
        ),
      ).toBe(false);
    });

    it("正常な電話番号の表記ゆれ一致は維持する(修正で壊さないことの確認)", () => {
      for (const observedPhone of ["04-7199-7985", "(04) 7199 7985", "tel: 04.7199.7985"]) {
        expect(
          isTargetStoreMatch({ name: "炉端ジュン", address: null, phone: observedPhone }, TARGET_STORE),
        ).toBe(true);
      }
    });

    /**
     * 全角・dash-like Unicode の吸収(PR #180 final merge-blocker fix、F3)。
     *
     * 修正前は `normalizePhone` が ASCII 限定の `\d` で数字以外を除去していたため、
     * モデルが `observed_phone` を全角で報告すると正規化結果が `""` になり、
     * 非空ガードによって**電話一致が常に成立しない false negative** になっていた。
     * 表記正規化のみを行い、桁の推測・国番号変換・先頭0の付与はしない。
     */
    it.each([
      ["全角数字 + 全角ハイフン", "０４－７１９９－７９８５"],
      ["MINUS SIGN(U+2212)", "04−7199−7985"],
      ["全角括弧 + 全角数字", "（０４）７１９９－７９８５"],
    ])("observed_phone が %s でも target の ASCII 表記と電話一致する", (_label, observedPhone) => {
      expect(
        isTargetStoreMatch({ name: "炉端ジュン", address: null, phone: observedPhone }, TARGET_STORE),
      ).toBe(true);
    });

    it("target 側が全角でも observed 側の ASCII 表記と電話一致する", () => {
      expect(
        isTargetStoreMatch(
          { name: "炉端ジュン", address: null, phone: "04-7199-7985" },
          { ...TARGET_STORE, phone: "０４－７１９９－７９８５" },
        ),
      ).toBe(true);
    });

    it("正規化しても別番号は同一視しない", () => {
      expect(
        isTargetStoreMatch(
          { name: "炉端ジュン", address: null, phone: "０４－７１９９－７９８６" },
          TARGET_STORE,
        ),
      ).toBe(false);
    });
  });
});

describe("isNameMatch / isAddressMatch / normalizePhone (re-export確認、fix/ai-research-source-identity-integrity)", () => {
  it("isNameMatchは表記ゆれを許容する", () => {
    expect(isNameMatch("東北メシ 炉端ジュン", "炉端ジュン")).toBe(true);
  });

  it("isAddressMatchは番地レベルの表記ゆれを許容する", () => {
    expect(isAddressMatch("千葉県柏市旭町1丁目1番地12号", "千葉県柏市旭町1-1-12")).toBe(true);
  });

  it("normalizePhoneは数字以外を除去する", () => {
    expect(normalizePhone("04-7199-7985")).toBe("0471997985");
  });

  it("normalizePhoneは全角数字・dash-like Unicodeを吸収する(F3)", () => {
    expect(normalizePhone("０４－７１９９－７９８５")).toBe("0471997985");
    expect(normalizePhone("04−7199−7985")).toBe("0471997985");
    expect(normalizePhone("（０４）７１９９　７９８５")).toBe("0471997985");
  });

  it("normalizePhoneは桁の推測・国番号変換・先頭0の付与をしない(表記正規化のみ)", () => {
    expect(normalizePhone("+81-4-7199-7985")).toBe("81471997985");
    expect(normalizePhone("非公開")).toBe("");
  });

  it("deriveSearchIdentityNameは先頭の管理タグを除去する", () => {
    expect(deriveSearchIdentityName("（Rアポハマロスト）炉端ジュン")).toBe("炉端ジュン");
  });
});
