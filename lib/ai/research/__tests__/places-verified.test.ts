/**
 * Places検証済みキー導出の単体検証(AI 店舗調査再設計 Plan v3.2 §9, PR1 fresh review A)。
 */

import { describe, it, expect } from "vitest";
import {
  derivePlacesVerifiedKeys,
  deriveFreshPlacesVerifiedKeys,
  PLACES_VERIFIABLE_KEYS,
} from "../places-verified";
import type { BasicInfo, BasicInfoField } from "@/types/basic-info";

function field(overrides: Partial<BasicInfoField> = {}): BasicInfoField {
  return {
    value: "何かの値",
    tier: "A",
    filled_by: "places",
    updated_at: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("derivePlacesVerifiedKeys", () => {
  it("filled_by=placesかつ値ありのkeyを検証済みとする", () => {
    const basicInfo: BasicInfo = {
      store_name: field({ filled_by: "places", value: "イエローピザ" }),
      review_avg: field({ filled_by: "places", value: "4.2" }),
    };
    const verified = derivePlacesVerifiedKeys(basicInfo);
    expect(verified.has("store_name")).toBe(true);
    expect(verified.has("review_avg")).toBe(true);
  });

  it("filled_by=manualの項目は検証済みとしない (人間の手動確認とPlaces検証は別経路)", () => {
    const basicInfo: BasicInfo = {
      store_name: field({ filled_by: "manual", value: "手動入力した店名" }),
    };
    expect(derivePlacesVerifiedKeys(basicInfo).has("store_name")).toBe(false);
  });

  it("値が空文字/nullの項目は検証済みとしない", () => {
    const basicInfo: BasicInfo = {
      store_name: field({ filled_by: "places", value: "" }),
      address: field({ filled_by: "places", value: null }),
    };
    const verified = derivePlacesVerifiedKeys(basicInfo);
    expect(verified.has("store_name")).toBe(false);
    expect(verified.has("address")).toBe(false);
  });

  it("Places APIが実際には埋めないkey(business_hours_holidays等)は対象外リストに含まれない", () => {
    expect(PLACES_VERIFIABLE_KEYS).not.toContain("business_hours_holidays");
    expect(PLACES_VERIFIABLE_KEYS).not.toContain("official_site");
    expect(PLACES_VERIFIABLE_KEYS).not.toContain("location_feature");
    expect(PLACES_VERIFIABLE_KEYS).not.toContain("nearest_station");
  });

  it("basic_infoに存在しないkeyは無視する", () => {
    const verified = derivePlacesVerifiedKeys({});
    expect(verified.size).toBe(0);
  });
});

/**
 * fresh Places 検証(feat/ai-research-quality-ux-hardening、Plan §6.1)。
 *
 * `derivePlacesVerifiedKeys` は canonical `basic_info` を見るため、
 * `mergeBasicInfo` の manual 保護(`basic-info-merge.ts:88`)によって
 * 「Placesが今まさに答えている値」が破棄された後の状態しか観測できない。
 * `deriveFreshPlacesVerifiedKeys` は Stage0 の生の結果だけを見ることで、
 * canonical の状態から完全に独立させる。
 */
describe("deriveFreshPlacesVerifiedKeys", () => {
  it("Stage0が実際に取得したkeyのみを返す", () => {
    const fresh: Partial<BasicInfo> = {
      review_avg: field({ filled_by: "places", value: "4.4" }),
      review_count: field({ filled_by: "places", value: "51" }),
    };
    const verified = deriveFreshPlacesVerifiedKeys(fresh);
    expect(verified.has("review_avg")).toBe(true);
    expect(verified.has("review_count")).toBe(true);
    expect(verified.size).toBe(2);
  });

  it("Stage0が空(strong matchなし/API失敗)なら空集合", () => {
    expect(deriveFreshPlacesVerifiedKeys({}).size).toBe(0);
  });

  it("canonicalがmanualでも、fresh側にあれば検証済みになる(Q1の回帰テスト)", () => {
    // 実機事象: canonical review_avg が filled_by="manual" のため
    // `derivePlacesVerifiedKeys(effectiveBasicInfo)` からは永久に外れていた。
    const canonical: BasicInfo = {
      review_avg: field({ filled_by: "manual", value: "4.2" }),
    };
    const fresh: Partial<BasicInfo> = {
      review_avg: field({ filled_by: "places", value: "4.4" }),
    };
    expect(derivePlacesVerifiedKeys(canonical).has("review_avg")).toBe(false);
    expect(deriveFreshPlacesVerifiedKeys(fresh).has("review_avg")).toBe(true);
  });

  it("値が空文字/nullのkeyは含めない", () => {
    const fresh: Partial<BasicInfo> = {
      review_avg: field({ filled_by: "places", value: "" }),
      review_count: field({ filled_by: "places", value: null }),
    };
    expect(deriveFreshPlacesVerifiedKeys(fresh).size).toBe(0);
  });

  it("PLACES_VERIFIABLE_KEYS 外のkeyは(万一混入しても)含めない", () => {
    const fresh = {
      official_site: field({ filled_by: "places", value: "あり" }),
    } as Partial<BasicInfo>;
    expect(deriveFreshPlacesVerifiedKeys(fresh).has("official_site")).toBe(false);
  });

  it("filled_by が places でない値は(万一混入しても)含めない", () => {
    // `placeResultToBasicInfo` は必ず filled_by:"places" を刻むため通常は起こらないが、
    // 「Places由来であること」の不変条件を本関数側でも二重に守る。
    const fresh: Partial<BasicInfo> = {
      review_avg: field({ filled_by: "manual", value: "4.4" }),
    };
    expect(deriveFreshPlacesVerifiedKeys(fresh).size).toBe(0);
  });
});
