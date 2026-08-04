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

  it("deriveSearchIdentityNameは先頭の管理タグを除去する", () => {
    expect(deriveSearchIdentityName("（Rアポハマロスト）炉端ジュン")).toBe("炉端ジュン");
  });
});
