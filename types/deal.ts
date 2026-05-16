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
  /**
   * 営業担当ユーザー参照 (auth-and-notifications)。
   * `null` は未割当。`profiles.id` (uuid) を保持し、表示時は `getProfileById` で
   * 名前解決する。Phase 8 (0005 マイグレーション) で旧 `assigned_sales` (text) 列 DROP 済。
   */
  assigned_sales_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export type DealInput = Omit<Deal, "id" | "created_at" | "updated_at">;
export type DealPatch = Partial<DealInput>;
