import { describe, expect, it } from "vitest";
import { findMatchedStore, attachStoreMatches } from "../match-store";
import type { PlaceResult } from "../types";
import type { Store } from "@/types/store";

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: "store_test_001",
    name: "テスト食堂",
    prefecture: "東京都",
    city: "渋谷区",
    address: "渋谷1-1-1",
    genre: "居酒屋",
    priority: "中",
    stage: "未調査",
    channel: "未判定",
    has_contact_form: "未確認",
    map_url: "",
    site_url: "",
    instagram_url: "",
    phone: "",
    target_service: "",
    review_count: 0,
    review_avg: 0,
    memo: "",
    assigned_planner_user_id: null,
    assigned_sales_user_id: null,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: 35.6762,
    lng: 139.6503,
    google_place_id: null,
    appointment_acquired_date: null,
    next_action_date: null,
    next_action_note: null,
    basic_info: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function makePlace(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    placeId: "ChIJ_test_place",
    name: "テスト食堂",
    formattedAddress: "東京都渋谷区1-1-1",
    lat: 35.6762,
    lng: 139.6503,
    phone: "",
    rating: null,
    userRatingsTotal: null,
    types: ["restaurant"],
    googleMapsUri: null,
    ...overrides,
  };
}

describe("findMatchedStore", () => {
  describe("第一優先: google_place_id 完全一致", () => {
    it("google_place_id が一致する場合は matchedStore を返す", () => {
      const store = makeStore({ google_place_id: "ChIJ_test_place" });
      const place = makePlace({ placeId: "ChIJ_test_place" });
      const result = findMatchedStore(place, [store]);
      expect(result).toEqual({ id: "store_test_001", name: "テスト食堂" });
    });

    it("google_place_id が不一致かつ補助条件も一致しない場合は null を返す", () => {
      // google_place_id 不一致 + 店名違い + 座標違い → どちらもヒットしない
      const store = makeStore({
        name: "別の店",
        google_place_id: "ChIJ_other",
        lat: 0,
        lng: 0,
      });
      const place = makePlace({ placeId: "ChIJ_test_place" });
      const result = findMatchedStore(place, [store]);
      expect(result).toBeNull();
    });

    it("google_place_id 一致がある場合は距離に関わらず第一優先で返る", () => {
      // 座標が全く違っても google_place_id 一致が優先される
      const store = makeStore({
        google_place_id: "ChIJ_test_place",
        lat: 0,
        lng: 0,
      });
      const place = makePlace({ placeId: "ChIJ_test_place" });
      const result = findMatchedStore(place, [store]);
      expect(result).toEqual({ id: "store_test_001", name: "テスト食堂" });
    });

    it("google_place_id が null の store でも補助判定 (店名 + 座標一致) でヒットする", () => {
      // google_place_id: null でも名前・座標が一致すれば第二優先でヒット
      const store = makeStore({ google_place_id: null });
      const place = makePlace();
      const result = findMatchedStore(place, [store]);
      expect(result).not.toBeNull();
    });
  });

  describe("第二優先: 店名一致 + 50m以内", () => {
    it("店名一致 + 50m以内 (≈44m) の場合は matchedStore を返す", () => {
      // 緯度差 0.0004° ≈ 44m — 50m以内
      const store = makeStore({
        google_place_id: null,
        lat: 35.6762 + 0.0004,
        lng: 139.6503,
      });
      const place = makePlace();
      const result = findMatchedStore(place, [store]);
      expect(result).not.toBeNull();
    });

    it("店名一致でも 50m超 (≈56m) の場合は null を返す", () => {
      // 緯度差 0.0005° ≈ 56m — 50m超
      const store = makeStore({
        google_place_id: null,
        lat: 35.6762 + 0.0005,
        lng: 139.6503,
      });
      const place = makePlace();
      const result = findMatchedStore(place, [store]);
      expect(result).toBeNull();
    });

    it("距離が近くても店名が違う場合は null を返す", () => {
      const store = makeStore({
        name: "別の食堂",
        google_place_id: null,
        lat: 35.6762,
        lng: 139.6503,
      });
      const place = makePlace({ name: "テスト食堂" });
      const result = findMatchedStore(place, [store]);
      expect(result).toBeNull();
    });

    it("store.lat が null の場合は距離判定をスキップし null を返す", () => {
      const store = makeStore({ google_place_id: null, lat: null, lng: 139.6503 });
      const place = makePlace();
      const result = findMatchedStore(place, [store]);
      expect(result).toBeNull();
    });

    it("store.lng が null の場合は距離判定をスキップし null を返す", () => {
      const store = makeStore({ google_place_id: null, lat: 35.6762, lng: null });
      const place = makePlace();
      const result = findMatchedStore(place, [store]);
      expect(result).toBeNull();
    });
  });

  describe("stores が空の場合", () => {
    it("空配列では常に null を返す", () => {
      expect(findMatchedStore(makePlace(), [])).toBeNull();
    });
  });
});

describe("attachStoreMatches", () => {
  it("一致する store があれば matchedStore を付与する", () => {
    const store = makeStore({ google_place_id: "ChIJ_test_place" });
    const place = makePlace({ placeId: "ChIJ_test_place" });
    const result = attachStoreMatches([place], [store]);
    expect(result).toHaveLength(1);
    expect(result[0]?.matchedStore).toEqual({ id: "store_test_001", name: "テスト食堂" });
  });

  it("一致しない場合は matchedStore が null になる", () => {
    const store = makeStore({ name: "別の店", google_place_id: "ChIJ_other", lat: 0, lng: 0 });
    const place = makePlace({ placeId: "ChIJ_test_place" });
    const result = attachStoreMatches([place], [store]);
    expect(result[0]?.matchedStore).toBeNull();
  });

  it("複数件でそれぞれ独立して照合される", () => {
    const storeA = makeStore({ id: "store_a", google_place_id: "place_a" });
    const storeB = makeStore({ id: "store_b", google_place_id: "place_b" });
    const placeA = makePlace({ placeId: "place_a", name: "店A" });
    const placeB = makePlace({ placeId: "place_b", name: "店B" });
    const placeC = makePlace({ placeId: "place_c", name: "店C" });
    const results = attachStoreMatches([placeA, placeB, placeC], [storeA, storeB]);
    expect(results[0]?.matchedStore?.id).toBe("store_a");
    expect(results[1]?.matchedStore?.id).toBe("store_b");
    expect(results[2]?.matchedStore).toBeNull();
  });
});
