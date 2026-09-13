/**
 * URL Import の server boundary 検証 (Issue #207)。
 *
 * ## この suite が固定する不変条件
 *
 * `/stores/new` の URL Import は **Google マップの店舗 URL 専用**であり、
 * それ以外の URL に対しては **外部への HTTP リクエストを 1 回も発生させない**。
 *
 * 本番で確認された 2 つの事故を構造的に塞ぐことが目的:
 *
 * 1. `tabelog.com` へ取得しにいって Cloudflare が HTTP 403 + challenge HTML を返し、
 *    店舗名が空のまま登録画面へ進んでいた
 * 2. `google.com/search?q=…` を貼ると `unknown` として OGP を取得し、
 *    `<title>Google Search</title>` が **店舗名**として採用されていた
 *
 * したがって「`fetchOgp` が呼ばれないこと」「`searchPlaces` が呼ばれないこと」を
 * 明示的に assert する(戻り値だけを見ても、内部で fetch していないことは分からない)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceResult } from "@/lib/places/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/url-parser/ogp", () => ({
  fetchOgp: vi.fn(),
}));
vi.mock("@/lib/places/google", () => ({
  searchPlaces: vi.fn(),
  getPlaceById: vi.fn(),
}));

const { fetchOgp } = await import("@/lib/url-parser/ogp");
const { searchPlaces, getPlaceById } = await import("@/lib/places/google");
const { importFromUrlAction } = await import("../url-parse-actions");
const { evaluateUrlImportPolicy } = await import("@/lib/url-parser/url-import-policy");

const mockedFetchOgp = vi.mocked(fetchOgp);
const mockedSearchPlaces = vi.mocked(searchPlaces);
const mockedGetPlaceById = vi.mocked(getPlaceById);

function makePlace(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    placeId: "ChIJtest",
    name: "導楽",
    formattedAddress: "神奈川県川崎市中原区新丸子東1-983",
    lat: 35.5,
    lng: 139.6,
    phone: "044-750-9977",
    rating: 3.4,
    userRatingsTotal: 12,
    types: ["restaurant", "food"],
    googleMapsUri: "https://maps.google.com/?cid=123",
    ...overrides,
  };
}

const PLACE_URL = "https://www.google.com/maps/place/導楽";
const SHORT_URL = "https://maps.app.goo.gl/abc123";

beforeEach(() => {
  mockedFetchOgp.mockReset();
  mockedSearchPlaces.mockReset();
  mockedGetPlaceById.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("importFromUrlAction — 受け付けない URL では外部リクエストを一切行わない", () => {
  /**
   * 「戻り値が rejected であること」だけでなく
   * 「Vercel → 外部サイトへのリクエストが発生していないこと」を固定する。
   * 前者だけだと、内部で fetch してから捨てる実装でもテストが緑になってしまう。
   */
  it.each([
    ["食べログ", "https://tabelog.com/tokyo/A1301/A130101/13001895/", "tabelog_unsupported"],
    ["食べログ (www)", "https://www.tabelog.com/tokyo/A1301/A130101/13001895/", "tabelog_unsupported"],
    ["Google 検索結果", "https://www.google.com/search?q=%E5%B0%8E%E6%A5%BD", "not_place_url"],
    ["Google トップ", "https://www.google.com/", "not_place_url"],
    ["Google マップ検索", "https://www.google.com/maps/search/居酒屋", "not_place_url"],
    ["Google マップ経路", "https://www.google.com/maps/dir/A/B", "not_place_url"],
    ["Google マップ ?q=", "https://www.google.com/maps?q=導楽", "not_place_url"],
    ["Instagram", "https://www.instagram.com/example/", "unsupported_source"],
    ["一般 Web ページ", "https://example.com/foo", "unsupported_source"],
    ["不正な URL", "not a url", "invalid_url"],
    ["空文字", "", "invalid_url"],
  ])("%s → rejected(%s) かつ fetchOgp / searchPlaces を呼ばない", async (_label, url, reason) => {
    const result = await importFromUrlAction(url);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe(reason);
    expect(mockedFetchOgp).not.toHaveBeenCalled();
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });

  it("evil ドメインのクエリに Google マップ URL を含んでいても拒否する", async () => {
    const result = await importFromUrlAction(
      "https://evil.example/?next=https://www.google.com/maps/place/foo",
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("unsupported_source");
    expect(mockedFetchOgp).not.toHaveBeenCalled();
  });

  it("lookalike ドメインを拒否する", async () => {
    const result = await importFromUrlAction("https://maps.google.com.evil.example/maps/place/foo");
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("unsupported_source");
    expect(mockedFetchOgp).not.toHaveBeenCalled();
  });
});

describe("importFromUrlAction — Google マップ店舗 URL (full)", () => {
  it("full place URL では OGP を取得しない(Google マップ HTML は SPA で情報源にならない)", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const result = await importFromUrlAction(PLACE_URL);

    expect(mockedFetchOgp).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.ogp).toBeNull();
    expect(result.parsed.type).toBe("google_maps");
  });

  /**
   * allowlist と実装の drift 回帰 (Issue #207)。
   *
   * `google.co.jp` は allowlist に含めた正式対応ホストだが、汎用ディスパッチャ
   * `parseStoreUrl` は `includes("google.com/maps")` 等の部分文字列判定なので
   * `.co.jp` を `unknown` に落とす。両者を直列に使うと「policy は受理したのに
   * パーサ分類で `not_place_url` に落ちる」という乖離が起きるため、
   * 受付後は `parseGoogleMapsUrl` を直接呼ぶ実装にしてある。
   *
   * このテストは「allowlist に載せたホストが end-to-end で本当に通る」ことを固定する。
   */
  it.each([
    "https://www.google.com/maps/place/導楽",
    "https://google.com/maps/place/導楽",
    "https://maps.google.com/maps/place/導楽",
    "https://www.google.co.jp/maps/place/導楽",
    "https://maps.google.co.jp/maps/place/導楽",
  ])("allowlist のホストは end-to-end で店舗名を解析できる: %s", async (url) => {
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const result = await importFromUrlAction(url);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.parsed.type).toBe("google_maps");
    expect(result.suggested.name).toBe("導楽");
  });

  it("URL 由来の店舗名で Places 補完が成功する", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);
    const result = await importFromUrlAction(PLACE_URL);

    expect(mockedSearchPlaces).toHaveBeenCalledOnce();
    if (result.status !== "success") throw new Error("expected success");
    expect(result.placesFallback?.used).toBe(true);
    expect(result.placesFallback?.matched_place_id).toBe("ChIJtest");
    expect(result.suggested.name).toBe("導楽");
    expect(result.suggested.address).toBe("神奈川県川崎市中原区新丸子東1-983");
    expect(result.suggested.phone).toBe("044-750-9977");
  });

  it("Places が候補 0 件でも URL 由来の値を保持したまま success を返す", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([]);
    const result = await importFromUrlAction(PLACE_URL);

    if (result.status !== "success") throw new Error("expected success");
    expect(result.placesFallback?.used).toBe(false);
    expect(result.placesFallback?.reason).toBe("places_not_found");
    // URL から取れていた店舗名・map_url は失われない。
    expect(result.suggested.name).toBe("導楽");
    expect(result.suggested.map_url).toBe(PLACE_URL);
  });

  it("Places API が失敗しても URL 由来の値を保持したまま success を返す", async () => {
    mockedSearchPlaces.mockRejectedValueOnce(new Error("Places API エラー (500): boom"));
    const result = await importFromUrlAction(PLACE_URL);

    if (result.status !== "success") throw new Error("expected success");
    expect(result.placesFallback?.reason).toBe("api_error");
    expect(result.suggested.name).toBe("導楽");
    expect(result.suggested.map_url).toBe(PLACE_URL);
  });

  /**
   * API キー未設定は「設定の問題」であって、貼られた URL が悪いわけではない。
   * URL Import 全体を失敗扱いにせず、URL 由来の値を保持したまま進める。
   */
  it("Places API キー未設定でも URL 由来の値を保持したまま success を返す", async () => {
    mockedSearchPlaces.mockRejectedValueOnce(
      new Error("GOOGLE_PLACES_API_KEY が設定されていません"),
    );
    const result = await importFromUrlAction(PLACE_URL);

    if (result.status !== "success") throw new Error("expected success");
    expect(result.placesFallback?.used).toBe(false);
    expect(result.placesFallback?.reason).toBe("no_api_key");
    expect(result.suggested.name).toBe("導楽");
    expect(result.suggested.map_url).toBe(PLACE_URL);
    expect(result.suggested.confidence.name).toBeDefined();
  });

  it("同名候補が複数ある場合は ambiguous として採用しない", async () => {
    mockedSearchPlaces.mockResolvedValueOnce([
      makePlace({ placeId: "A", userRatingsTotal: 9999 }),
      makePlace({ placeId: "B", userRatingsTotal: 3 }),
    ]);
    const result = await importFromUrlAction(PLACE_URL);

    if (result.status !== "success") throw new Error("expected success");
    expect(result.placesFallback?.used).toBe(false);
    expect(result.placesFallback?.reason).toBe("ambiguous");
    expect(result.placesFallback?.matched_place_id).toBeUndefined();
    // 口コミ最多の候補が勝手に採用されていないこと。
    expect(result.suggested.phone).toBe("");
  });

  it("店舗名を読み取れない place URL でも Places を呼ばず success で返す(UI 側で止める)", async () => {
    const result = await importFromUrlAction(
      "https://www.google.com/maps/place/data=!4m5!3m4",
    );

    if (result.status !== "success") throw new Error("expected success");
    expect(result.suggested.name).toBe("");
    expect(result.placesFallback?.reason).toBe("no_keyword");
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });
});

describe("importFromUrlAction — Google マップ短縮 URL", () => {
  it("redirect 先が店舗 URL なら再パースして Places 補完する", async () => {
    mockedFetchOgp.mockResolvedValueOnce({ ok: true, final_url: PLACE_URL });
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);

    const result = await importFromUrlAction(SHORT_URL);

    expect(mockedFetchOgp).toHaveBeenCalledOnce();
    if (result.status !== "success") throw new Error("expected success");
    expect(result.suggested.name).toBe("導楽");
    // ユーザーが実際に貼った URL を source_url として保持する。
    expect(result.parsed.source_url).toBe(SHORT_URL);
  });

  it("redirect 先が Google マップ以外なら拒否する", async () => {
    mockedFetchOgp.mockResolvedValueOnce({ ok: true, final_url: "https://evil.example/store" });

    const result = await importFromUrlAction(SHORT_URL);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("unsupported_source");
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });

  it("redirect 先が食べログなら tabelog_unsupported として拒否する", async () => {
    mockedFetchOgp.mockResolvedValueOnce({
      ok: true,
      final_url: "https://tabelog.com/tokyo/A1301/A130101/13001895/",
    });

    const result = await importFromUrlAction(SHORT_URL);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("tabelog_unsupported");
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });

  it.each([
    "https://www.google.com/maps/search/居酒屋",
    "https://www.google.com/search?q=%E5%B0%8E%E6%A5%BD",
  ])("redirect 先が Google だが店舗ページでないなら拒否する: %s", async (finalUrl) => {
    mockedFetchOgp.mockResolvedValueOnce({ ok: true, final_url: finalUrl });

    const result = await importFromUrlAction(SHORT_URL);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("not_place_url");
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });

  /**
   * 「取得そのものに失敗した」と「転送先が店舗ページでない」は原因も次の行動も異なる。
   * 前者で「別の URL を貼り直してください」と案内すると、有効な共有 URL を貼った
   * ユーザーが無限に貼り直す羽目になるため、reason を分ける (PR #211 review)。
   */
  it.each([
    ["タイムアウト", "タイムアウトしました"],
    ["非 2xx", "HTTP 500"],
    ["ネットワーク / DNS 失敗", "指定されたURLへ接続できませんでした"],
  ])(
    "短縮 URL の取得に失敗した場合 (%s) は short_url_resolve_failed として拒否する",
    async (_label, error) => {
      mockedFetchOgp.mockResolvedValueOnce({ ok: false, error });

      const result = await importFromUrlAction(SHORT_URL);

      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBe("short_url_resolve_failed");
      }
      expect(mockedSearchPlaces).not.toHaveBeenCalled();
    },
  );

  it("取得は成功したが redirect しなかった場合は not_place_url のままにする", async () => {
    mockedFetchOgp.mockResolvedValueOnce({ ok: true });

    const result = await importFromUrlAction(SHORT_URL);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("not_place_url");
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });

  it("goo.gl/maps 形式も短縮 URL として受け付ける", async () => {
    mockedFetchOgp.mockResolvedValueOnce({ ok: true, final_url: PLACE_URL });
    mockedSearchPlaces.mockResolvedValueOnce([makePlace()]);

    const result = await importFromUrlAction("https://goo.gl/maps/xyz789");

    expect(mockedFetchOgp).toHaveBeenCalledOnce();
    expect(result.status).toBe("success");
  });

  it("goo.gl の非 Maps パスは受け付けない", async () => {
    const result = await importFromUrlAction("https://goo.gl/abcdef");

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("not_place_url");
    expect(mockedFetchOgp).not.toHaveBeenCalled();
  });

  it("共有 ID 無しの maps.app.goo.gl は redirect 解決の fetch すら行わない", async () => {
    const result = await importFromUrlAction("https://maps.app.goo.gl/");

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("not_place_url");
    expect(mockedFetchOgp).not.toHaveBeenCalled();
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });
});

/**
 * Place ID が URL に含まれる場合の取得経路 (Issue #207 follow-up)。
 *
 * この経路の要点は「**曖昧な Text Search を経由しない**」こと。URL が Place ID を
 * 持っている時点で店舗は確定しているため、店舗名の文字列照合へ落とすと
 * 同名店舗で ambiguous になったり別店舗を引く余地を作ってしまう。
 */
describe("importFromUrlAction — Place ID を含む URL", () => {
  const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  const PLACE_ID_URL = `https://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`;

  it("Place Details を直接引き、Text Search を呼ばない", async () => {
    mockedGetPlaceById.mockResolvedValue(makePlace({ placeId: PLACE_ID }));

    const result = await importFromUrlAction(PLACE_ID_URL);

    expect(result.status).toBe("success");
    expect(mockedGetPlaceById).toHaveBeenCalledExactlyOnceWith(PLACE_ID, {
      timeoutMs: 15_000,
    });
    // 曖昧照合へ落ちていないこと。ここが緩むと別店舗を引く余地が戻る。
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
    // full place URL と同じく、外部 HTML の取得もしない。
    expect(mockedFetchOgp).not.toHaveBeenCalled();
  });

  it("Places の値をフォームへ反映し、Place ID を報告する", async () => {
    mockedGetPlaceById.mockResolvedValue(makePlace({ placeId: PLACE_ID }));

    const result = await importFromUrlAction(PLACE_ID_URL);

    expect(result).toMatchObject({
      status: "success",
      suggested: {
        name: "導楽",
        phone: "044-750-9977",
        prefecture: "神奈川県",
        review_avg: 3.4,
        review_count: 12,
      },
      placesFallback: { used: true, reason: "place_id_url", matched_place_id: PLACE_ID },
    });
  });

  it("query 付き (店名併記) でも Place ID 側で取得する", async () => {
    mockedGetPlaceById.mockResolvedValue(makePlace({ placeId: PLACE_ID }));

    const url = `https://www.google.com/maps/search/?api=1&query=%E5%88%A5%E5%BA%97&query_place_id=${PLACE_ID}`;
    const result = await importFromUrlAction(url);

    expect(result.status).toBe("success");
    expect(mockedGetPlaceById).toHaveBeenCalledExactlyOnceWith(PLACE_ID, {
      timeoutMs: 15_000,
    });
    // URL 上の query 文字列ではなく Places の名前を採用する。
    expect(result.status === "success" && result.suggested.name).toBe("導楽");
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });

  it("URL の `?q=place_id:` 文字列を店舗名として採用しない", async () => {
    mockedGetPlaceById.mockResolvedValue(makePlace({ placeId: PLACE_ID }));

    const result = await importFromUrlAction(
      `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.suggested.name).toBe("導楽");
    expect(result.suggested.name).not.toContain("place_id");
  });

  it("Places API のエラーを UI へ漏らさず place_lookup_failed にする", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedGetPlaceById.mockRejectedValue(
      Object.assign(new Error("PlacesApiError: status 403 SECRET_KEY=abc レスポンス本文"), {
        name: "PlacesApiError",
        status: 403,
      }),
    );

    const result = await importFromUrlAction(PLACE_ID_URL);

    expect(result).toEqual({ status: "rejected", reason: "place_lookup_failed" });
    // reason 以外に raw なエラー情報を載せない。
    expect(JSON.stringify(result)).not.toMatch(/SECRET_KEY|レスポンス本文|403/);
    // サーバログにも message ではなく分類値のみ。
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/SECRET_KEY|レスポンス本文/);
    }
  });

  it("必須フィールドが欠けて取得できない場合も place_lookup_failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedGetPlaceById.mockResolvedValue(null);

    expect(await importFromUrlAction(PLACE_ID_URL)).toEqual({
      status: "rejected",
      reason: "place_lookup_failed",
    });
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });

  it("短縮 URL の展開先が Place ID URL でも読み込める", async () => {
    mockedFetchOgp.mockResolvedValue({ ok: true, final_url: PLACE_ID_URL });
    mockedGetPlaceById.mockResolvedValue(makePlace({ placeId: PLACE_ID }));

    const result = await importFromUrlAction(SHORT_URL);

    expect(result.status).toBe("success");
    expect(mockedGetPlaceById).toHaveBeenCalledExactlyOnceWith(PLACE_ID, {
      timeoutMs: 15_000,
    });
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
    // ユーザーが実際に貼った URL を source として保持する。
    expect(result.status === "success" && result.parsed.source_url).toBe(SHORT_URL);
  });

  it("短縮 URL の展開先が generic な検索 URL なら拒否する", async () => {
    mockedFetchOgp.mockResolvedValue({
      ok: true,
      final_url: "https://www.google.com/maps/search/居酒屋+渋谷",
    });

    expect(await importFromUrlAction(SHORT_URL)).toEqual({
      status: "rejected",
      reason: "not_place_url",
    });
    expect(mockedGetPlaceById).not.toHaveBeenCalled();
  });

  it("短縮 URL の展開先が別ドメインなら Place ID があっても拒否する", async () => {
    mockedFetchOgp.mockResolvedValue({
      ok: true,
      final_url: `https://maps.google.com.evil.example/maps/search/?api=1&query_place_id=${PLACE_ID}`,
    });

    const result = await importFromUrlAction(SHORT_URL);

    expect(result.status).toBe("rejected");
    expect(mockedGetPlaceById).not.toHaveBeenCalled();
  });
});

/**
 * round-trip invariant (PR #285 独立確認の指摘)。
 *
 * Places の `googleMapsUri` は `https://maps.google.com/?cid=<数値>` 形式を返し得るが、
 * CID は URL Import が受け付けない形式。これを `map_url` として保存すると
 * 「保存済みの店舗 URL を貼り直すと `not_place_url`」という自己不整合になる。
 *
 * success で返した `suggested.map_url` は、必ず policy で再び受理されること。
 */
describe("importFromUrlAction — success の map_url は再 import できる", () => {
  const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  const PLACE_ID_URL = `https://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`;
  const CID_URI = "https://maps.google.com/?cid=1234567890";

  it("googleMapsUri が CID 形式でも map_url は受理される URL になる", async () => {
    // 前提: CID URL 単体は URL Import が受け付けない形式であること。
    expect(evaluateUrlImportPolicy(CID_URI)).toEqual({
      ok: false,
      reason: "not_place_url",
    });

    mockedGetPlaceById.mockResolvedValue(
      makePlace({ placeId: PLACE_ID, googleMapsUri: CID_URI }),
    );

    const result = await importFromUrlAction(PLACE_ID_URL);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    // CID 形式をそのまま保存しない。
    expect(result.suggested.map_url).not.toBe(CID_URI);
    // Place ID を保持した公式形式へ正規化される。
    expect(new URL(result.suggested.map_url).searchParams.get("query_place_id"))
      .toBe(PLACE_ID);
    // round-trip invariant 本体。
    expect(evaluateUrlImportPolicy(result.suggested.map_url).ok).toBe(true);
  });

  it("legacy の place_id: 形式でも round-trip する", async () => {
    mockedGetPlaceById.mockResolvedValue(
      makePlace({ placeId: PLACE_ID, googleMapsUri: CID_URI }),
    );

    const url = `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`;
    const result = await importFromUrlAction(url);

    expect(result.status === "success" && evaluateUrlImportPolicy(result.suggested.map_url).ok)
      .toBe(true);
  });

  it("短縮 URL 経由でも展開後の Place ID URL を map_url に保持する", async () => {
    mockedFetchOgp.mockResolvedValue({ ok: true, final_url: PLACE_ID_URL });
    mockedGetPlaceById.mockResolvedValue(
      makePlace({ placeId: PLACE_ID, googleMapsUri: CID_URI }),
    );

    const result = await importFromUrlAction(SHORT_URL);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    // 短縮 URL のままでは再 import しても店舗を特定できないため、
    // 取得結果から組み立てた canonical URL を保持する。
    expect(new URL(result.suggested.map_url).searchParams.get("query_place_id"))
      .toBe(PLACE_ID);
    expect(evaluateUrlImportPolicy(result.suggested.map_url).ok).toBe(true);
  });

  it("googleMapsUri が受理可能な place URL でも round-trip は壊れない", async () => {
    mockedGetPlaceById.mockResolvedValue(
      makePlace({
        placeId: PLACE_ID,
        googleMapsUri: "https://www.google.com/maps/place/%E5%B0%8E%E6%A5%BD",
      }),
    );

    const result = await importFromUrlAction(PLACE_ID_URL);

    expect(result.status === "success" && evaluateUrlImportPolicy(result.suggested.map_url).ok)
      .toBe(true);
  });

  it("既存の place URL 経路の map_url も再 import できる", async () => {
    // Place ID 経路だけでなく、従来経路でも invariant が成り立つことを確認する。
    mockedSearchPlaces.mockResolvedValue([makePlace({ googleMapsUri: CID_URI })]);

    const result = await importFromUrlAction(PLACE_URL);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(evaluateUrlImportPolicy(result.suggested.map_url).ok).toBe(true);
  });
});

/**
 * Place ID import 成功時に返す map_url は、Google Maps URLs の公式 Search 形式へ
 * 正規化する (PR #285 独立レビュー)。入力 URL をそのまま保持するのではなく、
 * 取得した placeId / name から組み立て直す。
 */
describe("importFromUrlAction — success の map_url は公式形式へ正規化される", () => {
  const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  const CID_URI = "https://maps.google.com/?cid=1234567890";
  /** 過去に保存された query 無しの形式 (入力としては受理し続ける)。 */
  const LEGACY_URL = `https://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`;

  function mapUrlParams(result: Awaited<ReturnType<typeof importFromUrlAction>>) {
    if (result.status !== "success") throw new Error("expected success");
    return new URL(result.suggested.map_url).searchParams;
  }

  it("query と query_place_id の両方を持つ URL を返す", async () => {
    mockedGetPlaceById.mockResolvedValue(
      makePlace({ placeId: PLACE_ID, name: "導楽", googleMapsUri: CID_URI }),
    );

    const result = await importFromUrlAction(LEGACY_URL);

    const p = mapUrlParams(result);
    expect(p.get("api")).toBe("1");
    // 公式仕様で必須の query が入る (入力には無かった)。
    expect(p.get("query")).toBe("導楽");
    expect(p.get("query_place_id")).toBe(PLACE_ID);
    // round-trip invariant は維持。
    expect(result.status === "success" && evaluateUrlImportPolicy(result.suggested.map_url).ok)
      .toBe(true);
  });

  it("入力が legacy 形式でも成功し、canonical な形式へ正規化する", async () => {
    mockedGetPlaceById.mockResolvedValue(
      makePlace({ placeId: PLACE_ID, name: "導楽", googleMapsUri: CID_URI }),
    );

    const result = await importFromUrlAction(LEGACY_URL);

    expect(result.status).toBe("success");
    // 入力をそのまま保持していないこと (query が足されている)。
    expect(result.status === "success" && result.suggested.map_url).not.toBe(LEGACY_URL);
  });

  it("短縮 URL 経由でも canonical な公式形式になり、source_url は貼った URL のまま", async () => {
    mockedFetchOgp.mockResolvedValue({ ok: true, final_url: LEGACY_URL });
    mockedGetPlaceById.mockResolvedValue(
      makePlace({ placeId: PLACE_ID, name: "導楽", googleMapsUri: CID_URI }),
    );

    const result = await importFromUrlAction(SHORT_URL);

    const p = mapUrlParams(result);
    expect(p.get("query")).toBe("導楽");
    expect(p.get("query_place_id")).toBe(PLACE_ID);
    // ユーザーが実際に貼った URL は保持する。
    expect(result.status === "success" && result.parsed.source_url).toBe(SHORT_URL);
  });

  it("店舗名に記号が含まれても map_url が壊れず再 import できる", async () => {
    mockedGetPlaceById.mockResolvedValue(
      makePlace({ placeId: PLACE_ID, name: "A&B 食堂 #1", googleMapsUri: CID_URI }),
    );

    const result = await importFromUrlAction(LEGACY_URL);

    const p = mapUrlParams(result);
    expect(p.get("query")).toBe("A&B 食堂 #1");
    expect(p.get("query_place_id")).toBe(PLACE_ID);
    expect(result.status === "success" && evaluateUrlImportPolicy(result.suggested.map_url).ok)
      .toBe(true);
  });
});

/**
 * Place Details に有限 timeout を持たせる (Codex review)。
 * URL Import は Server Action としてユーザーを待たせるため、Places が応答しない
 * ときに無制限に待たない。timeout も UI へは `place_lookup_failed` として出す。
 */
describe("importFromUrlAction — Place Details の timeout", () => {
  const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  const PLACE_ID_URL = `https://www.google.com/maps/search/?api=1&query=x&query_place_id=${PLACE_ID}`;

  it("getPlaceById へ timeoutMs を渡す", async () => {
    mockedGetPlaceById.mockResolvedValue(makePlace({ placeId: PLACE_ID }));

    await importFromUrlAction(PLACE_ID_URL);

    expect(mockedGetPlaceById).toHaveBeenCalledExactlyOnceWith(PLACE_ID, {
      timeoutMs: 15_000,
    });
  });

  it.each([
    { name: "TimeoutError", message: "signal timed out" },
    { name: "AbortError", message: "The operation was aborted" },
  ])("$name でも place_lookup_failed へ正規化する", async ({ name, message }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new Error(`${message} GOOGLE_PLACES_API_KEY=secret-value`);
    error.name = name;
    mockedGetPlaceById.mockRejectedValue(error);

    const result = await importFromUrlAction(PLACE_ID_URL);

    expect(result).toEqual({ status: "rejected", reason: "place_lookup_failed" });
    // raw error / API キーを UI へもログへも漏らさない。
    expect(JSON.stringify(result)).not.toMatch(/secret-value|GOOGLE_PLACES_API_KEY/);
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/secret-value|GOOGLE_PLACES_API_KEY/);
    }
  });
});

/**
 * `share.google` は **対応しない** (PR #285 の実 URL 検証で撤回)。
 *
 * 実測した転送先は Google マップではなく Google 検索結果ページで、最終 URL に
 * Place ID が含まれない (詳細は `url-import-policy.test.ts` の同名 describe)。
 * policy 段階で `unsupported_source` として弾くため、**外部リクエストを 1 回も
 * 発生させない**ことをここで固定する。
 *
 * 以前あった「share.google を mock して /maps/place へ転送させ成功する」テストは、
 * 実サービスで成立しない仮定を対応根拠にしていたため削除した。
 */
describe("importFromUrlAction — share.google は未対応", () => {
  it.each([
    "https://share.google/uV5iEBj8sOdbBJO2v",
    "https://share.google/abc123",
    "https://share.google/",
  ])("unsupported_source で拒否し、外部リクエストを行わない: %s", async (url) => {
    expect(await importFromUrlAction(url)).toEqual({
      status: "rejected",
      reason: "unsupported_source",
    });
    expect(mockedFetchOgp).not.toHaveBeenCalled();
    expect(mockedGetPlaceById).not.toHaveBeenCalled();
    expect(mockedSearchPlaces).not.toHaveBeenCalled();
  });
});
