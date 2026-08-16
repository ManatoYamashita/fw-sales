/**
 * `/stores/new` の URL Import で受け付けてよい URL かを判定する policy (Issue #207)。
 *
 * ## なぜ独立モジュールなのか
 *
 * `parseStoreUrl` は「与えられた URL から何を読み取れるか」を担う汎用パーサで、
 * 食べログ / Instagram / unknown も返す。一方この policy が担うのは
 * **「この導線でその URL を受け付けてよいか」という product boundary** だけで、
 * 責務が異なる。混ぜると「パーサが対応している = UI が受け付ける」になり、
 * 実際 Issue #207 ではそれが原因で以下の 2 つの事故が起きた。
 *
 * 1. `tabelog.com` を Vercel から取得 → Cloudflare が **HTTP 403 + challenge HTML**
 *    (`<title>Just a moment...</title>`) を返し、店舗名が空のまま登録画面へ進む
 * 2. Google 検索結果ページ (`google.com/search?q=...`) を貼ると `unknown` として
 *    OGP を取得し、`<title>Google Search</title>` が **店舗名** として採用される
 *
 * ## 決定した product boundary
 *
 * この導線が受け付けるのは **Google マップの店舗ページ URL と、その短縮共有 URL のみ**。
 * 食べログの Cloudflare を回避する実装は行わない(#207 の対応方針)。
 *
 * ## trust boundary 上の注意
 *
 * 判定に `url.includes("google.com/maps")` のような部分文字列一致は使わない。
 * `new URL()` で parse し **hostname と pathname** で判定する。
 * これを守らないと以下が Google マップとして通ってしまう:
 *
 * - `https://evil.example/?next=https://www.google.com/maps/place/foo` (クエリに含むだけ)
 * - `https://maps.google.com.evil.example/maps/place/foo` (lookalike ドメイン)
 * - `https://evil-google.com/maps/place/foo` (apex 違い)
 *
 * `*.google.*` の全許可もしない(Google が持つ無関係なサービスまで通るため)。
 *
 * ## `parseStoreUrl` との関係
 *
 * `parseStoreUrl`(`lib/url-parser/index.ts`)は `includes` によるソース分類を行う
 * 汎用ディスパッチャで、判定基準が本モジュールと異なる(例: `google.co.jp/maps/place/…`
 * を `unknown` に落とす)。**受付可否の source of truth は本モジュールのみ**であり、
 * 通過後の解析は `parseGoogleMapsUrl` を直接呼ぶこと。両者を直列に使うと
 * 「policy は受理したのにパーサ分類で拒否される」という drift が生じる。
 *
 * 純関数。ネットワーク・DB・環境変数に依存しない。
 */

/** 受け付けた URL の種別。 */
export type UrlImportKind =
  /** `…/maps/place/<name>` 形式。パーサが直接 name を読み取れる。 */
  | "google_maps_place"
  /** `maps.app.goo.gl` / `goo.gl/maps` の短縮共有 URL。redirect 解決が必要。 */
  | "google_maps_short";

/**
 * **この純関数だけで判定できる**拒否理由。URL 文字列を見れば決まるものに限る。
 * UI 文言はこの値から呼び出し側が決める(本モジュールは文言を持たない)。
 */
export type UrlImportPolicyRejectReason =
  /** URL として parse できない / `https:` でない / 非標準ポート / credentials 付き。 */
  | "invalid_url"
  /** 食べログ。Cloudflare bot challenge により本番で取得できないため非対応。 */
  | "tabelog_unsupported"
  /** Google マップ以外のサイト(Instagram・一般 Web ページ等)。 */
  | "unsupported_source"
  /** Google のドメインだが店舗ページではない(検索結果・経路案内・トップページ等)。 */
  | "not_place_url";

/**
 * URL Import 全体の拒否理由。policy 判定の結果に加え、
 * **policy 通過後の実行時に初めて分かる失敗**を含む。
 *
 * `short_url_resolve_failed` を `not_place_url` に混ぜないこと。前者は
 * 「もう一度試せば通るかもしれない」、後者は「別の URL を貼る必要がある」で
 * ユーザーが取るべき行動が正反対になる (PR #211 review)。
 */
export type UrlImportRejectReason =
  | UrlImportPolicyRejectReason
  /**
   * 短縮共有 URL の redirect 解決そのものに失敗した
   * (timeout / DNS 解決失敗 / network error / 非 2xx 応答)。
   * 転送先が店舗ページだったかどうかは**判定できていない**。
   */
  | "short_url_resolve_failed";

export type UrlImportPolicyResult =
  | { ok: true; kind: UrlImportKind; url: string }
  | { ok: false; reason: UrlImportPolicyRejectReason };

/**
 * Google マップの店舗 URL を提供するホスト名の allowlist。
 *
 * ccTLD は無限にあるため全許可はせず、**このプロダクトで実際に使う `.com` と `.co.jp`
 * のみ**を明示列挙する。増やす場合はここへ 1 件ずつ追加する
 * (`*.google.*` のようなワイルドカードにはしない)。
 */
const MAPS_HOSTS: ReadonlySet<string> = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "google.co.jp",
  "www.google.co.jp",
  "maps.google.co.jp",
]);

/** 短縮共有 URL のホスト名。`goo.gl` は `/maps/` 配下のみ許可する(下記参照)。 */
const SHORT_HOST_MAPS_APP = "maps.app.goo.gl";
const SHORT_HOST_GOO_GL = "goo.gl";

/** 食べログの apex ドメイン。サブドメインも同一サイトとして扱う。 */
const TABELOG_APEX = "tabelog.com";

/**
 * hostname を比較用に正規化する。
 * - 小文字化(hostname は本来小文字だが、明示しておく)
 * - 末尾ドット(FQDN 表記 `example.com.`)の除去
 */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/** apex 一致 / サブドメイン一致のみ true。`evil-tabelog.com` や `tabelog.com.evil.test` は false。 */
function isHostOrSubdomainOf(host: string, apex: string): boolean {
  return host === apex || host.endsWith(`.${apex}`);
}

/** pathname を空要素なしのセグメント配列にする。`/maps/place/foo/` → `["maps","place","foo"]` */
function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter((s) => s !== "");
}

/**
 * `…/maps/place/<something>` 形式かどうか。
 *
 * `<something>` の中身(実際に店舗名を読み取れるか)は判定しない。
 * `data=!4m…` のようにパーサが name を取れない形もありうるが、それは
 * 「店舗ページを指してはいる」ため policy では通し、name 欠落は後段の
 * 「店舗名を読み取れませんでした」経路で扱う(責務を分ける)。
 */
function isPlacePath(pathname: string): boolean {
  const segs = pathSegments(pathname);
  return segs[0] === "maps" && segs[1] === "place" && (segs[2] ?? "") !== "";
}

/**
 * URL Import で受け付けてよい URL かを判定する。
 *
 * @param raw ユーザーが貼り付けた文字列(前後の空白は許容する)
 */
export function evaluateUrlImportPolicy(raw: string): UrlImportPolicyResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, reason: "invalid_url" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  // **HTTPS のみ。** `javascript:` / `data:` / `file:` はもちろん `http:` も受け付けない。
  //
  // 理由:
  // - 短縮 URL は redirect 解決のために実際に外部 fetch を行うため、平文への降格を避ける。
  // - Google マップは実運用上 https のみで、ブラウザのアドレスバーから http URL が
  //   得られることはない。
  // - 唯一の互換性懸念だった `goo.gl` 短縮リンクは Google 自身が新規発行を終了しており、
  //   古い `http://goo.gl/maps/...` を救う価値は小さい。
  //
  // trade-off: 古い http リンクを貼ったユーザーは `invalid_url`
  // (「URLの形式を確認してください。」)になる。ブラウザから貼り直せば解決する。
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid_url" };
  }
  // `https://user:pass@host/` 形式は受け付けない(意図しない資格情報の混入を避ける)。
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "invalid_url" };
  }
  // **非標準ポートを受け付けない。**
  //
  // `URL.hostname` はポートを含まないため、hostname だけで判定すると
  // `https://www.google.com:444/maps/place/foo` が allowlist を通過してしまう。
  // 短縮 URL はその後 fetch するため、任意ポートへの接続を許すことになる。
  // Google マップの店舗 URL が非標準ポートを持つことはないので一律で拒否する。
  //
  // `URL` は既定ポート(https の 443)を正規化して `port === ""` にするため、
  // `https://host:443/...` は通り、`https://host:444/...` だけが弾かれる。
  if (parsed.port !== "") {
    return { ok: false, reason: "invalid_url" };
  }

  const host = normalizeHost(parsed.hostname);

  // 食べログは「未対応」であることを明示したいので、汎用の unsupported_source より先に判定する。
  if (isHostOrSubdomainOf(host, TABELOG_APEX)) {
    return { ok: false, reason: "tabelog_unsupported" };
  }

  // 短縮共有 URL。展開後の最終 URL は呼び出し側が **もう一度この policy へ通す**こと
  // (short link → 無関係なサイトへの redirect を店舗 URL として採用しないため)。
  if (host === SHORT_HOST_MAPS_APP) {
    // 共有 ID(`/abc123`)を必ず要求する。hostname 一致だけで通すと
    // `https://maps.app.goo.gl/` のような ID 無し URL でも policy を通過し、
    // 店舗を特定できないと分かっているのに redirect 解決の外部 fetch が発生する。
    const segs = pathSegments(parsed.pathname);
    if ((segs[0] ?? "") !== "") {
      return { ok: true, kind: "google_maps_short", url: trimmed };
    }
    return { ok: false, reason: "not_place_url" };
  }
  if (host === SHORT_HOST_GOO_GL) {
    // `goo.gl` は Google の汎用短縮ドメインで Maps 以外にも使われるため、
    // `/maps/<id>` 配下のみ許可する。
    const segs = pathSegments(parsed.pathname);
    if (segs[0] === "maps" && (segs[1] ?? "") !== "") {
      return { ok: true, kind: "google_maps_short", url: trimmed };
    }
    return { ok: false, reason: "not_place_url" };
  }

  if (MAPS_HOSTS.has(host)) {
    if (isPlacePath(parsed.pathname)) {
      return { ok: true, kind: "google_maps_place", url: trimmed };
    }
    // `/search`(Google 検索)・`/maps`(トップ)・`/maps/search`・`/maps/dir` 等。
    // 「Google の URL」ではなく「Google マップの**店舗**URL」だけを受け付ける。
    return { ok: false, reason: "not_place_url" };
  }

  return { ok: false, reason: "unsupported_source" };
}
