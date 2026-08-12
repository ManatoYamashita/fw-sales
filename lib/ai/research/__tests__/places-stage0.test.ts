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
  diagnosePlacesMatch,
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

  describe("電話一致は正規化後の非空を必須とする(PR #180 review Finding 2 の hardening)", () => {
    // `identity-match.ts:isTargetStoreMatch`と同じ不変条件。現在のGoogle Places入力では
    // 顕在化しにくいが、供給元が変わっても `"" === ""` が identity match にならないよう固定する。
    const NO_ADDRESS_MATCH = { name: "炉端ジュン", formattedAddress: "異なる住所表記" };

    it("数字を含まない文字列同士は電話一致とみなさない", () => {
      const result = pickStrongPlaceMatch(
        [{ ...PLACE_RESULT, ...NO_ADDRESS_MATCH, phone: "不明" }],
        { ...STORE, phone: "未掲載" },
      );
      expect(result).toBeNull();
    });

    it("記号だけの表記同士も電話一致とみなさない", () => {
      const result = pickStrongPlaceMatch(
        [{ ...PLACE_RESULT, ...NO_ADDRESS_MATCH, phone: "-" }],
        { ...STORE, phone: "―" },
      );
      expect(result).toBeNull();
    });

    it("候補側だけが正規化後空なら電話一致とみなさない", () => {
      const result = pickStrongPlaceMatch(
        [{ ...PLACE_RESULT, ...NO_ADDRESS_MATCH, phone: "非公開" }],
        STORE,
      );
      expect(result).toBeNull();
    });

    it("店舗側だけが正規化後空なら電話一致とみなさない", () => {
      const result = pickStrongPlaceMatch([{ ...PLACE_RESULT, ...NO_ADDRESS_MATCH }], {
        ...STORE,
        phone: "不明",
      });
      expect(result).toBeNull();
    });

    it("正常な表記ゆれ(03-1234-5678 と 0312345678)は電話一致として採用する", () => {
      const result = pickStrongPlaceMatch(
        [{ ...PLACE_RESULT, ...NO_ADDRESS_MATCH, phone: "03-1234-5678" }],
        { ...STORE, phone: "0312345678" },
      );
      expect(result).not.toBeNull();
    });
  });

  describe("日本住所の表記ゆれ吸収(feat/ai-research-searchfact-places-match、実APIで確認済みの実例)", () => {
    it("Google側の「日本、〒xxx-xxxx」prefix + 全角数字「丁目」表記と、fw-sales側の半角ハイフン表記が一致する", () => {
      // 実際のText Search 1回で確認した実データ形式(炉端ジュン)。
      // Google: "日本、〒277-0852 千葉県柏市旭町１丁目１－１２ 1F"
      // store : "〒2770852 千葉県 柏市 旭町1-1-12 1F"
      const store = {
        name: "炉端ジュン",
        address: "〒2770852 千葉県 柏市 旭町1-1-12 1F",
        phone: "04-7199-7985",
      };
      const result = pickStrongPlaceMatch(
        [
          {
            ...PLACE_RESULT,
            name: "東北メシ炉端ジュン",
            formattedAddress: "日本、〒277-0852 千葉県柏市旭町１丁目１－１２ 1F",
            phone: "",
          },
        ],
        store,
      );
      expect(result).not.toBeNull();
    });

    it("丁目・番地・号を含む住所表記でも一致する", () => {
      const store = { name: "テスト店", address: "東京都渋谷区道玄坂1-2-3", phone: "" };
      const result = pickStrongPlaceMatch(
        [{ ...PLACE_RESULT, name: "テスト店", formattedAddress: "日本、〒150-0043 東京都渋谷区道玄坂１丁目２番地３号", phone: "" }],
        store,
      );
      expect(result).not.toBeNull();
    });

    it("番地・住所自体が異なる場合は一致しない(過剰な曖昧化はしない)", () => {
      const store = { name: "テスト店", address: "東京都渋谷区道玄坂1-2-3", phone: "" };
      const result = pickStrongPlaceMatch(
        [{ ...PLACE_RESULT, name: "テスト店", formattedAddress: "日本、〒150-0043 東京都渋谷区道玄坂４丁目５番地６号", phone: "" }],
        store,
      );
      expect(result).toBeNull();
    });

    it("番地相当の具体的な数字が無い(町丁目までしか無い)短い住所は、包含判定だけでは一致とみなさない(fix/ai-research-final-audit-hardening、監査で発見: 同じ町丁目の別建物への誤マッチ防止)", () => {
      // stores.addressが旧データ等で丁目までしか登録されておらず番地が無い場合、
      // 包含判定(a.includes(b))は同じ町丁目内の「別の建物」のformattedAddressにも
      // 常にマッチしてしまう。番地相当の数字-数字パターンを両者に要求することで
      // この過剰マッチを防ぐ。
      const store = { name: "テスト店", address: "東京都渋谷区道玄坂1丁目", phone: "" };
      const result = pickStrongPlaceMatch(
        [
          {
            ...PLACE_RESULT,
            name: "テスト店",
            formattedAddress: "日本、〒150-0043 東京都渋谷区道玄坂１丁目９９番地９９号",
            phone: "",
          },
        ],
        store,
      );
      expect(result).toBeNull();
    });

    it("Google側の区切り文字がU+2212(MINUS SIGN)の場合でも一致する(feat/ai-research-final-trust-boundary、実APIで確認した実際のバグ再現)", () => {
      // 実際のText Search 1回で確認した実データ(炉端ジュン、2026-08-04)。
      // 従来はNFKC正規化のみに依存していたが、GoogleはU+2212(MINUS SIGN、数学記号)を
      // 区切り文字に使うことがあり、NFKCはこれをASCIIハイフンへ変換しない
      // (NFKCが変換するのは全角ハイフンU+FF0D等の互換分解対象のみ)ため、
      // 正規化後も住所が一致しないという実バグがあった。
      const store = {
        name: "炉端ジュン",
        address: "〒2770852 千葉県 柏市 旭町1-1-12 1F",
        phone: "04-7199-7985",
      };
      // 実際のGoogle応答で確認されたMINUS SIGN(U+2212)を明示的にエスケープで指定する
      // (見た目が似たハイフン系文字と混同しないよう、コピペではなくunicodeエスケープを使う)。
      const minusSign = "−";
      const result = pickStrongPlaceMatch(
        [
          {
            ...PLACE_RESULT,
            name: "東北メシ炉端ジュン",
            formattedAddress: `日本、〒277-0852 千葉県柏市旭町１丁目１${minusSign}12 1F`,
            phone: "",
          },
        ],
        store,
      );
      expect(result).not.toBeNull();
    });
  });
});

describe("diagnosePlacesMatch (feat/ai-research-searchfact-places-match)", () => {
  it("候補0件の場合はplaces_search_no_matchを返す", () => {
    expect(diagnosePlacesMatch([], STORE)).toBe("places_search_no_match");
  });

  it("strong matchが0件(名前・住所・電話いずれも不一致)の場合はplaces_search_no_matchを返す", () => {
    const result = diagnosePlacesMatch(
      [{ ...PLACE_RESULT, name: "全く別の店舗", formattedAddress: "東京都", phone: "" }],
      STORE,
    );
    expect(result).toBe("places_search_no_match");
  });

  it("strong matchが複数件の場合はplaces_search_ambiguousを返す", () => {
    const result = diagnosePlacesMatch(
      [
        { ...PLACE_RESULT, placeId: "places/a", name: "炉端ジュン" },
        { ...PLACE_RESULT, placeId: "places/b", name: "炉端ジュン" },
      ],
      STORE,
    );
    expect(result).toBe("places_search_ambiguous");
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
      // 第2引数の undefined は「timeoutMs 未指定 = fetch に signal を付けない」を意味する
      // (runtime reliability hardening、F5 でオプション引数を追加)。
      expect(mockGetPlaceById).toHaveBeenCalledWith("places/abc123", undefined);
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
      // prefix除去後の名前で検索。第3引数の undefined は timeoutMs 未指定 (F5)。
      expect(mockSearchPlaces).toHaveBeenCalledWith("炉端ジュン", STORE.address, undefined);
      expect(mockGetPlaceById).not.toHaveBeenCalled();
      expect(result.placesBasicInfo.store_name?.value).toBe("東北メシ 炉端ジュン");
      expect(result.warning).toBeNull();
    });

    it("曖昧(0件)の場合は不採用、sanitizedなno-match診断warningを返す(feat/ai-research-searchfact-places-match)", async () => {
      mockSearchPlaces.mockResolvedValue([]);

      const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });

      expect(result.placesBasicInfo).toEqual({});
      expect(result.warning).toContain("places_search_no_match");
    });

    it("曖昧(複数候補)の場合は不採用、sanitizedなambiguous診断warningを返す", async () => {
      mockSearchPlaces.mockResolvedValue([
        { ...PLACE_RESULT, placeId: "places/a", name: "炉端ジュン" },
        { ...PLACE_RESULT, placeId: "places/b", name: "炉端ジュン" },
      ]);

      const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });

      expect(result.placesBasicInfo).toEqual({});
      expect(result.warning).toContain("places_search_ambiguous");
      expect(result.warning).not.toContain("places/a"); // 候補の個別情報は含めない
      expect(result.warning).not.toContain("炉端ジュン");
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

  // runtime reliability hardening (F5): Stage0 に明示 timeout を導入したため、
  // abort を api_error/unknown と混同せず専用種別へ落とす。
  it("AbortSignal.timeout由来のTimeoutErrorはtimeoutになる", () => {
    expect(classifyPlacesError(new DOMException("The operation was aborted.", "TimeoutError"))).toBe(
      "timeout",
    );
  });

  it("AbortErrorもtimeoutになる", () => {
    expect(classifyPlacesError(new DOMException("This operation was aborted", "AbortError"))).toBe(
      "timeout",
    );
  });
});

/**
 * Stage0 の明示 timeout (runtime reliability hardening、F5)。
 *
 * `lib/places/google.ts` の `fetch` には元々 `AbortSignal` が無く、Stage0 の 1 attempt が
 * platform 上限(300 秒)まで伸びうる状態だった。Stage0 は best-effort の補助処理なので、
 * 早めに諦めて Stage1(Gemini)へ進む方がよい。**run 全体を failed にしてはいけない。**
 */
describe("Stage0の明示timeout (runtime reliability hardening、F5)", () => {
  const TIMEOUT_MS = 15_000;

  function timeoutError(): DOMException {
    return new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }

  it("Place Details経路でtimeoutMsをplacesクライアントへ渡す", async () => {
    mockGetPlaceById.mockResolvedValue(PLACE_RESULT);

    await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
      timeoutMs: TIMEOUT_MS,
    });

    expect(mockGetPlaceById).toHaveBeenCalledWith("places/abc123", { timeoutMs: TIMEOUT_MS });
  });

  it("Text Search経路でもtimeoutMsを渡す", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_RESULT]);

    await runStage0PlacesResync({
      googlePlaceId: null,
      store: STORE,
      now: NOW,
      timeoutMs: TIMEOUT_MS,
    });

    expect(mockSearchPlaces).toHaveBeenCalledWith("炉端ジュン", STORE.address, {
      timeoutMs: TIMEOUT_MS,
    });
  });

  it("timeoutMs未指定なら従来どおりoptionsを渡さない(既存呼び出し元の挙動を変えない)", async () => {
    mockGetPlaceById.mockResolvedValue(PLACE_RESULT);

    await runStage0PlacesResync({ googlePlaceId: "places/abc123", store: STORE, now: NOW });

    expect(mockGetPlaceById).toHaveBeenCalledWith("places/abc123", undefined);
  });

  it("Place Details timeout時はthrowせずwarningを返しWeb調査へ続行する", async () => {
    mockGetPlaceById.mockRejectedValue(timeoutError());

    const result = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.placesBasicInfo).toEqual({});
    expect(result.warning).toContain("timeout");
    expect(result.warning).toContain("既存情報のみで調査を続行します");
  });

  it("Text Search timeout時もthrowせずwarningを返す", async () => {
    mockSearchPlaces.mockRejectedValue(timeoutError());

    const result = await runStage0PlacesResync({
      googlePlaceId: null,
      store: STORE,
      now: NOW,
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.placesBasicInfo).toEqual({});
    expect(result.warning).toContain("timeout");
  });

  it("timeout warningに店舗名・住所・電話などの入力値を含めない", async () => {
    mockGetPlaceById.mockRejectedValue(timeoutError());

    const result = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.warning).not.toContain(STORE.name);
    expect(result.warning).not.toContain(STORE.address);
    expect(result.warning).not.toContain(STORE.phone);
    expect(result.warning).not.toContain("places/abc123");
  });
});

/**
 * Stage0 の診断可視化(feat/ai-research-quality-ux-hardening、Plan §6.3)。
 *
 * 従来 `Stage0PlacesResult` は `{placesBasicInfo, warning}` のみで、
 * **成功時は何も残らなかった**。`google_place_id=null` の店舗で Text Search が
 * strong match したのかどうかを後から観測する手段が無く、実機事象の切り分けで
 * Supabase を直接開く必要があった。値そのものは載せず、種別のみを返す。
 */
describe("Stage0PlacesResult.diagnostic (Plan §6.3)", () => {
  it("place_id経路で成功したら path=place_id / outcome=matched / review_fields_present=true", async () => {
    mockGetPlaceById.mockResolvedValue(PLACE_RESULT);
    const result = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
    });
    expect(result.diagnostic.path).toBe("place_id");
    expect(result.diagnostic.outcome).toBe("matched");
    expect(result.diagnostic.review_fields_present).toBe(true);
  });

  it("place_idが無くText Searchでstrong matchしたら path=text_search / outcome=matched", async () => {
    mockSearchPlaces.mockResolvedValue([PLACE_RESULT]);
    const result = await runStage0PlacesResync({
      googlePlaceId: null,
      store: STORE,
      now: NOW,
    });
    expect(result.diagnostic.path).toBe("text_search");
    expect(result.diagnostic.outcome).toBe("matched");
    expect(result.diagnostic.review_fields_present).toBe(true);
  });

  it("strong matchが0件なら outcome=no_match", async () => {
    mockSearchPlaces.mockResolvedValue([]);
    const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });
    expect(result.diagnostic.outcome).toBe("no_match");
    expect(result.diagnostic.review_fields_present).toBe(false);
  });

  it("strong matchが複数なら outcome=ambiguous", async () => {
    mockSearchPlaces.mockResolvedValue([
      { ...PLACE_RESULT, placeId: "places/a" },
      { ...PLACE_RESULT, placeId: "places/b" },
    ]);
    const result = await runStage0PlacesResync({ googlePlaceId: null, store: STORE, now: NOW });
    expect(result.diagnostic.outcome).toBe("ambiguous");
  });

  it("timeoutは outcome=timeout、その他API失敗は outcome=api_error", async () => {
    const timeoutErr = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    mockGetPlaceById.mockRejectedValue(timeoutErr);
    const timedOut = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
    });
    expect(timedOut.diagnostic.outcome).toBe("timeout");

    mockGetPlaceById.mockReset();
    mockGetPlaceById.mockRejectedValue(new Error("Places API エラー (500): boom"));
    const apiError = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
    });
    expect(apiError.diagnostic.outcome).toBe("api_error");
  });

  it("place_id経路で該当なし(null)なら outcome=no_match", async () => {
    mockGetPlaceById.mockResolvedValue(null);
    const result = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
    });
    expect(result.diagnostic.path).toBe("place_id");
    expect(result.diagnostic.outcome).toBe("no_match");
  });

  it("rating/userRatingCountが取れなかった場合は review_fields_present=false", async () => {
    mockGetPlaceById.mockResolvedValue({ ...PLACE_RESULT, rating: null, userRatingsTotal: null });
    const result = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
    });
    expect(result.diagnostic.outcome).toBe("matched");
    expect(result.diagnostic.review_fields_present).toBe(false);
  });

  it("diagnosticに店舗名・place_id・評価値などの個別情報を含めない(sanitized)", async () => {
    mockGetPlaceById.mockResolvedValue(PLACE_RESULT);
    const result = await runStage0PlacesResync({
      googlePlaceId: "places/abc123",
      store: STORE,
      now: NOW,
    });
    const serialized = JSON.stringify(result.diagnostic);
    expect(serialized).not.toContain("places/abc123");
    expect(serialized).not.toContain("炉端ジュン");
    expect(serialized).not.toContain("4.2");
  });
});
