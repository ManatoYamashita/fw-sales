import type { StageId } from "./stage";
import type { AiAnalysisResult } from "./ai-analysis";

export type Channel = "DM推奨" | "テレアポ推奨" | "未判定" | "要確認";
export const CHANNELS: readonly Channel[] = [
  "DM推奨",
  "テレアポ推奨",
  "要確認",
  "未判定",
];

export type Priority = "高" | "中" | "低";
export const PRIORITIES: readonly Priority[] = ["高", "中", "低"];

export type ContactForm = "あり" | "なし" | "未確認";
export const CONTACT_FORMS: readonly ContactForm[] = ["あり", "なし", "未確認"];

export const OPERATOR_TYPES = ["個人店", "複数店舗運営", "未設定"] as const;
export type OperatorType = (typeof OPERATOR_TYPES)[number];

export interface Store {
  id: string;
  name: string;
  prefecture: string;
  city: string;
  address: string;
  genre: string;
  priority: Priority;
  stage: StageId;
  channel: Channel;
  has_contact_form: ContactForm;
  map_url: string;
  site_url: string;
  instagram_url: string;
  phone: string;
  target_service: string; // CSV: "MEO,HP,インスタ"
  review_count: number;
  review_avg: number;
  memo: string;
  assigned_planner: string;
  assigned_sales: string;
  /**
   * 企画担当ユーザー参照 (auth-and-notifications Phase 1 で追加)。
   * Phase 6 ではバックフィル後に値が入る nullable 列、Phase 7 でアプリ層が
   * 参照に切替わり、Phase 8 で旧 `assigned_planner` (text) が DROP される。
   * 段階移行中の互換性確保のため optional として宣言。
   */
  assigned_planner_user_id?: string | null;
  /**
   * 営業担当ユーザー参照 (auth-and-notifications Phase 1 で追加)。
   * 上記 `assigned_planner_user_id` と同様の段階移行ライフサイクル。
   */
  assigned_sales_user_id?: string | null;
  /** 運営者種別: 個人店 / 複数店舗運営 / 未設定 (個人店判別シグナル) */
  operator_type: OperatorType;
  /** 運営者名: 法人名 (複数店舗運営) または個人オーナー名。未設定時は空文字。 */
  operator_name: string;
  /** AI 分析結果。未分析時は null。永続化時は JSON.stringify した text 列で保持。 */
  ai_analysis_result: AiAnalysisResult | null;
  /** 緯度。Google Map 埋め込み用。未取得時は null。 */
  lat: number | null;
  /** 経度。Google Map 埋め込み用。未取得時は null。 */
  lng: number | null;
  /** 営業時間 (フリーテキスト)。未設定時は空文字。 */
  business_hours: string;
  created_at: string; // YYYY-MM-DD
  updated_at: string;
}

export type StoreInput = Omit<Store, "id" | "created_at" | "updated_at">;
export type StorePatch = Partial<StoreInput>;

export interface StoreFilter {
  q?: string;
  stage?: StageId;
  channel?: Channel;
  priority?: Priority;
  /**
   * 営業担当者の絞り込み。`Store.assigned_sales` カラムと完全一致(`eq()` / `===`)で比較する。
   * 表記揺れ正規化(全角半角・前後空白・大小文字)は行わない。
   * 担当者マスタ ID 化は後続 Issue (`auth-and-notifications` 系列) で対応するため、
   * 本機能では文字列のまま保持する。
   */
  sales?: string;
}

/* ------------------------------------------------------------------ */
/*  並び替え                                                            */
/* ------------------------------------------------------------------ */
export type StoreSortKey =
  | "updated"
  | "name"
  | "review_avg"
  | "review_count"
  | "priority";

export type SortDirection = "asc" | "desc";

export interface StoreSort {
  key: StoreSortKey;
  dir: SortDirection;
}

export const SORT_OPTIONS: ReadonlyArray<{
  key: StoreSortKey;
  label: string;
  /** デフォルトの並び方向 (例: 更新日は新しい順 = desc) */
  defaultDir: SortDirection;
  ascLabel: string;
  descLabel: string;
}> = [
  {
    key: "updated",
    label: "更新日",
    defaultDir: "desc",
    ascLabel: "古い順",
    descLabel: "新しい順",
  },
  {
    key: "name",
    label: "店舗名",
    defaultDir: "asc",
    ascLabel: "あ→ん",
    descLabel: "ん→あ",
  },
  {
    key: "review_avg",
    label: "口コミ評価",
    defaultDir: "desc",
    ascLabel: "低い順",
    descLabel: "高い順",
  },
  {
    key: "review_count",
    label: "口コミ件数",
    defaultDir: "desc",
    ascLabel: "少ない順",
    descLabel: "多い順",
  },
  {
    key: "priority",
    label: "優先度",
    defaultDir: "desc",
    ascLabel: "低→高",
    descLabel: "高→低",
  },
];

export const SORT_KEYS = SORT_OPTIONS.map((o) => o.key) as readonly StoreSortKey[];

export const DEFAULT_STORE_SORT: StoreSort = { key: "updated", dir: "desc" };
