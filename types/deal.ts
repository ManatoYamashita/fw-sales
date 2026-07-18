export const ACTIVITY_TYPES = ["対面", "オンライン", "電話", "DM", "メール", "訪問", "社内メモ", "その他"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
/** DB列名との互換性を保つ既存alias。 */
export type MeetingType = ActivityType;
export const MEETING_TYPES: readonly MeetingType[] = ACTIVITY_TYPES;

export type DealStatus = "初回接触" | "アポ取得" | "継続追客" | "見積提出" | "失注" | "受注";
export const DEAL_STATUSES: readonly DealStatus[] = [
  "初回接触",
  "アポ取得",
  "継続追客",
  "見積提出",
  "失注",
  "受注",
];

export const NEXT_ACTION_TYPES = ["電話", "DM", "メール", "対面", "オンライン", "訪問", "資料送付", "見積確認", "社内確認", "その他"] as const;
export type NextActionType = (typeof NEXT_ACTION_TYPES)[number];

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
  activity_memo: string | null;
  next_action_date: string | null;
  next_action_type: NextActionType | null;
  next_action_note: string | null;
  created_at: string;
  updated_at: string;
}

export type DealInput = Omit<Deal, "id" | "created_at" | "updated_at">;
export type DealPatch = Partial<DealInput>;
