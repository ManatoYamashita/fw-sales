/**
 * trust-critical な URL 正規化(feat/ai-research-quality-ux-hardening、Plan §8.2.1)。
 *
 * 依存ゼロの純関数モジュール。2つの用途で使う:
 *
 * 1. `applyUrlContextStatus` の突合キー。Gemini が返す `retrievedUrl` と
 *    Source Registry の `grounding_redirect_url` を**文字列完全一致**で照合していたため、
 *    末尾スラッシュ差などで `url_context_status: "success"` を取りこぼしていた(Q6)。
 * 2. official alias 判定の厳格一致。resolver が辿った最終URLと
 *    `stores.site_url` / `instagram_url` を突き合わせ、**同一ページであることを
 *    コード側で決定的に確認できた場合のみ** Source Registry を統合する(Q5)。
 *
 * ## 用途 2 があるため false positive より false negative を優先する
 *
 * 「同じサイトっぽい」正規化を入れると、trust boundary を実質的に緩めてしまう。
 * 以下の変換は**意図的に行わない**:
 *
 * - `www.` の自動除去 — `www.example.com` と `example.com` は別ホストでありうる
 * - origin-only match — `https://x/a` と `https://x/b` は別リソース
 * - query の破棄 — `?shop=1` のような識別子を落とすと別店舗ページと衝突しうる
 * - root 以外の末尾スラッシュ除去 — `/a/` と `/a` を別リソースとして扱うサイトがある
 *
 * 許可するのは「同一リソースであることが仕様上保証される」変換のみ:
 * scheme/hostname の case、fragment 除去、default port、root の末尾スラッシュ。
 */

/** 正規化を許可する scheme。ダウングレード(https→http)を同一視しないため両方を保持する。 */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const DEFAULT_PORT_BY_SCHEME: Record<string, string> = {
  "http:": "80",
  "https:": "443",
};

/**
 * 突合・厳格一致に使う正規化済み文字列を返す。
 * 解釈できない場合・http(s) 以外の場合は `null`(**誤って一致させない**)。
 */
export function normalizeUrlForMatch(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const scheme = parsed.protocol.toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme)) return null;

  const host = parsed.hostname.toLowerCase();
  if (host === "") return null;

  // default port は URL 側で既に除去されるが、明示指定された場合に備えて畳む。
  const port = parsed.port === DEFAULT_PORT_BY_SCHEME[scheme] ? "" : parsed.port;
  const authority = port === "" ? host : `${host}:${port}`;

  // root(`/` または空)のみ末尾スラッシュを畳む。それ以外の path はそのまま。
  const path = parsed.pathname === "" || parsed.pathname === "/" ? "" : parsed.pathname;

  // fragment は除去。query は**保持**する。
  return `${scheme}//${authority}${path}${parsed.search}`;
}

/**
 * 2つのURLが正規化後に**完全一致**するかを返す(alias 判定用)。
 * どちらかが解釈できない場合は `false`(安全側)。
 */
export function isStrictSameUrl(a: string, b: string): boolean {
  const normalizedA = normalizeUrlForMatch(a);
  if (normalizedA === null) return false;
  const normalizedB = normalizeUrlForMatch(b);
  if (normalizedB === null) return false;
  return normalizedA === normalizedB;
}
