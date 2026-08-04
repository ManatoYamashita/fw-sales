/**
 * homepage の `<a href>` を crawl 候補として絞り込む pure function
 * (Plan v1.1 §7.4、9 段の filtering）。
 *
 * `tel:` は crawl 候補からは除外するが、phone evidence(`lib/website/parse/`）としては
 * 別途保持する(ここでの除外は「crawl しない」の意味のみ）。
 * PDF 等の download 系拡張子は crawl 候補からは除外するが、menu/reservation link の
 * signal としては `lib/website/parse/extract-page.ts` 側で観測どおり保持しうる。
 */

import { canonicalizeUrl } from "../url/canonicalize";
import { classifyPortal } from "../url/portal";

const DOWNLOAD_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "ico",
  "zip",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "mp4",
  "mp3",
  "mov",
  "csv",
  "rss",
  "xml",
]);

const NON_TARGET_PATTERNS: readonly RegExp[] = [
  /\blogin\b/i,
  /\bsignin\b/i,
  /\blogout\b/i,
  /\bsignout\b/i,
  /\bregister\b/i,
  /\bsignup\b/i,
  /\bmypage\b/i,
  /\baccount\b/i,
  /\badmin\b/i,
  /wp-admin/i,
  /wp-login/i,
  /\bcart\b/i,
  /\bcheckout\b/i,
  /\border\b/i,
  /\bbasket\b/i,
  /\bprivacy\b/i,
  /\bterms\b/i,
  /\bpolicy\b/i,
  /\bsitemap\b/i,
  /\bfeed\b/i,
  /\brss\b/i,
  /\bsearch\b/i,
  /[?&]s=/i,
  /\bcalendar\b/i,
  /\barchive\b/i,
  /\btag\b/i,
  /category\/page/i,
];

export interface LinkFilterInput {
  href: string;
  anchorText: string;
}

export interface FilterContext {
  /** href を絶対化する基点(このリンクが見つかったページの URL）。 */
  baseUrl: string;
  /** same-origin 判定の基準(`new URL(finalUrl).origin`）。 */
  effectiveOrigin: string;
  /** homepage の canonicalize 済み URL(自己参照除外に使用）。 */
  homepageUrl: string;
  /** 訪問済み(canonicalize 済み)URL の集合。 */
  visited: ReadonlySet<string>;
}

export type LinkFilterRejectionReason =
  | "invalid_url"
  | "non_http_scheme"
  | "credentials_in_url"
  | "disallowed_scheme"
  | "offsite"
  | "portal"
  | "fragment_only"
  | "download_extension"
  | "non_target_path"
  | "already_visited"
  | "is_homepage";

export type LinkFilterResult = { ok: true; url: string } | { ok: false; reason: LinkFilterRejectionReason };

/**
 * 9 段の filtering をこの順で適用する:
 * 1. http/https のみ  2. canonicalize  3. same effective origin  4. portal 除外
 * 5. fragment-only 除外  6. download 拡張子除外  7. login/admin/cart 等の非対象導線除外
 * 8. visited 除外  9. homepage 自身除外
 */
export function filterCrawlCandidateLink(input: LinkFilterInput, ctx: FilterContext): LinkFilterResult {
  const rawHref = input.href.trim();

  // 1. 絶対化 + protocol check
  let absolute: URL;
  try {
    absolute = new URL(rawHref, ctx.baseUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
    return { ok: false, reason: "non_http_scheme" };
  }

  // 2. canonicalize
  const canon = canonicalizeUrl(absolute.toString());
  if (!canon.ok) {
    return {
      ok: false,
      reason: canon.reason === "credentials_in_url" ? "credentials_in_url" : "disallowed_scheme",
    };
  }
  const canonUrl = new URL(canon.url);

  // 3. same effective origin
  if (canonUrl.origin !== ctx.effectiveOrigin) {
    return { ok: false, reason: "offsite" };
  }

  // 4. portal 除外
  if (classifyPortal(canonUrl.hostname) !== null) {
    return { ok: false, reason: "portal" };
  }

  // 5. fragment-only 除外。
  //    (a) href が "#" で始まるものは常に自ページ参照であり、fragment-only。
  //        `href="#"` は WHATWG URL では hash が空文字になる(empty fragment)ため
  //        `absolute.hash !== ""` では捕まらない。生の href で判定することで、
  //        homepage / subpage いずれを base にしても自ページが候補にならないことを
  //        **この filter 単体で**保証する(ctx.visited の登録順序に依存しない）。
  //    (b) 絶対/相対で書かれていても、hash 付きで base と同一ページを指すものは同様に除外。
  //    base と異なるページへの hash 付きリンク(href="/access#map" 等)は除外しない。
  if (rawHref.startsWith("#")) {
    return { ok: false, reason: "fragment_only" };
  }
  if (absolute.hash !== "") {
    let baseParsed: URL | null = null;
    try {
      baseParsed = new URL(ctx.baseUrl);
    } catch {
      baseParsed = null;
    }
    if (
      baseParsed &&
      absolute.origin === baseParsed.origin &&
      absolute.pathname === baseParsed.pathname &&
      absolute.search === baseParsed.search
    ) {
      return { ok: false, reason: "fragment_only" };
    }
  }

  // 6. download 拡張子除外
  const extMatch = /\.([a-z0-9]+)$/i.exec(canonUrl.pathname);
  if (extMatch && DOWNLOAD_EXTENSIONS.has(extMatch[1]!.toLowerCase())) {
    return { ok: false, reason: "download_extension" };
  }

  // 7. login/admin/cart 等の非対象導線除外
  const pathAndQuery = `${canonUrl.pathname}${canonUrl.search}`;
  if (NON_TARGET_PATTERNS.some((re) => re.test(pathAndQuery))) {
    return { ok: false, reason: "non_target_path" };
  }

  // 8. visited 除外
  if (ctx.visited.has(canon.url)) {
    return { ok: false, reason: "already_visited" };
  }

  // 9. homepage 自身除外
  if (canon.url === ctx.homepageUrl) {
    return { ok: false, reason: "is_homepage" };
  }

  return { ok: true, url: canon.url };
}
