/**
 * Stage0(Google Places 軽量再同期)の単体検証(fix/ai-research-poc-like-retrieval で新設、
 * feat/ai-research-quality-refinement で Text Search fallback を追加)。
 *
 * `lib/places/google.ts:getPlaceById`/`searchPlaces` をモックし、実 API を一切呼ばない。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockGetPlaceById, mockSearchPlaces } = vi.hoisted(() => ({
  mockGetPlaceById: vi.fn(),
  mockSearchPlaces: vi.fn(),
}));

vi.mock("@/lib/places/google", () => ({
  getPlaceById: mockGetPlaceById,
  searchPlaces: mockSearchPlaces,
}));

const {
  runStage0PlacesResync,
  deriveSearchIdentityName,
  isNameMatch,
  pickStrongPlaceMatch,
  classifyPlacesError,
} = await import("../places-stage0");

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

const STORE = {
  name: "（Rアポハマロスト）炉端ジュン",
  address: "千葉県柏市旭町1-1-12",
  phone: "04-7199-7985",
};

beforeEach(() => {
  mockGetPlaceById.mockReset();
  mockSearchPlaces.mockReset();
});

describe("deriveSearchIdentityName (feat/ai-research-quality-refinement)", () => {
  it("先頭の営業管理タグを除去する", () => {
    expect(deriveSearchIdentityName("（Rアポハマロスト）炉端ジュン")).toBe("炉端ジュン");
  });

  it("実データに存在する多様な管理タグ形式でも除去する", () => {
    expect(deriveSearchIdentityName("（7月1日NEW）自由が丘 NOCT （ジユウガオカノクト）")).toBe(
      "自由が丘 NOCT （ジユウガオカノクト）",
    );
    expect(deriveSearchIdentityName("（確バツ）おゆげ 自由が丘")).toBe("おゆげ 自由が丘");
  });

  it("管理prefixが無い正常な店舗名は変化しない", () => {
    expect(deriveSearchIdentityName("炉端ジュン")).toBe("炉端ジュン");
    expect(deriveSearchIdentityName("くるり")).toBe("くるり");
  });

  it("先頭でないフリガナ括弧は変化しない", () => {
    expect(deriveSearchIdentityName("川端 （かわばた）")).toBe("川端 （かわばた）");
    expect(deriveSearchIdentityName("四季彩百花 ひと色 （ヒトイロ）")).toBe("四季彩百花 ひと色 （ヒトイロ）");
  });

  it("除去後に空文字になる異常系はrawへフォールバックする", () => {
    expect(deriveSearchIdentityName("（）")).toBe("（）");
  });
});

describe("isNameMatch (feat/ai-research-quality-refinement)", () => {
  it("完全一致する", () => {
    expect(isNameMatch("炉端ジュン", "炉端ジュン")).toBe(true);
  });

  it("Google側表記が長い場合も包含関係でマッチする", () => {
    expect(isNameMatch("東北メシ 炉端ジュン", "炉端ジュン")).toBe(true);
  });

  it("名前が異なる場合はマッチしない", () => {
    expect(isNameMatch("焼肉なかた", "炉端ジュン")).toBe(false);
  });

  it("極端に短い名前は誤マッチ防止のためマッチしない(完全一致を除く)", () => {
    expect(isNameMatch("何らかの店名にAを含む", "A")).toBe(false);
  });
});

describe("pickStrongPlaceMatch (feat/ai-research-quality-refinement)", () => {
  it("店舗名(prefix除去後)+住所一致でstrong matchを採用する", () => {
    const result = pickStrongPlaceMatch([{ ...PLACE_RESULT, name: "東北メシ 炉端ジュン" }], STORE);
    expect(result).not.toBeNull();
    expect(result?.placeId).toBe("places/abc123");
  });

  it("同名だが住所も電話も不一致なら不採用(reject)", () => {
    const result = pickStrongPlaceMatch(
      [{ ...PLACE_RESULT, name: "炉端ジュン", formattedAddress: "東京都渋谷区1-1-1", phone: "03-0000-0000" }],
      STORE,
    );
    expect(result).toBeNull();
  });

  it("prefix除去後も名前が一致しなければ不採用", () => {
    const result = pickStrongPlaceMatch([{ ...PLACE_RESULT, name: "全く別の店舗名" }], STORE);
    expect(result).toBeNull();
  });

  it("複数のstrong candidateが存在する場合は曖昧のため不採用", () => {
    const result = pickStrongPlaceMatch(
      [
        { ...PLACE_RESULT, placeId: "places/a", name: "炉端ジュン" },
        { ...PLACE_RESULT, placeId: "places/b", name: "炉端ジュン" },
      ],
      STORE,
    );
    expect(result).toBeNull();
  });

  it("電話番号一致のみでもstrong matchとして採用する", () => {
    const result = pickStrongPlaceMatch(
      [{ ...PLACE_RESULT, name: "炉端ジュン", formattedAddress: "異なる住所表記" }],
      STORE,
    );
    expect(result).not.toBeNull();
  });
});

describe("runStage0PlacesResync", () => {
  describe("google_place_idがある場合(既存経路、変更なし)", () => {
    it("getPlaceByIdを1回呼び、basic_infoへ変換する", async () => {
      mockGetPlaceById.mockResolvedValue(PLACE_RESULT);

      const result = await runStage0PlacesResync({
        googlePlaceId: "places/abc123",
        store: STORE,
        now: NOW,
      });

      expect(mockGetPlaceById).toHaveBeenCalledTimes(1);
      expect(mockGetPlaceById).toHaveBeenCalledWith("places/abc123");
      expect(mockSearchPlaces).not.toHaveBeenCalled();
      expect(result.placesBasicInfo.store_name?.value).toBe("炉端ジュン");
      expect(result.placesBasicInfo.store_name?.filled_by).toBe("places");
      expect(result.placesBasicInfo.phone?.value).toBe("04-7199-7985");
      expect(result.warning).toBeNull();
    });

    it("該当なし(null)の場合はwarningを返しAI調査全体は継続する", async () => {
      mockGetPlaceById.mockResolvedValue(null);

      const result = await runStage0PlacesResync({
        googlePlaceId: "places/not-found",
        store: STORE,
        now: NOW,
      });

      expect(result.placesBasicInfo).toEqual({});
      expect(result.warning).not.toBeNull();
    });

    it("API失敗時もresearch継続のため例外を投げず、warningを返す", async () => {
      mockGetPlaceById.mockRejectedValue(new Error("Places API エラー (500): internal"));

      const result = await runStage0PlacesResync({
        googlePlaceId: "places/error",
        store: STORE,
        now: NOW,
      });

      expect(result.placesBasicInfo).toEqual({});
      expect(result.warning).not.toBeNull();
      expect(result.warning).not.toContain("internal"); // 生エラーメッセージを露出しない
    });
  });

  describe("google_place_idが無い場合(Text Search fallback、feat/ai-research-quality-refinement)", () => {
    it("strong matchが一意に定まればsearchPlacesを1回呼び採用する(追加のDetails callは行わない)", async () => {
      mockSearchPlaces.mockResolvedValue([{ ...PLACE_RESULT, name: "東北メシ 炉端ジュン" }]);

      const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });

      expect(mockSearchPlaces).toHaveBeenCalledTimes(1);
      expect(mockSearchPlaces).toHaveBeenCalledWith("炉端ジュン", STORE.address); // prefix除去後の名前で検索
      expect(mockGetPlaceById).not.toHaveBeenCalled();
      expect(result.placesBasicInfo.store_name?.value).toBe("東北メシ 炉端ジュン");
      expect(result.warning).toBeNull();
    });

    it("曖昧(0件)の場合は不採用、warningも出さず従来どおり続行する", async () => {
      mockSearchPlaces.mockResolvedValue([]);

      const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });

      expect(result.placesBasicInfo).toEqual({});
      expect(result.warning).toBeNull();
    });

    it("曖昧(複数候補)の場合は不採用", async () => {
      mockSearchPlaces.mockResolvedValue([
        { ...PLACE_RESULT, placeId: "places/a", name: "炉端ジュン" },
        { ...PLACE_RESULT, placeId: "places/b", name: "炉端ジュン" },
      ]);

      const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });

      expect(result.placesBasicInfo).toEqual({});
      expect(result.warning).toBeNull();
    });

    it("Text Search失敗時もresearch継続のため例外を投げず、warningを返す(feat/ai-research-final-quality: sanitized kindを含む)", async () => {
      mockSearchPlaces.mockRejectedValue(new Error("Places API エラー (500): internal"));

      const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });

      expect(result.placesBasicInfo).toEqual({});
      expect(result.warning).not.toBeNull();
      expect(result.warning).not.toContain("internal");
      expect(result.warning).toContain("api_error:500");
    });
  });

  it("getPlaceById失敗時もsanitized kindを含むwarningを返す", async () => {
    mockGetPlaceById.mockRejectedValue(new Error("Places API エラー (403): forbidden detail"));

    const result = await runStage0PlacesResync({ googlePlaceId: "places/x", store: STORE, now: NOW });

    expect(result.warning).toContain("api_error:403");
    expect(result.warning).not.toContain("forbidden detail");
  });
});

describe("classifyPlacesError (feat/ai-research-final-quality)", () => {
  it("GOOGLE_PLACES_API_KEY未設定エラーはmissing_api_keyになる", () => {
    expect(classifyPlacesError(new Error("GOOGLE_PLACES_API_KEY が設定されていません"))).toBe(
      "missing_api_key",
    );
  });

  it("HTTPステータス付きエラーはapi_error:<status>になる(生レスポンス本文は含まない)", () => {
    expect(classifyPlacesError(new Error("Places API エラー (403): secret detail here"))).toBe(
      "api_error:403",
    );
  });

  it("ステータス不明・分類不能なエラーはunknownになる", () => {
    expect(classifyPlacesError(new Error("something else"))).toBe("unknown");
    expect(classifyPlacesError("plain string")).toBe("unknown");
  });
});
