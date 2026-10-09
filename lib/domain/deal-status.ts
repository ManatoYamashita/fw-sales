/**
 * Deal.status に応じた金額 / 失注理由 / 再アプローチ可否の正規化 (customer-sales-progress-management, #297)。
 *
 * UI 側で status に応じて order_amount / lost_reason / reapproach の input を出し分けているため、
 * 非表示になったフィールドは FormData に含まれず、部分パッチ (formData.has() 判定) では
 * 旧値が残存してしまう。Server Action 側で status を単一の真実として、この関数で
 * 最終的な order_amount / lost_reason / reapproach を必ず再計算する。
 */
import type { DealStatus, Reapproach } from "@/types/deal";

export interface DealStatusAmounts {
  order_amount: number | null;
  lost_reason: string;
  reapproach: Reapproach | null;
}

export function normalizeDealStatusAmounts(
  status: DealStatus,
  candidate: DealStatusAmounts,
): DealStatusAmounts {
  if (status === "受注") return { order_amount: candidate.order_amount, lost_reason: "", reapproach: null };
  if (status === "失注") return { order_amount: null, lost_reason: candidate.lost_reason, reapproach: candidate.reapproach };
  return { order_amount: null, lost_reason: "", reapproach: null };
}
