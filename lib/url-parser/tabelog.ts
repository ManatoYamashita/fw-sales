import { TABELOG_PREF, TABELOG_AREA, TABELOG_SUBAREA } from "./dictionaries";
import type { ParsedUrl } from "./types";

const TABELOG_PATTERN =
  /tabelog\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)/;

export function parseTabelogUrl(url: string): ParsedUrl {
  const result: ParsedUrl = {
    type: "tabelog",
    source_url: url,
    tabelog_url: url,
    confidence: {},
  };

  const match = url.match(TABELOG_PATTERN);
  if (!match) return result;

  const [, pref, area, subarea, storeId] = match;
  if (pref) result.pref_raw = pref;
  if (area) result.area_raw = area;
  if (subarea) result.subarea_raw = subarea;
  if (storeId) result.store_id = storeId;

  if (pref) {
    const prefecture = TABELOG_PREF[pref.toLowerCase()];
    if (prefecture) {
      result.prefecture = prefecture;
      result.confidence.prefecture = "high";
    }
  }

  if (area) {
    const areaHint = TABELOG_AREA[area.toUpperCase()];
    if (areaHint) {
      result.city = areaHint;
      result.confidence.city = "medium";
    }
  }

  if (subarea) {
    const subareaHint = TABELOG_SUBAREA[subarea.toUpperCase()];
    if (subareaHint) {
      result.station_area = subareaHint;
      result.confidence.station = "high";
    }
  }

  return result;
}
