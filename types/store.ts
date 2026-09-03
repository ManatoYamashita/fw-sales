import type { StageId } from "./stage";
import type { AiAnalysisResult } from "./ai-analysis";
import type { BasicInfo } from "./basic-info";

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
  /**
   * 企画担当ユーザー参照 (auth-and-notifications)。
   * `null` は未割当。`profiles.id` (uuid) を保持し、表示時は `getProfileById` で
   * 名前解決する。Phase 8 (0005 マイグレーション) で旧 `assigned_planner` (text) 列 DROP 済。
   */
  assigned_planner_user_id: string | null;
  /**
   * 営業担当ユーザー参照 (auth-and-notifications)。
   * 上記 `assigned_planner_user_id` と同等のライフサイクル。
   */
  assigned_sales_user_id: string | null;
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
  /** Google Places ID。エリア検索で追加した店舗のみ格納。手動登録時は null。 */
  google_place_id: string | null;
  /**
   * アポ取得日 (`YYYY-MM-DD`)。null = 未取得。
   * 「取得済み / 未取得」は本フィールドの有無から導出する (別の boolean は持たない)。
   */
  appointment_acquired_date: string | null;
  /** 次回アクション予定日 (`YYYY-MM-DD`)。null = 未設定。 */
  next_action_date: string | null;
  /** 次回アクション内容。null = 未設定。500 文字以内 (Action 層で検証)。 */
  next_action_note: string | null;
  /**
   * 基本情報 50 項目 (store-basic-info / Issue #114, #121)。
   * キーは `BASIC_INFO_ITEMS` (`lib/domain/basic-info-items.ts`)、値は `BasicInfoField`。
   * 未充足項目も含み、Places / 手動で段階充填。新規登録時は `{}` (店舗名のみで登録可)。
   * 表示は basic_info 優先 + 既存スカラー fallback (PR1 expand 期)。
   */
  basic_info: BasicInfo;
  created_at: string; // YYYY-MM-DD
  updated_at: string;
}

export type StoreInput = Omit<Store, "id" | "created_at" | "updated_at">;
export type StorePatch = Partial<StoreInput>;

/**
 * 店舗削除時に影響を受ける紐づけデータのカテゴリ別件数 (#152 store-cascade-delete)。
 *
 * deals / handoffs は店舗削除で連鎖削除され、place_candidates は
 * 紐付け解除 (matched_store_id が NULL 化) される。件数は取得時点の実データに基づく。
 * 削除確認ダイアログの影響表示に用いる。
 *
 * Issue #110: 旧 `research` テーブル撤去に伴い `research` を削除した (4 → 3 カテゴリ)。
 * なお `store_research_runs` も cascade 削除されるが、本型は元から数えていない
 * (旧 research を数えていた)。AI 調査 run の影響表示は別途の課題。
 */
export interface StoreDeleteImpact {
  /** 削除される商談件数 */
  deals: number;
  /** 削除される引き継ぎ件数 */
  handoffs: number;
  /** 紐付け解除される場所候補件数 */
  place_candidates: number;
}

export interface StoreFilter {
  q?: string;
  stage?: StageId;
  channel?: Channel;
  /**
   * 営業担当者の絞り込み。`Store.assigned_sales_user_id` (profile.id) と完全一致で比較する。
   * Phase 7 で旧 `assigned_sales` (text) 参照から user_id 参照へ切替済。
   * `""` (空文字) は未指定扱い、UUID は profiles テーブルの id を想定。
   */
  sales?: string;
}

/* ------------------------------------------------------------------ */
/*  並び替え                                                            */
/* ------------------------------------------------------------------ */
export type StoreSortKey =
  | "name"
  | "location"
  | "genre"
  | "review"
  | "stage"
  | "channel"
  | "sales"
  | "updated";

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
    key: "name",
    label: "店舗名",
    defaultDir: "asc",
    ascLabel: "あ→ん",
    descLabel: "ん→あ",
  },
  {
    key: "location",
    label: "エリア",
    defaultDir: "asc",
    ascLabel: "都道府県昇順",
    descLabel: "都道府県降順",
  },
  {
    key: "genre",
    label: "業態",
    defaultDir: "asc",
    ascLabel: "あ→ん",
    descLabel: "ん→あ",
  },
  {
    key: "review",
    label: "口コミ",
    defaultDir: "desc",
    ascLabel: "評価低い順",
    descLabel: "評価高い順",
  },
  {
    key: "stage",
    label: "状態",
    defaultDir: "asc",
    ascLabel: "進行順",
    descLabel: "完了順",
  },
  {
    key: "channel",
    label: "チャネル",
    defaultDir: "asc",
    ascLabel: "推奨順",
    descLabel: "未判定順",
  },
  {
    key: "sales",
    label: "営業担当",
    defaultDir: "asc",
    ascLabel: "氏名 昇順",
    descLabel: "氏名 降順",
  },
  {
    key: "updated",
    label: "更新",
    defaultDir: "desc",
    ascLabel: "古い順",
    descLabel: "新しい順",
  },
];

export const SORT_KEYS = SORT_OPTIONS.map((o) => o.key) as readonly StoreSortKey[];

export const DEFAULT_STORE_SORT: StoreSort = { key: "updated", dir: "desc" };

/**
 * 旧 URL クエリ (`?sort=review_avg`, `?sort=review_count`) を現行キーに正規化する。
 * 既存ブックマークや共有リンクの互換性を保つための一方向マッピング。
 */
export function normalizeLegacySortKey(raw: string): StoreSortKey | null {
  if (raw === "review_avg" || raw === "review_count") return "review";
  return (SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as StoreSortKey)
    : null;
}
