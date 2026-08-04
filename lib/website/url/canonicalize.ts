/**
 * URL canonicalization(Plan v1.1 §5.2）。pure function。
 *
 * これは security fetch 判定ではない。SSRF 対策は PR #199 で追加予定の `safeFetchHtml`
 * (`lib/security/safe-http-fetch.ts`。**本 PR の時点では未存在**、#199 merge 後に利用予定)の
 * 責務であり、本関数はその代替にならない。portal filter(`./portal.ts`)の代替にもならない。
 */

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_EXACT = new Set(["gclid", "fbclid", "yclid", "_ga", "mc_cid", "mc_eid"]);

export type CanonicalizeFailureReason = "invalid_url" | "disallowed_scheme" | "credentials_in_url";

export type CanonicalizeResult =
  | { ok: true; url: string }
  | { ok: false; reason: CanonicalizeFailureReason };

/**
 * 決定的に URL を正規化する:
 * 1. `new URL()` でパース(失敗 → invalid_url)
 * 2. scheme が http/https 以外 → disallowed_scheme
 * 3. credentials(user:pass@host) → credentials_in_url
 * 4. hostname lowercase(WHATWG URL が既に行うが明示）
 * 5. 既定ポート(:80 / :443)除去
 * 6. hash 除去
 * 7. tracking param(`utm_*` / `gclid` / `fbclid` / `yclid` / `_ga` / `mc_cid` / `mc_eid`)除去。
 *    それ以外の query param は保持する(`?p=123` で本体を表すサイトがあるため）
 * 8. 空 path は `/`(WHATWG URL の http/https は常に非空 pathname を持つため通常は no-op）
 */
export function canonicalizeUrl(raw: string): CanonicalizeResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "disallowed_scheme" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "credentials_in_url" };
  }

  parsed.hostname = parsed.hostname.toLowerCase();

  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  parsed.hash = "";

  const kept = new URLSearchParams();
  for (const [k, v] of parsed.searchParams) {
    const lower = k.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p))) continue;
    if (TRACKING_PARAM_EXACT.has(lower)) continue;
    kept.append(k, v);
  }
  parsed.search = kept.toString();

  if (parsed.pathname === "") {
    parsed.pathname = "/";
  }

  return { ok: true, url: parsed.toString() };
}
