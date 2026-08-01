/**
 * Places検証済みキー導出の単体検証(AI 店舗調査再設計 Plan v3.2 §9, PR1 fresh review A)。
 */

import { describe, it, expect } from "vitest";
import { derivePlacesVerifiedKeys, PLACES_VERIFIABLE_KEYS } from "../places-verified";
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
