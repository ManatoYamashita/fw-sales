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
  /** 〒番号 + 都道府県以降の生文字列(後段で prefecture を抽出するため温存) */
  address_hint?: string;
  /** 構造化抽出された詳細住所(JSON-LD or 食べログ DOM 由来) */
  address?: string;
  phone?: string;
  /** 店舗の公式サイト URL(JSON-LD url、og:url、食べログのホームページリンク等) */
  site_url?: string;
  error?: string;
}

/**
 * ApplyResult の各フィールドに対する取得元の信頼度スコア(0〜100)。
 * 100 に近いほど確実、50 以下は要ユーザー確認。
 * 値が undefined のフィールドは「取得失敗 / 未取得」を示す。
 *
 * 参考スコア:
 * - 95: 食べログ辞書(prefecture / city)
 * - 90: JSON-LD (Restaurant schema)
 * - 85: 食べログ HTML 構造化セレクタ
 * - 80: URL 直接抽出(station_area, name 部分)
 * - 75: OGP og:title / canonical / Google Maps URL の name
 * - 60: OGP description 由来の genre 推定
 * - 50: Google Maps URL の query parameter
 * - (連鎖 fetch 由来は元値の 0.85 倍に減衰)
 */
export type ApplyConfidence = Partial<
  Record<
    | "name"
    | "prefecture"
    | "city"
    | "phone"
    | "site_url"
    | "map_url"
    | "instagram_url"
    | "genre"
    | "address"
    | "review_avg"
    | "review_count"
    | "memo",
    number
  >
>;

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
  /** フィールドごとの取得信頼度。UI で背景色グラデーションに使う。 */
  confidence: ApplyConfidence;
}

/**
 * URL Import Panel での結果サマリ表示用。
 * 「N 項目中 M 項目を取得しました」「⚠ 電話: 取得失敗」等の UI を駆動する。
 */
export interface AppliedField {
  /** ApplyResult のキー(name / prefecture 等) */
  key: keyof Omit<ApplyResult, "confidence">;
  /** UI 表示ラベル(「店舗名」「電話番号」等) */
  label: string;
  /** 取得した値の文字列表現(空 = 取得失敗) */
  value: string;
  /** 取得信頼度(0〜100、未取得時は undefined) */
  confidence: number | undefined;
}
