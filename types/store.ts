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
