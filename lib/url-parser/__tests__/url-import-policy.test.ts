/**
 * URL Import policy の単体検証 (Issue #207)。
 *
 * ここが `/stores/new` の URL Import における trust boundary そのものなので、
 * **部分文字列一致では通ってしまう入力**を重点的に固定する。
 */

import { describe, expect, it } from "vitest";
import { evaluateUrlImportPolicy } from "../url-import-policy";
import { buildPlaceIdMapsUrl } from "@/lib/places/maps-url";
import { placeResultToStoreInput } from "@/lib/places/to-store-input";

describe("evaluateUrlImportPolicy — 受け付ける URL", () => {
  it.each([
    "https://www.google.com/maps/place/導楽",
    "https://google.com/maps/place/導楽",
    "https://maps.google.com/maps/place/導楽",
    "https://www.google.co.jp/maps/place/導楽",
    "https://maps.google.co.jp/maps/place/導楽",
    // 既定ポートは `URL` が正規化して `port === ""` になるため通る。
    "https://www.google.com:443/maps/place/導楽",
    // 実際の共有 URL(座標・data パラメータ付き)
    "https://www.google.com/maps/place/neel%E4%B8%AD%E7%9B%AE%E9%BB%92/@35.6474266,139.6929246,16z/data=!3m1!4b1?entry=ttu",
    // 末尾スラッシュ
    "https://www.google.com/maps/place/導楽/",
  ])("place URL を google_maps_place として受け付ける: %s", (url) => {
    const result = evaluateUrlImportPolicy(url);
    expect(result).toEqual({ ok: true, kind: "google_maps_place", url });
  });

  it.each([
    "https://maps.app.goo.gl/abc123",
    "https://maps.app.goo.gl/abc123?g_st=ic",
    "https://goo.gl/maps/xyz789",
  ])("短縮共有 URL を google_maps_short として受け付ける: %s", (url) => {
    const result = evaluateUrlImportPolicy(url);
    expect(result).toEqual({ ok: true, kind: "google_maps_short", url });
  });

  it("前後の空白を許容する", () => {
    const result = evaluateUrlImportPolicy("  https://www.google.com/maps/place/導楽  ");
    expect(result.ok).toBe(true);
  });

  it("hostname の大文字表記を正規化して受け付ける", () => {
    const result = evaluateUrlImportPolicy("https://WWW.GOOGLE.COM/maps/place/導楽");
    expect(result.ok).toBe(true);
  });
});

describe("evaluateUrlImportPolicy — 食べログ", () => {
  it.each([
    "https://tabelog.com/tokyo/A1301/A130101/13001895/",
    "https://www.tabelog.com/tokyo/A1301/A130101/13001895/",
    "https://s.tabelog.com/tokyo/A1301/A130101/13001895/",
  ])("tabelog_unsupported として拒否する: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: false,
      reason: "tabelog_unsupported",
    });
  });

  it("lookalike な食べログ風ドメインは tabelog 扱いしない(汎用の未対応として扱う)", () => {
    expect(evaluateUrlImportPolicy("https://evil-tabelog.com/x")).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
    expect(evaluateUrlImportPolicy("https://tabelog.com.evil.example/x")).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
  });
});

describe("evaluateUrlImportPolicy — Google だが店舗ページでない", () => {
  it.each([
    "https://www.google.com/search?q=%E5%B0%8E%E6%A5%BD",
    "https://www.google.com/",
    "https://www.google.com/maps",
    "https://www.google.com/maps/",
    "https://www.google.com/maps/place",
    "https://www.google.com/maps/place/",
    "https://www.google.com/maps/search/居酒屋+新丸子",
    "https://www.google.com/maps/dir/A/B",
    "https://www.google.com/maps?q=導楽+新丸子",
    "https://maps.google.com/?q=test",
    // Places API の googleMapsUri 形式。1 店舗を指してはいるが、CID は Place ID とは
    // 別体系の識別子で、現行の Places API コードに CID → Place ID の変換経路が無い。
    // 「1 店舗を指す」ことと「この実装で一意に解決できる」ことは別なので受け付けない。
    "https://maps.google.com/?cid=123",
  ])("not_place_url として拒否する: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason: "not_place_url" });
  });

  it("goo.gl の非 Maps パスは not_place_url", () => {
    expect(evaluateUrlImportPolicy("https://goo.gl/abcdef")).toEqual({
      ok: false,
      reason: "not_place_url",
    });
    expect(evaluateUrlImportPolicy("https://goo.gl/maps")).toEqual({
      ok: false,
      reason: "not_place_url",
    });
  });

  /**
   * `maps.app.goo.gl` を hostname 一致だけで通すと、共有 ID の無い URL でも
   * policy を通過し、店舗を特定できないと分かっているのに redirect 解決の
   * 外部 fetch が発生してしまう。共有 ID を必須にする。
   */
  it.each([
    "https://maps.app.goo.gl/",
    "https://maps.app.goo.gl",
    "https://maps.app.goo.gl/?g_st=ipc",
  ])("maps.app.goo.gl の共有 ID 無しは not_place_url: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason: "not_place_url" });
  });

  it("maps.app.goo.gl は共有 ID があれば受け付ける(クエリ付きも可)", () => {
    expect(evaluateUrlImportPolicy("https://maps.app.goo.gl/abc123")).toEqual({
      ok: true,
      kind: "google_maps_short",
      url: "https://maps.app.goo.gl/abc123",
    });
    expect(evaluateUrlImportPolicy("https://maps.app.goo.gl/abc123?g_st=ipc")).toEqual({
      ok: true,
      kind: "google_maps_short",
      url: "https://maps.app.goo.gl/abc123?g_st=ipc",
    });
  });
});

describe("evaluateUrlImportPolicy — 部分文字列一致で通ってはいけない入力", () => {
  it("クエリに Google マップ URL を含む別ドメインを拒否する", () => {
    expect(
      evaluateUrlImportPolicy("https://evil.example/?next=https://www.google.com/maps/place/foo"),
    ).toEqual({ ok: false, reason: "unsupported_source" });
  });

  it("lookalike ドメインを拒否する", () => {
    expect(
      evaluateUrlImportPolicy("https://maps.google.com.evil.example/maps/place/foo"),
    ).toEqual({ ok: false, reason: "unsupported_source" });
    expect(evaluateUrlImportPolicy("https://evil-google.com/maps/place/foo")).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
    expect(evaluateUrlImportPolicy("https://googlecom/maps/place/foo")).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
  });

  it("パスに google.com/maps を含む別ドメインを拒否する", () => {
    expect(
      evaluateUrlImportPolicy("https://evil.example/www.google.com/maps/place/foo"),
    ).toEqual({ ok: false, reason: "unsupported_source" });
  });

  it("`*.google.*` の全許可になっていない(Google の別サービスは受け付けない)", () => {
    expect(evaluateUrlImportPolicy("https://drive.google.com/maps/place/foo")).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
    expect(evaluateUrlImportPolicy("https://www.google.de/maps/place/foo")).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
  });
});

describe("evaluateUrlImportPolicy — 不正な URL", () => {
  it.each([
    "",
    "   ",
    "not a url",
    "www.google.com/maps/place/foo", // scheme 無し
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
  ])("invalid_url として拒否する: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("credentials 付き URL を拒否する", () => {
    expect(
      evaluateUrlImportPolicy("https://user:pass@www.google.com/maps/place/foo"),
    ).toEqual({ ok: false, reason: "invalid_url" });
  });

  /**
   * `URL.hostname` はポートを含まないため、hostname だけで allowlist 判定すると
   * 任意ポートが通ってしまう。短縮 URL は redirect 解決で実際に fetch するため、
   * ここを抜けると任意ポートへの接続を許すことになる。
   */
  it.each([
    "https://www.google.com:444/maps/place/導楽",
    "https://maps.google.com:8080/maps/place/導楽",
    "https://maps.app.goo.gl:444/abc123",
    "https://goo.gl:444/maps/xyz789",
  ])("非標準ポートを拒否する: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason: "invalid_url" });
  });

  /**
   * HTTPS のみ。短縮 URL は外部 fetch を伴うため平文への降格を許さない。
   * 古い `http://goo.gl/maps/...` は貼り直しが必要になるが、goo.gl 自体が
   * 新規発行を終了しているため互換性の価値は小さいと判断した。
   */
  it.each([
    "http://www.google.com/maps/place/導楽",
    "http://maps.google.com/maps/place/導楽",
    "http://maps.app.goo.gl/abc123",
    "http://goo.gl/maps/xyz789",
  ])("http を拒否する (HTTPS-only): %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason: "invalid_url" });
  });
});

describe("evaluateUrlImportPolicy — allowlist の内容そのものを固定する", () => {
  /**
   * typo や意図しないホストが allowlist へ紛れ込んでいないことを、
   * 「通るホスト」「通らないホスト」の両方から固定する。
   */
  it("受け付けるのは 6 ホスト + 短縮 2 ホストのみ", () => {
    const allowedPlaceHosts = [
      "google.com",
      "www.google.com",
      "maps.google.com",
      "google.co.jp",
      "www.google.co.jp",
      "maps.google.co.jp",
    ];
    for (const host of allowedPlaceHosts) {
      expect(evaluateUrlImportPolicy(`https://${host}/maps/place/導楽`)).toEqual({
        ok: true,
        kind: "google_maps_place",
        url: `https://${host}/maps/place/導楽`,
      });
    }

    const rejectedHosts = [
      "google.cs.google.co.jp",
      "google.co.jp.evil.example",
      "maps.google.com.evil.example",
      "www.google.de",
      "www.google.co.uk",
      "drive.google.com",
      "mail.google.com",
      "goo.gl.evil.example",
      "maps.app.goo.gl.evil.example",
    ];
    for (const host of rejectedHosts) {
      expect(evaluateUrlImportPolicy(`https://${host}/maps/place/導楽`).ok).toBe(false);
    }
  });
});

describe("evaluateUrlImportPolicy — その他のサイト", () => {
  it.each([
    "https://www.instagram.com/example/",
    "https://example.com/foo",
    "https://www.hotpepper.jp/strJ001/",
    "https://retty.me/area/PRE14/",
  ])("unsupported_source として拒否する: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
  });
});

/**
 * Place ID を明示する Maps URL の受付 (Issue #207 follow-up)。
 *
 * これらは 1 店舗を **ID で** 一意特定できるため、店舗名の曖昧照合を経ずに
 * Place Details を直接引ける。`/maps/place/<名前>` より強い identity なので、
 * 両方を満たす URL では Place ID 側を採用する。
 */
describe("evaluateUrlImportPolicy — Place ID を明示する URL", () => {
  const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

  it.each([
    `https://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`,
    `https://www.google.com/maps/search/?api=1&query=%E5%B0%8E%E6%A5%BD&query_place_id=${PLACE_ID}`,
    `https://www.google.co.jp/maps/search/?api=1&query_place_id=${PLACE_ID}`,
    `https://maps.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`,
    `https://www.google.com/maps/search/?query_place_id=${PLACE_ID}&api=1`,
    `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
  ])("query_place_id / place_id: を google_maps_place_id として受け付ける: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: true,
      kind: "google_maps_place_id",
      url,
      placeId: PLACE_ID,
    });
  });

  it("place URL と Place ID を両方満たす場合は Place ID を優先する", () => {
    const url = `https://www.google.com/maps/place/%E5%B0%8E%E6%A5%BD/?query_place_id=${PLACE_ID}`;
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: true,
      kind: "google_maps_place_id",
      url,
      placeId: PLACE_ID,
    });
  });

  it.each([
    "https://www.google.com/maps/search/?api=1&query=%E5%B1%85%E9%85%92%E5%B1%8B+%E6%B8%8B%E8%B0%B7",
    "https://www.google.com/maps/search/居酒屋+渋谷",
    "https://www.google.com/maps?q=居酒屋",
    "https://www.google.com/maps/search/?q=居酒屋+渋谷",
  ])("Place ID を持たない検索 URL は not_place_url のまま: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason: "not_place_url" });
  });

  it.each([
    "https://www.google.com/maps/search/?api=1&query_place_id=",
    "https://www.google.com/maps/search/?api=1&query_place_id=%20",
    "https://www.google.com/maps/place/?q=place_id:",
    "https://www.google.com/maps/search/?api=1&query_place_id=ChIJ%20abc",
    "https://www.google.com/maps/search/?api=1&query_place_id=ChIJ%0Aabc",
  ])("不正な Place ID は受け付けない: %s", (url) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason: "not_place_url" });
  });

  it.each([
    `https://www.google.com/search?q=place_id:${PLACE_ID}`,
    `https://www.google.com/search?query_place_id=${PLACE_ID}`,
    `https://www.google.com/?query_place_id=${PLACE_ID}`,
    `https://maps.google.com/?query_place_id=${PLACE_ID}`,
  ])("Google マップ配下でない URL からは Place ID を読まない: %s", (url) => {
    expect(evaluateUrlImportPolicy(url).ok).toBe(false);
  });

  it("lookalike ホスト上の Place ID URL は受け付けない", () => {
    for (const host of [
      "maps.google.com.evil.example",
      "www.google.com.evil.example",
      "evil-google.com",
      "google.de",
    ]) {
      expect(
        evaluateUrlImportPolicy(
          `https://${host}/maps/search/?api=1&query_place_id=${PLACE_ID}`,
        ).ok,
      ).toBe(false);
    }
  });

  it("クエリに Place ID URL を含むだけの別ドメインは受け付けない", () => {
    const url = `https://evil.example/?next=https://www.google.com/maps/search/%3Fapi%3D1%26query_place_id%3D${PLACE_ID}`;
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: false,
      reason: "unsupported_source",
    });
  });

  it("http / 非標準ポート / credentials は Place ID URL でも拒否する", () => {
    expect(
      evaluateUrlImportPolicy(
        `http://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`,
      ),
    ).toEqual({ ok: false, reason: "invalid_url" });
    expect(
      evaluateUrlImportPolicy(
        `https://www.google.com:444/maps/search/?api=1&query_place_id=${PLACE_ID}`,
      ),
    ).toEqual({ ok: false, reason: "invalid_url" });
    expect(
      evaluateUrlImportPolicy(
        `https://u:p@www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`,
      ),
    ).toEqual({ ok: false, reason: "invalid_url" });
  });
});

/**
 * repo 自身が生成する Google マップ URL を、URL Import が受け付けられること。
 *
 * `placeResultToStoreInput` は `googleMapsUri` を持たない Place に対し
 * `buildPlaceIdMapsUrl` の URL を `stores.map_url` として保存する。
 * ユーザーはその URL をコピーして URL Import へ貼り直しうるため、
 * 「repo が生成した URL を repo が拒否する」不整合を回帰テストで塞ぐ。
 */
describe("evaluateUrlImportPolicy — repo 自身が生成する map_url の round-trip", () => {
  const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

  it("buildPlaceIdMapsUrl の出力を受け付ける", () => {
    const url = buildPlaceIdMapsUrl(PLACE_ID, "導楽 新丸子");
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: true,
      kind: "google_maps_place_id",
      url,
      placeId: PLACE_ID,
    });
  });

  /**
   * 過去に保存された `query` 無しの形式も入力としては受理し続ける
   * (backward compatibility)。「今後生成する URL は公式形式」と
   * 「過去形式を読み込める」は別の話として扱う。
   */
  it("過去に生成した query 無しの形式も引き続き受理する", () => {
    const legacy = `https://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`;
    expect(evaluateUrlImportPolicy(legacy)).toEqual({
      ok: true,
      kind: "google_maps_place_id",
      url: legacy,
      placeId: PLACE_ID,
    });
  });

  it("placeResultToStoreInput の map_url が URL Import を通る", () => {
    const input = placeResultToStoreInput({
      placeId: PLACE_ID,
      name: "導楽",
      formattedAddress: "日本、〒211-0005 神奈川県川崎市中原区新丸子東1-983",
      lat: 35.5,
      lng: 139.6,
      phone: "044-750-9977",
      rating: 3.4,
      userRatingsTotal: 12,
      types: ["restaurant"],
      // `toPlaceResult` は googleMapsUri を取得できないとき null にする。
      // この場合だけ `buildPlaceIdMapsUrl` の fallback URL が map_url になる。
      googleMapsUri: null,
    });

    expect(evaluateUrlImportPolicy(input.map_url)).toMatchObject({
      ok: true,
      kind: "google_maps_place_id",
      placeId: PLACE_ID,
    });
  });
});

/**
 * 実在する Google マップ URL 形式の corpus と期待結果。
 * 形式ごとの扱いを 1 箇所で読めるようにし、将来の変更で
 * 「どれが通ってどれが通らないか」が暗黙に変わらないよう固定する。
 */
describe("evaluateUrlImportPolicy — URL 形式 corpus", () => {
  const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

  it.each([
    {
      label: "desktop の店舗ページ URL",
      url: "https://www.google.com/maps/place/neel%E4%B8%AD%E7%9B%AE%E9%BB%92/@35.6474266,139.6929246,16z/data=!3m1!4b1?entry=ttu",
      expected: "google_maps_place",
    },
    {
      label: "モバイル共有の短縮 URL",
      url: "https://maps.app.goo.gl/abc123",
      expected: "google_maps_short",
    },
    {
      label: "legacy 短縮 URL",
      url: "https://goo.gl/maps/xyz789",
      expected: "google_maps_short",
    },
    {
      label: "Maps URL API の query_place_id 形式",
      url: `https://www.google.com/maps/search/?api=1&query=%E5%B0%8E%E6%A5%BD&query_place_id=${PLACE_ID}`,
      expected: "google_maps_place_id",
    },
    {
      label: "repo 自身が生成する fallback URL",
      url: `https://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}`,
      expected: "google_maps_place_id",
    },
    {
      label: "legacy の place_id: 形式",
      url: `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
      expected: "google_maps_place_id",
    },
  ])("受け付ける: $label", ({ url, expected }) => {
    const result = evaluateUrlImportPolicy(url);
    expect(result.ok).toBe(true);
    expect(result.ok && result.kind).toBe(expected);
  });

  it.each([
    {
      label: "generic な検索結果 URL",
      url: "https://www.google.com/maps/search/居酒屋+渋谷",
      reason: "not_place_url",
    },
    {
      label: "経路案内 URL",
      url: "https://www.google.com/maps/dir/A/B",
      reason: "not_place_url",
    },
    {
      label: "cid 形式 (Place ID とは別体系のため今回は未対応)",
      url: "https://maps.google.com/?cid=1234567890",
      reason: "not_place_url",
    },
    {
      label: "Maps トップ",
      url: "https://www.google.com/maps",
      reason: "not_place_url",
    },
    {
      label: "Google 検索結果",
      url: "https://www.google.com/search?q=%E5%B0%8E%E6%A5%BD",
      reason: "not_place_url",
    },
  ])("拒否する: $label", ({ url, reason }) => {
    expect(evaluateUrlImportPolicy(url)).toEqual({ ok: false, reason });
  });
});

describe("evaluateUrlImportPolicy — Place ID 抽出の境界", () => {
  it("Place ID が不正でも place URL としての受付は壊さない", () => {
    // `query_place_id` が壊れていても `/maps/place/<名前>` は依然として
    // 店舗ページなので、従来どおり google_maps_place として受け付ける。
    const url = "https://www.google.com/maps/place/%E5%B0%8E%E6%A5%BD?query_place_id=";
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: true,
      kind: "google_maps_place",
      url,
    });
  });

  it("query だけで query_place_id が無い Maps URL API 形式は受け付けない", () => {
    // `query` は表示用のヒントでしかなく、1 店舗を確定しない。
    expect(
      evaluateUrlImportPolicy(
        "https://www.google.com/maps/search/?api=1&query=%E5%B0%8E%E6%A5%BD",
      ),
    ).toEqual({ ok: false, reason: "not_place_url" });
  });

  it("同名パラメータが複数あっても先頭の検証済み値だけを使う", () => {
    const url =
      "https://www.google.com/maps/search/?api=1&query_place_id=ChIJvalid&query_place_id=ChIJother";
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: true,
      kind: "google_maps_place_id",
      url,
      placeId: "ChIJvalid",
    });
  });
});

/**
 * Place ID は「テキスト識別子」であり、Google は**最大長を規定していない**
 * (公式ドキュメントに "there is no maximum length" と明記)。
 * 独自の最大長や文字集合を validity 条件にすると、仕様上正しい ID を将来弾く。
 *
 * 安全性は allowlist ホスト / `/maps/…` 配下 / 明示形式 / URL parser /
 * `encodeURIComponent` の層で確保されているため、ここでは形式を推測しない。
 */
describe("evaluateUrlImportPolicy — Place ID に独自の形式制約を置かない", () => {
  it("長い Place ID を長さだけを理由に拒否しない", () => {
    const longId = `ChIJ${"a".repeat(600)}`;
    const url = `https://www.google.com/maps/search/?api=1&query_place_id=${longId}`;
    expect(evaluateUrlImportPolicy(url)).toEqual({
      ok: true,
      kind: "google_maps_place_id",
      url,
      placeId: longId,
    });
  });

  it("URL-safe base64 以外の文字を含んでも、それだけでは拒否しない", () => {
    // 解決できない ID は Places API 側が失敗を返し `place_lookup_failed` になる。
    // policy が Google 非公式の内部形式を仮定して弾くことはしない。
    const url = "https://www.google.com/maps/search/?api=1&query_place_id=ChIJ%2Ffoo%3Dbar";
    expect(evaluateUrlImportPolicy(url)).toMatchObject({
      ok: true,
      kind: "google_maps_place_id",
      placeId: "ChIJ/foo=bar",
    });
  });

  it("クエリ全体を Place ID として採用しない", () => {
    // 値の取り出しは URLSearchParams が行うため、他パラメータは混入しない。
    const url =
      "https://www.google.com/maps/search/?api=1&query_place_id=ChIJabc&foo=bar&query=x";
    expect(evaluateUrlImportPolicy(url)).toMatchObject({
      ok: true,
      kind: "google_maps_place_id",
      placeId: "ChIJabc",
    });
  });
});
