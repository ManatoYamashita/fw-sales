/**
 * Stage0(Google Places 軽量再同期)の単体検証(fix/ai-research-poc-like-retrieval で新設)。
 *
 * `lib/places/google.ts:getPlaceById` をモックし、実 API を一切呼ばない。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockGetPlaceById } = vi.hoisted(() => ({
  mockGetPlaceById: vi.fn(),
}));

vi.mock("@/lib/places/google", () => ({
  getPlaceById: mockGetPlaceById,
}));

const { runStage0PlacesResync } = await import("../places-stage0");

const NOW = "2026-08-03T00:00:00.000Z";

const PLACE_RESULT = {
  placeId: "places/abc123",
  name: "炉端ジュン",
  formattedAddress: "千葉県柏市旭町1-1-12 1F",
  lat: 35.0,
  lng: 139.0,
  phone: "04-7199-7985",
  rating: 4.2,
  userRatingsTotal: 120,
  types: ["restaurant"],
  googleMapsUri: null,
};

beforeEach(() => {
  mockGetPlaceById.mockReset();
});

describe("runStage0PlacesResync", () => {
  it("google_place_idが無ければAPIを呼ばず空を返す(自動Text Searchはしない)", async () => {
    const result = await runStage0PlacesResync(null, NOW);
    expect(mockGetPlaceById).not.toHaveBeenCalled();
    expect(result.placesBasicInfo).toEqual({});
    expect(result.warning).toBeNull();
  });

  it("google_place_idがあればgetPlaceByIdを1回呼び、basic_infoへ変換する", async () => {
    mockGetPlaceById.mockResolvedValue(PLACE_RESULT);

    const result = await runStage0PlacesResync("places/abc123", NOW);

    expect(mockGetPlaceById).toHaveBeenCalledTimes(1);
    expect(mockGetPlaceById).toHaveBeenCalledWith("places/abc123");
    expect(result.placesBasicInfo.store_name?.value).toBe("炉端ジュン");
    expect(result.placesBasicInfo.store_name?.filled_by).toBe("places");
    expect(result.placesBasicInfo.phone?.value).toBe("04-7199-7985");
    expect(result.warning).toBeNull();
  });

  it("該当なし(null)の場合はwarningを返しAI調査全体は継続する", async () => {
    mockGetPlaceById.mockResolvedValue(null);

    const result = await runStage0PlacesResync("places/not-found", NOW);

    expect(result.placesBasicInfo).toEqual({});
    expect(result.warning).not.toBeNull();
  });

  it("API失敗時もresearch継続のため例外を投げず、warningを返す", async () => {
    mockGetPlaceById.mockRejectedValue(new Error("Places API エラー (500): internal"));

    const result = await runStage0PlacesResync("places/error", NOW);

    expect(result.placesBasicInfo).toEqual({});
    expect(result.warning).not.toBeNull();
    expect(result.warning).not.toContain("internal"); // 生エラーメッセージを露出しない
  });
});
