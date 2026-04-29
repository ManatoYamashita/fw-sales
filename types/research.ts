import type { Channel } from "./store";

export type ResearchStatus = "進行中" | "完了";

export interface Research {
  id: string;
  store_id: string;
  store_name: string;
  total_review: string;
  strength1: string;
  strength2: string;
  strength3: string;
  weakness1: string;
  weakness2: string;
  weakness3: string;
  review_positive: string;
  review_negative: string;
  meo_gap: string;
  hp_gap: string;
  instagram_gap: string;
  channel: Channel;
  channel_reason: string;
  sales_hook: string;
  entry_product: string;
  main_product: string;
  researcher: string;
  status: ResearchStatus;
  created_at: string;
  updated_at: string;
}

export type ResearchInput = Omit<Research, "id" | "created_at" | "updated_at">;
export type ResearchPatch = Partial<ResearchInput>;
