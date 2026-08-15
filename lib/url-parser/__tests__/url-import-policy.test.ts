/**
 * URL Import policy の単体検証 (Issue #207)。
 *
 * ここが `/stores/new` の URL Import における trust boundary そのものなので、
 * **部分文字列一致では通ってしまう入力**を重点的に固定する。
 */

import { describe, expect, it } from "vitest";
import { evaluateUrlImportPolicy } from "../url-import-policy";

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
    // Places API の googleMapsUri 形式。1 店舗を指すが店舗名を読み取れず、
    // 現行実装では Places 照合の検索語を作れないため受け付けない。
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
