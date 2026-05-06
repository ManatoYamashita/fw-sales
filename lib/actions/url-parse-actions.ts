"use server";

import { parseStoreUrl } from "@/lib/url-parser";
import { fetchOgp } from "@/lib/url-parser/ogp";
import { applyParsedData } from "@/lib/url-parser/apply";
import type {
  AppliedField,
  ApplyResult,
  OgpResult,
  ParsedUrl,
} from "@/lib/url-parser/types";

export interface UrlImportResult {
  parsed: ParsedUrl | null;
  ogp: OgpResult | null;
  suggested: ApplyResult;
  /** UI のサマリ表示用 — フィールド別の取得状況 */
  applied: AppliedField[];
  /** 連鎖補完で 2 段目 fetch が走ったかどうか */
  chained: boolean;
}

interface ImportOptions {
  fetchOgp?: boolean;
  /** 食べログ等で site_url が取れたら、その URL の OGP も追加で取得して補完するか(デフォ true) */
  recursive?: boolean;
}

const FIELD_LABELS: Record<keyof Omit<ApplyResult, "confidence">, string> = {
  name: "店舗名",
  prefecture: "都道府県",
  city: "市区町村",
  phone: "電話番号",
  site_url: "公式サイト",
  map_url: "GoogleマップURL",
  instagram_url: "Instagram URL",
  genre: "業態",
  address: "住所",
  review_avg: "口コミ評価",
  review_count: "口コミ件数",
  memo: "メモ",
};

function buildAppliedFields(suggested: ApplyResult): AppliedField[] {
  const c = suggested.confidence;
  const fields: AppliedField[] = [];
  for (const key of Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS>) {
    const raw = suggested[key];
    let value: string;
    if (raw === null) {
      value = "";
    } else if (typeof raw === "number") {
      value = String(raw);
    } else {
      value = raw;
    }
    fields.push({
      key,
      label: FIELD_LABELS[key],
      value,
      confidence: c[key],
    });
  }
  return fields;
}

/**
 * 連鎖補完: 食べログ等で取れた site_url に対し、追加で OGP fetch を行い、
 * 食べログで取れなかったフィールド(address / phone / description 等)を埋める。
 *
 * 注意:
 * - 1 段のみ(無限再帰しない)
 * - 同一ホスト名はスキップ(食べログ内部リンクの誤誘導を防ぐ)
 * - 取得値の confidence は元の信頼度の 0.85 倍に減衰
 */
async function enrichWithChainedOgp(
  baseUrl: string,
  suggested: ApplyResult,
): Promise<{ updated: ApplyResult; chained: boolean }> {
  const siteUrl = suggested.site_url;
  if (!siteUrl) return { updated: suggested, chained: false };

  let baseHost: string | null = null;
  let chainHost: string | null = null;
  try {
    baseHost = new URL(baseUrl).hostname;
    chainHost = new URL(siteUrl).hostname;
  } catch {
    return { updated: suggested, chained: false };
  }
  if (!chainHost || !baseHost || chainHost === baseHost) {
    return { updated: suggested, chained: false };
  }

  const chainOgp = await fetchOgp(siteUrl);
  if (!chainOgp.ok) return { updated: suggested, chained: false };

  const updated: ApplyResult = { ...suggested, confidence: { ...suggested.confidence } };
  const decay = (n: number | undefined): number | undefined =>
    typeof n === "number" ? Math.round(n * 0.85) : undefined;

  // address: 元が空 or 信頼度低のときだけ上書き
  const addrThreshold = (suggested.confidence.address ?? 0) < 80;
  if (addrThreshold && chainOgp.address) {
    updated.address = chainOgp.address;
    updated.confidence.address = decay(90); // chained JSON-LD = 90 * 0.85
  }

  // phone: 元が空のときだけ
  if (!suggested.phone && chainOgp.phone) {
    updated.phone = chainOgp.phone;
    updated.confidence.phone = decay(85);
  }

  // memo: 公式サイトの description を追記(取得済みでも付加情報として有用)
  if (chainOgp.description) {
    const tail = `公式サイト概要: ${chainOgp.description.slice(0, 100)}`;
    updated.memo = updated.memo ? `${updated.memo}\n${tail}` : tail;
    if (typeof updated.confidence.memo !== "number") {
      updated.confidence.memo = decay(60);
    }
  }

  return { updated, chained: true };
}

/**
 * Google Maps 短縮 URL かどうかを判定。
 * - https://maps.app.goo.gl/<id>
 * - https://goo.gl/maps/<id>
 *
 * 短縮 URL は `parseGoogleMapsUrl` で name を抽出できないため、
 * `fetchOgp` のリダイレクト追跡後の `final_url` から再パースする必要がある。
 */
function isGoogleMapsShortUrl(url: string): boolean {
  return /(?:^https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url);
}

export async function importFromUrlAction(
  url: string,
  options: ImportOptions = { fetchOgp: true, recursive: true },
): Promise<UrlImportResult> {
  const fetchOgpFlag = options.fetchOgp !== false;
  const recursiveFlag = options.recursive !== false;

  let parsed = parseStoreUrl(url);
  let ogp: OgpResult | null = null;

  // OGP の取得は食べログ等の判定可能なソースに限定する
  if (
    fetchOgpFlag &&
    parsed &&
    (parsed.type === "tabelog" || parsed.type === "google_maps" || parsed.type === "unknown")
  ) {
    ogp = await fetchOgp(url);
  }

  // 短縮 URL リダイレクト後の最終 URL から再パース。
  // - parsed.type が google_maps だが name が取れていない、かつ短縮 URL 形式
  // - ogp.final_url が元 URL と異なる(リダイレクトが起きた)
  if (
    parsed &&
    parsed.type === "google_maps" &&
    !parsed.name &&
    isGoogleMapsShortUrl(url) &&
    ogp?.final_url &&
    ogp.final_url !== url
  ) {
    const reparsed = parseStoreUrl(ogp.final_url);
    if (reparsed && reparsed.name) {
      // 元 parsed のソース情報 (source_url, type) は保持しつつ、
      // 詳細フィールドは reparsed の値で上書き。
      // map_url は最終 URL を採用 — 後で開いた時に直接 Google Maps に行ける。
      parsed = {
        ...reparsed,
        source_url: url,
      };
    }
  }

  let suggested = applyParsedData(parsed, ogp);
  let chained = false;

  if (recursiveFlag && parsed?.type === "tabelog" && suggested.site_url) {
    const enriched = await enrichWithChainedOgp(url, suggested);
    suggested = enriched.updated;
    chained = enriched.chained;
  }

  const applied = buildAppliedFields(suggested);
  return { parsed, ogp, suggested, applied, chained };
}
