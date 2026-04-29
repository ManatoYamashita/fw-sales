import { guessGenre } from "./genre";
import type { ParsedUrl } from "./types";

export function parseGoogleMapsUrl(url: string): ParsedUrl {
  const result: ParsedUrl = {
    type: "google_maps",
    source_url: url,
    map_url: url,
    confidence: {},
  };

  try {
    const placeMatch = url.match(/maps\/place\/([^/@]+)/);
    if (placeMatch?.[1]) {
      const decoded = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ");
      if (decoded && !decoded.startsWith("data=")) {
        result.name = decoded;
        result.confidence.name = "medium";
        const genre = guessGenre(decoded);
        if (genre) {
          result.genre = genre;
          result.confidence.genre = "medium";
        }
      }
    }

    const queryMatch = url.match(/[?&]q=([^&]+)/);
    if (!result.name && queryMatch?.[1]) {
      const q = decodeURIComponent(queryMatch[1]).replace(/\+/g, " ");
      result.name = q;
      result.confidence.name = "low";
    }
  } catch {
    // ignore — 解析できない場合は url のみ返す
  }

  return result;
}
