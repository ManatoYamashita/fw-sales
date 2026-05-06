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
  /**
   * リダイレクト追跡後の最終 URL(元 URL と異なる場合のみ設定)。
   * 短縮 URL (maps.app.goo.gl / goo.gl/maps 等) の展開後の URL を保持する。
   * `url-parse-actions.ts` で短縮 URL の再パースに利用する。
   */
  final_url?: string;
  /**
   * 取得済 HTML 全文(`<script>` / `<style>` / `<svg>` を除去後)。
   * AI 分析機能 (`/stores/new` の [AI で分析]) で LLM への入力として再利用する。
   * 30〜40% のサイズ削減を行ったうえで保持。空時は `undefined`。
   */
  html?: string;
  /**
   * 運営者(法人名 or 個人オーナー名)。食べログ「店舗情報」DOM もしくは
   * JSON-LD `parentOrganization.name` から抽出。両取れた場合は JSON-LD 優先。
   */
  operator?: {
    value: string;
    source: "tabelog_dom" | "json_ld";
  };
  error?: string;
}

import type { OperatorType } from "@/types/store";

/**
 * ApplyResult の各フィールドに対する取得元の信頼度スコア(0〜100)。
 * 100 に近いほど確実、50 以下は要ユーザー確認。
 * 値が undefined のフィールドは「取得失敗 / 未取得」を示す。
 *
 * 参考スコア:
 * - 95: 食べログ辞書(prefecture / city)
 * - 90: JSON-LD (Restaurant schema、parentOrganization 含む)
 * - 85: 食べログ HTML 構造化セレクタ(店舗情報テーブル「運営者」行 等)
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
    | "memo"
    | "operator_name",
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
  /**
   * 運営者種別。URL 解析だけでは法人/個人の判別が難しいため "未設定" を初期値とし、
   * LLM 推定または手動編集で確定させる。
   */
  operator_type: OperatorType;
  /** 運営者名(法人名 or 個人オーナー名)。URL 解析で取得できなかった場合は空文字。 */
  operator_name: string;
  /** フィールドごとの取得信頼度。UI で背景色グラデーションに使う。 */
  confidence: ApplyConfidence;
}

/**
 * URL Import Panel での結果サマリ表示用。
 * 「N 項目中 M 項目を取得しました」「⚠ 電話: 取得失敗」等の UI を駆動する。
 *
 * 注意: `operator_type` は URL 解析だけでは法人/個人判別ができないため、表示対象から除外。
 * 運営者種別は `analyzeStoreAction` (LLM 推定) もしくはユーザー手動編集で確定させる。
 */
export interface AppliedField {
  /** ApplyResult のキー(name / prefecture 等)。operator_type は信頼度がないため除外。 */
  key: Exclude<keyof Omit<ApplyResult, "confidence">, "operator_type">;
  /** UI 表示ラベル(「店舗名」「電話番号」等) */
  label: string;
  /** 取得した値の文字列表現(空 = 取得失敗) */
  value: string;
  /** 取得信頼度(0〜100、未取得時は undefined) */
  confidence: number | undefined;
}
