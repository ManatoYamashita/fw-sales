export type MeetingType = "対面" | "オンライン" | "電話";
export const MEETING_TYPES: readonly MeetingType[] = ["対面", "オンライン", "電話"];

export type DealStatus = "継続追客" | "見積提出" | "失注" | "受注";
export const DEAL_STATUSES: readonly DealStatus[] = [
  "継続追客",
  "見積提出",
  "失注",
  "受注",
];

export interface Deal {
  id: string;
  store_id: string;
  store_name: string;
  date: string; // YYYY-MM-DD
  meeting_type: MeetingType;
  discussion: string;
  proposal: string;
  estimate_amount: number;
  order_amount: number | null;
  lost_reason: string;
  status: DealStatus;
  assigned_sales: string;
  created_at: string;
  updated_at: string;
}

export type DealInput = Omit<Deal, "id" | "created_at" | "updated_at">;
export type DealPatch = Partial<DealInput>;
