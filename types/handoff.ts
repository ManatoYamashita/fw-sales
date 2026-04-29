export type HandoffStatus = "運用確認待ち" | "完了";
export const HANDOFF_STATUSES: readonly HandoffStatus[] = [
  "運用確認待ち",
  "完了",
];

export interface Handoff {
  id: string;
  store_id: string;
  store_name: string;
  deal_id: string;
  contract_services: string;
  initial_fee: number;
  monthly_fee: number;
  contract_period: string;
  expected_result: string;
  contract_owner: string;
  caution: string;
  ng_items: string;
  due_date: string;
  materials_status: string;
  ops_assignee: string;
  contract_date: string;
  payment_confirmed: string | null;
  status: HandoffStatus;
  created_at: string;
  updated_at: string;
}

export type HandoffInput = Omit<Handoff, "id" | "created_at" | "updated_at">;
export type HandoffPatch = Partial<HandoffInput>;
