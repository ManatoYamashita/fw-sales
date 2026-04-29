export type ParsedSource = "tabelog" | "google_maps" | "instagram" | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ParsedUrl {
  type: ParsedSource;
  source_url: string;
  prefecture?: string;
  city?: string;
  station_area?: string;
  name?: string;
  genre?: string;
  map_url?: string;
  tabelog_url?: string;
  instagram_url?: string;
  pref_raw?: string;
  area_raw?: string;
  subarea_raw?: string;
  store_id?: string;
  confidence: Partial<
    Record<
      "prefecture" | "city" | "station" | "name" | "genre",
      ConfidenceLevel
    >
  >;
  raw?: string;
}

export interface OgpResult {
  ok: boolean;
  name?: string;
  description?: string;
  genre?: string;
  rating?: number;
  review_count?: number;
  address_hint?: string;
  phone?: string;
  error?: string;
}

export interface ApplyResult {
  name: string;
  prefecture: string;
  city: string;
  phone: string;
  site_url: string;
  map_url: string;
  instagram_url: string;
  genre: string;
  address: string;
  review_avg: number | null;
  review_count: number | null;
  memo: string;
}
