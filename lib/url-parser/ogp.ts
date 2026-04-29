import "server-only";
import { guessGenre } from "./genre";
import type { OgpResult } from "./types";

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; FirstwebLeadOS/1.0; +https://firstweb.example.com)";

/**
 * 食べログ等から OGP / 構造化データを直接取得する Server-only 関数。
 * allorigins.win のような外部プロキシは使わず、Next サーバから直 fetch する。
 */
export async function fetchOgp(url: string): Promise<OgpResult> {
  if (!url) return { ok: false, error: "URL が未指定です" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const html = await response.text();
    return extractFromHtml(html);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "タイムアウトしました" };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "fetch error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function pickMeta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = html.match(re);
  return match?.[1] ?? match?.[2];
}

function extractFromHtml(html: string): OgpResult {
  const result: OgpResult = { ok: true };

  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  if (titleTag) {
    const cleaned = titleTag
      .replace(/\s*[|｜]\s*食べログ.*$/i, "")
      .replace(/\s*[|｜]\s*Google.*$/i, "")
      .trim();
    const head = cleaned.split(/\s*[-－]\s*/)[0]?.trim();
    if (head) result.name = head;
    const g = guessGenre(cleaned);
    if (g) result.genre = g;
  }

  const ogTitle = pickMeta(html, "og:title");
  if (ogTitle && !result.name) {
    result.name = ogTitle
      .replace(/\s*[|｜]\s*食べログ.*$/i, "")
      .split(/[-－]/)[0]
      ?.trim();
  }

  const ogDesc = pickMeta(html, "og:description");
  if (ogDesc) {
    result.description = ogDesc.slice(0, 200);
    if (!result.genre) {
      const g = guessGenre(ogDesc);
      if (g) result.genre = g;
    }
  }

  const ratingMatch = html.match(/(\d+\.\d+)\s*点/);
  if (ratingMatch?.[1]) result.rating = parseFloat(ratingMatch[1]);

  const reviewCountMatch = html.match(/口コミ[^0-9]{0,8}(\d+)\s*件/);
  if (reviewCountMatch?.[1])
    result.review_count = parseInt(reviewCountMatch[1], 10);

  const addrMatch = html.match(
    /〒\d{3}-\d{4}\s*([^\s<"']+(?:都|道|府|県)[^\s<"']+)/,
  );
  if (addrMatch?.[1]) result.address_hint = addrMatch[1];

  const telMatch = html.match(/(0\d{1,4}[-－]\d{1,4}[-－]\d{4})/);
  if (telMatch?.[1]) result.phone = telMatch[1];

  return result;
}
