"use server";

import { parseStoreUrl } from "@/lib/url-parser";
import { fetchOgp } from "@/lib/url-parser/ogp";
import { applyParsedData } from "@/lib/url-parser/apply";
import type {
  ApplyResult,
  OgpResult,
  ParsedUrl,
} from "@/lib/url-parser/types";

export interface UrlImportResult {
  parsed: ParsedUrl | null;
  ogp: OgpResult | null;
  suggested: ApplyResult;
}

export async function importFromUrlAction(
  url: string,
  options: { fetchOgp?: boolean } = { fetchOgp: true },
): Promise<UrlImportResult> {
  const parsed = parseStoreUrl(url);
  let ogp: OgpResult | null = null;

  // OGPの取得は食べログ等の判定可能なソースに限定する
  if (
    options.fetchOgp &&
    parsed &&
    (parsed.type === "tabelog" || parsed.type === "google_maps")
  ) {
    ogp = await fetchOgp(url);
  }

  const suggested = applyParsedData(parsed, ogp);
  return { parsed, ogp, suggested };
}
