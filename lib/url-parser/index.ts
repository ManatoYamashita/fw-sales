import { parseTabelogUrl } from "./tabelog";
import { parseGoogleMapsUrl } from "./google-maps";
import type { ParsedUrl } from "./types";

export type { ParsedUrl, OgpResult, ApplyResult } from "./types";

export function parseStoreUrl(url: string): ParsedUrl | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.includes("tabelog.com")) {
    return parseTabelogUrl(trimmed);
  }
  if (
    trimmed.includes("maps.google") ||
    trimmed.includes("goo.gl/maps") ||
    trimmed.includes("maps.app.goo.gl") ||
    trimmed.includes("google.com/maps")
  ) {
    return parseGoogleMapsUrl(trimmed);
  }
  if (trimmed.includes("instagram.com")) {
    return {
      type: "instagram",
      source_url: trimmed,
      instagram_url: trimmed,
      confidence: {},
    };
  }
  return {
    type: "unknown",
    source_url: trimmed,
    raw: trimmed,
    confidence: {},
  };
}
