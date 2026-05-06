import type { StageId } from "./stage";

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
