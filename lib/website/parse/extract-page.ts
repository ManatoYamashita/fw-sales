/**
 * Generic first-party website parser(Plan v1.1 §8、契約 §B.4.2）。
 *
 * Tabelog 等 portal 専用の selector・HTML 全文への正規表現フォールバックは
 * 一切持たない(`lib/url-parser/ogp.ts` の `extractFromHtml` とは別実装、意図的に
 * import しない)。
 *
 * 生 HTML はこの関数の戻り値に含めない(契約 §B.5）。
 *
 * crawl 候補としてのリンク絞り込み(`../crawl/link-filter.ts`）はここでは行わない。
 * `links` は生の `{url, anchorText}` のまま返し、Phase 2 の crawl orchestration が
 * `filterCrawlCandidateLink` / `scorePage` へ渡す。
 */

import * as cheerio from "cheerio";
import { canonicalizeUrl } from "../url/canonicalize";
import { classifyPortal } from "../url/portal";
import { matchesCategory } from "../crawl/score-page";
import { parseJsonLd, selectPrimaryIdentityNode } from "./json-ld";
import { buildIdentityEvidence } from "./identity-evidence";
import type { WebsiteIdentityEvidence } from "../contract/identity";

export interface PageLink {
  url: string;
  anchorText: string;
}

export interface PageObservation {
  sourceUrl: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonical: string | null;
  jsonLdTypes: string[];
  jsonLdName: string | null;
  jsonLdAddress: string | null;
  jsonLdPhone: string | null;
  phoneLinks: string[];
  instagramLinks: string[];
  menuLinks: string[];
  reservationLinks: string[];
  /** crawl 候補の生データ(未フィルタ・未absolutize）。Phase 2 が filter/score する。 */
  links: PageLink[];
  identityEvidence: WebsiteIdentityEvidence;
}

const TITLE_MAX = 200;
const DESC_MAX = 300;
const H1_MAX = 200;

function cleanText(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed === "" ? null : collapsed;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function cleanAndTruncate(raw: string | undefined | null, max: number): string | null {
  const cleaned = cleanText(raw);
  return cleaned === null ? null : truncate(cleaned, max);
}

/** href を base に対して絶対化し、canonicalize する。失敗すれば null。 */
function absolutizeAndCanonicalize(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  let absolute: URL;
  try {
    absolute = new URL(href, base);
  } catch {
    return null;
  }
  const canon = canonicalizeUrl(absolute.toString());
  return canon.ok ? canon.url : null;
}

function dedupe(arr: readonly string[]): string[] {
  return [...new Set(arr)];
}

const BOOKING_PROVIDER_HOSTS_FOR_RESERVATION = new Set([
  "tabelog",
  "hotpepper",
  "gnavi",
  "retty",
  "tablecheck",
  "ebica",
  "ikyu",
  "ozmall",
  "google",
]);

function collectMatchingLinks(
  links: readonly PageLink[],
  sourceUrl: string,
  predicate: (absoluteUrl: string, anchorText: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const link of links) {
    const canon = absolutizeAndCanonicalize(link.url, sourceUrl);
    if (canon === null) continue;
    if (predicate(canon, link.anchorText)) out.push(canon);
  }
  return dedupe(out);
}

export function extractPage(html: string, sourceUrl: string): PageObservation {
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLd($);

  const title = cleanAndTruncate($("title").first().text(), TITLE_MAX);
  const metaDescription = cleanAndTruncate(
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content"),
    DESC_MAX,
  );
  const h1 = cleanAndTruncate($("h1").first().text(), H1_MAX);
  const canonical = absolutizeAndCanonicalize($('link[rel="canonical"]').attr("href"), sourceUrl);

  // scalar な jsonld_* signal は **同一 entity node** からのみ取る(契約 §B.2）。
  // field 単位の fallback は、Restaurant の店名と Organization の本社住所を
  // 1 つの店舗 fact として混ぜてしまうため行わない。
  const primaryNode = selectPrimaryIdentityNode(jsonLd.identityNodes);
  const jsonLdName = primaryNode?.name ?? null;
  const jsonLdAddress = primaryNode?.address ?? null;
  const jsonLdPhone = primaryNode?.telephone ?? null;

  const phoneLinks = dedupe(
    $('a[href^="tel:"]')
      .map((_i, el) => ($(el).attr("href") ?? "").replace(/^tel:/i, "").trim())
      .get()
      .filter((v): v is string => v !== ""),
  );

  const allLinks: PageLink[] = $("a[href]")
    .map((_i, el) => ({
      url: $(el).attr("href") ?? "",
      anchorText: cleanText($(el).text()) ?? "",
    }))
    .get()
    .filter((l) => l.url.trim() !== "");

  const instagramFromAnchors = collectMatchingLinks(
    allLinks,
    sourceUrl,
    (absoluteUrl) => classifyPortal(new URL(absoluteUrl).hostname) === "instagram",
  );
  const instagramFromSameAs = dedupe(
    jsonLd.identityNodes
      .flatMap((n) => n.sameAs)
      .map((href) => absolutizeAndCanonicalize(href, sourceUrl))
      .filter((u): u is string => u !== null)
      .filter((u) => classifyPortal(new URL(u).hostname) === "instagram"),
  );
  const instagramLinks = dedupe([...instagramFromAnchors, ...instagramFromSameAs]);

  const menuLinks = collectMatchingLinks(allLinks, sourceUrl, (absoluteUrl, anchorText) =>
    matchesCategory(absoluteUrl, anchorText, "menu"),
  );

  const reservationLinks = collectMatchingLinks(allLinks, sourceUrl, (absoluteUrl, anchorText) => {
    if (matchesCategory(absoluteUrl, anchorText, "reserve")) return true;
    const portal = classifyPortal(new URL(absoluteUrl).hostname);
    return portal !== null && BOOKING_PROVIDER_HOSTS_FOR_RESERVATION.has(portal);
  });

  const identityEvidence = buildIdentityEvidence({
    identityNodes: jsonLd.identityNodes,
    h1,
    title,
    phoneLinks,
    sourceUrl,
  });

  return {
    sourceUrl,
    title,
    metaDescription,
    h1,
    canonical,
    jsonLdTypes: jsonLd.allTypes,
    jsonLdName,
    jsonLdAddress,
    jsonLdPhone,
    phoneLinks,
    instagramLinks,
    menuLinks,
    reservationLinks,
    links: allLinks,
    identityEvidence,
  };
}
