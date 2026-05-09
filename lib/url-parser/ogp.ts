import "server-only";
import * as cheerio from "cheerio";
import { guessGenre } from "./genre";
import type { OgpResult } from "./types";

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; FirstwebLeadOS/1.0; +https://firstweb.example.com)";

/**
 * 食べログ等から OGP / JSON-LD / 構造化データを直接取得する Server-only 関数。
 * cheerio を用いた DOM パースで CSS セレクタ + JSON-LD `Restaurant` schema を読む。
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
    const finalUrl = response.url || url;
    const html = await response.text();
    const result = extractFromHtml(html, finalUrl);
    // 短縮 URL のリダイレクト後 URL を後段の再パースで利用するため保持
    if (finalUrl && finalUrl !== url) {
      result.final_url = finalUrl;
    }
    return result;
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

/**
 * ジェネリックな汚染タイトル(サイト名そのもの)を name として採用しないためのブラックリスト。
 * extractFromHtml では title / og:title をクレンジング後にも完全一致した場合は破棄する。
 */
const TITLE_NAME_BLACKLIST: readonly string[] = [
  "Google マップ",
  "Google Maps",
  "Googleマップ",
  "食べログ",
  "Tabelog",
];

function isBlacklistedTitle(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return TITLE_NAME_BLACKLIST.some((bad) => t === bad);
}

function cleanName(raw: string): string {
  return raw
    .replace(/\s*[|｜]\s*食べログ.*$/i, "")
    .replace(/\s*[|｜]\s*Google.*$/i, "")
    .replace(/\s*\[食べログ\].*$/, "")
    .replace(/のご予約\s*$/, "")
    .replace(/の予約\s*$/, "")
    .split(/\s*[-－]\s*/)[0]
    ?.trim() ?? "";
}

/**
 * JSON-LD `<script type="application/ld+json">` から Restaurant schema を抽出する。
 * Schema.org の `Restaurant` / `LocalBusiness` / `FoodEstablishment` 型を許容。
 */
interface JsonLdRestaurant {
  name?: string;
  telephone?: string;
  url?: string;
  address?: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
  };
  aggregateRating?: {
    ratingValue?: string | number;
    reviewCount?: string | number;
    ratingCount?: string | number;
  };
  description?: string;
  servesCuisine?: string | string[];
  /** 親組織(法人運営の場合の運営会社名)。Schema.org `parentOrganization`。 */
  parentOrganization?: {
    name?: string;
  };
}

function isRestaurantType(type: unknown): boolean {
  const targets = ["Restaurant", "LocalBusiness", "FoodEstablishment", "BarOrPub", "CafeOrCoffeeShop"];
  if (typeof type === "string") return targets.includes(type);
  if (Array.isArray(type)) return type.some((t) => typeof t === "string" && targets.includes(t));
  return false;
}

function findRestaurantNode(node: unknown): JsonLdRestaurant | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (isRestaurantType(obj["@type"])) return obj as JsonLdRestaurant;
  // @graph の配列を再帰的に探索
  const graph = obj["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      const found = findRestaurantNode(item);
      if (found) return found;
    }
  }
  return null;
}

function parseJsonLd($: cheerio.CheerioAPI): JsonLdRestaurant | null {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const raw = $(scripts[i]).text().trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const found = findRestaurantNode(item);
        if (found) return found;
      }
    } catch {
      // 不正な JSON は無視
    }
  }
  return null;
}

function buildAddressFromJsonLd(addr: NonNullable<JsonLdRestaurant["address"]>): string {
  const parts: string[] = [];
  if (addr.postalCode) parts.push(`〒${addr.postalCode}`);
  if (addr.addressRegion) parts.push(addr.addressRegion);
  if (addr.addressLocality) parts.push(addr.addressLocality);
  if (addr.streetAddress) parts.push(addr.streetAddress);
  return parts.filter(Boolean).join(" ");
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function extractFromHtml(html: string, sourceUrl?: string): OgpResult {
  const result: OgpResult = { ok: true };
  const $ = cheerio.load(html);

  // ---- name ----
  const titleTag = $("title").first().text();
  if (titleTag) {
    const head = cleanName(titleTag);
    if (head && !isBlacklistedTitle(head)) result.name = head;
    const g = guessGenre(titleTag);
    if (g) result.genre = g;
  }
  const ogTitle = $('meta[property="og:title"]').attr("content");
  if (ogTitle && !result.name) {
    const head = cleanName(ogTitle);
    if (head && !isBlacklistedTitle(head)) result.name = head;
  }

  // ---- description ----
  const ogDesc =
    $('meta[property="og:description"]').attr("content") ??
    $('meta[name="description"]').attr("content");
  if (ogDesc) {
    result.description = ogDesc.slice(0, 200);
    if (!result.genre) {
      const g = guessGenre(ogDesc);
      if (g) result.genre = g;
    }
  }

  // ---- JSON-LD (Restaurant schema) ----
  const jsonLd = parseJsonLd($);
  if (jsonLd) {
    if (!result.name && jsonLd.name) {
      const head = cleanName(jsonLd.name);
      if (head && !isBlacklistedTitle(head)) result.name = head;
    }
    if (!result.phone && jsonLd.telephone) {
      result.phone = jsonLd.telephone;
    }
    if (jsonLd.address) {
      const composed = buildAddressFromJsonLd(jsonLd.address);
      if (composed) {
        result.address = composed;
        if (!result.address_hint) result.address_hint = composed;
      }
    }
    if (jsonLd.aggregateRating) {
      const rating = toFiniteNumber(jsonLd.aggregateRating.ratingValue);
      if (typeof rating === "number") result.rating = rating;
      const reviewCount =
        toFiniteNumber(jsonLd.aggregateRating.reviewCount) ??
        toFiniteNumber(jsonLd.aggregateRating.ratingCount);
      if (typeof reviewCount === "number") result.review_count = reviewCount;
    }
    if (jsonLd.url) {
      // 自分自身を指すURLは除外
      if (sourceUrl) {
        try {
          const a = new URL(jsonLd.url);
          const b = new URL(sourceUrl);
          if (a.hostname !== b.hostname) result.site_url = jsonLd.url;
        } catch {
          // URL パース失敗 → そのまま採用
          result.site_url = jsonLd.url;
        }
      } else {
        result.site_url = jsonLd.url;
      }
    }
    if (!result.genre && jsonLd.servesCuisine) {
      const cuisine = Array.isArray(jsonLd.servesCuisine)
        ? jsonLd.servesCuisine[0]
        : jsonLd.servesCuisine;
      if (typeof cuisine === "string") {
        const g = guessGenre(cuisine);
        if (g) result.genre = g;
      }
    }
    // 運営者(法人運営の場合の運営会社名)を JSON-LD から抽出
    const parentOrgName = jsonLd.parentOrganization?.name?.trim();
    if (parentOrgName) {
      result.operator = { value: parentOrgName, source: "json_ld" };
    }
  }

  // ---- OGP url / canonical (site_url のフォールバック) ----
  if (!result.site_url) {
    const candidate =
      $('link[rel="canonical"]').attr("href") ??
      $('meta[property="og:url"]').attr("content");
    if (candidate && sourceUrl) {
      try {
        const a = new URL(candidate);
        const b = new URL(sourceUrl);
        // 自分自身を指していない場合のみ採用(食べログの og:url は食べログ自身)
        if (a.hostname !== b.hostname) result.site_url = candidate;
      } catch {
        // URL 不正なら無視
      }
    }
  }

  // ---- 食べログ等の DOM 構造化抽出 ----
  // 食べログのレストラン詳細ページに対するセレクタ。クラス名は変わりうるため複数候補で頑張る。
  if (!result.address) {
    const candidates = [
      ".rstinfo-table__address",
      "p[class*=address]",
      ".address",
    ];
    for (const sel of candidates) {
      const text = $(sel).first().text().trim();
      if (text && text.length > 5) {
        result.address = text.replace(/\s+/g, " ");
        break;
      }
    }
  }

  if (!result.phone) {
    const phoneCandidates = [
      ".rstinfo-table__tel-num",
      "[class*=tel-num]",
      "[class*=phone]",
    ];
    for (const sel of phoneCandidates) {
      const text = $(sel).first().text().trim();
      if (text && /\d{2,5}[-－]\d{2,5}[-－]\d{3,5}/.test(text)) {
        const m = text.match(/(0\d{1,4}[-－]\d{1,4}[-－]\d{4})/);
        if (m?.[1]) {
          result.phone = m[1];
          break;
        }
      }
    }
  }

  if (typeof result.rating !== "number") {
    // 食べログ独自の評価表示「3.4 点」「3.4」(.rdheader-rating__score-val)
    const scoreCandidates = [
      ".rdheader-rating__score-val",
      ".tab__rating-score",
      "[class*=rating-score]",
    ];
    for (const sel of scoreCandidates) {
      const text = $(sel).first().text().trim();
      const m = text.match(/(\d+\.\d+)/);
      if (m?.[1]) {
        const n = parseFloat(m[1]);
        if (Number.isFinite(n) && n > 0 && n <= 5) {
          result.rating = n;
          break;
        }
      }
    }
  }

  if (typeof result.review_count !== "number") {
    const reviewCandidates = [
      ".rdheader-rating__review-target",
      "[class*=review-count]",
    ];
    for (const sel of reviewCandidates) {
      const text = $(sel).first().text();
      const m = text.match(/口コミ[^0-9]{0,8}(\d+)\s*件/) ?? text.match(/(\d+)\s*件/);
      if (m?.[1]) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n)) {
          result.review_count = n;
          break;
        }
      }
    }
  }

  // ---- 食べログ「店舗情報」テーブルの「運営」行から運営者抽出 ----
  // JSON-LD で取れた場合は上書きしない(JSON-LD の方が信頼度 90、DOM は 85)
  if (!result.operator) {
    const operatorCandidates = [
      'th:contains("運営者") + td',
      'th:contains("運営会社") + td',
      'th:contains("運営") + td',
    ];
    for (const sel of operatorCandidates) {
      const text = $(sel).first().text().trim();
      // 「店舗情報変更の申請をする」等のリンク文言が混入することがあるので、
      // 短い先頭部分のみ採用(最初の改行 / "店舗情報" 等のキーワードで切る)
      const head = text.split(/[\n\r]|店舗情報/)[0]?.trim() ?? "";
      if (head && head.length > 0 && head.length < 100) {
        result.operator = { value: head, source: "tabelog_dom" };
        break;
      }
    }
  }

  // ---- 食べログ「ホームページ」リンク → site_url 補完 ----
  if (!result.site_url) {
    const hpCandidates = [
      ".rstinfo-table__url-link",
      "a[class*=url-link]",
      'th:contains("ホームページ") + td a',
    ];
    for (const sel of hpCandidates) {
      const href = $(sel).first().attr("href");
      if (href && /^https?:/.test(href)) {
        if (sourceUrl) {
          try {
            const a = new URL(href);
            const b = new URL(sourceUrl);
            if (a.hostname !== b.hostname) {
              result.site_url = href;
              break;
            }
          } catch {
            // 不正な URL は無視
          }
        } else {
          result.site_url = href;
          break;
        }
      }
    }
  }

  // ---- 文字列フォールバック(全 HTML 走査) ----
  // JSON-LD / セレクタで取れなかった場合の最終手段
  if (!result.address_hint) {
    const m = html.match(/〒\d{3}-\d{4}\s*([^\s<"']+(?:都|道|府|県)[^\s<"']+)/);
    if (m?.[1]) result.address_hint = m[1];
  }

  if (typeof result.rating !== "number") {
    const m = html.match(/(\d+\.\d+)\s*点/);
    if (m?.[1]) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0 && n <= 5) result.rating = n;
    }
  }

  if (typeof result.review_count !== "number") {
    const m = html.match(/口コミ[^0-9]{0,8}(\d+)\s*件/);
    if (m?.[1]) result.review_count = parseInt(m[1], 10);
  }

  if (!result.phone) {
    const m = html.match(/(0\d{1,4}[-－]\d{1,4}[-－]\d{4})/);
    if (m?.[1]) result.phone = m[1];
  }

  // ---- HTML 全文の保持(AI 分析機能用、`<script>` / `<style>` / `<svg>` 除去) ----
  // cheerio の同一インスタンスを再利用して payload 30〜40% を削減した HTML を保存。
  // `OgpResult.html` は `/stores/new` の [AI で分析] が LLM への入力として再利用する。
  $("script, style, svg, noscript").remove();
  result.html = $.html();

  return result;
}
