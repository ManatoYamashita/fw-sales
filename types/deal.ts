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
   * @deprecated Phase 7 で `assigned_sales_user_id` に移行済。
   * 段階移行中(Phase 7-8)は DB の text 列が並存するため型に残すが、
   * Phase 8(0005 マイグレーション)で本フィールドおよび DB 列を削除する。
   */
  assigned_sales: string;
  /**
   * 営業担当ユーザー参照 (auth-and-notifications Phase 7 でアプリ層の主参照に昇格)。
   * `null` は未割当。`profiles.id` (uuid) を保持し、表示時は `getProfileById` で
   * 名前解決する。Phase 8 で旧 `assigned_sales` 列 DROP 後はこれが唯一の担当者参照。
   */
  assigned_sales_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export type DealInput = Omit<Deal, "id" | "created_at" | "updated_at">;
export type DealPatch = Partial<DealInput>;
