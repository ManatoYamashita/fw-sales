/**
 * Deal.status に応じた金額 / 失注理由フィールドの正規化 (customer-sales-progress-management)。
 *
 * UI 側で status に応じて order_amount / lost_reason の input を出し分けているため、
 * 非表示になったフィールドは FormData に含まれず、部分パッチ (formData.has() 判定) では
 * 旧値が残存してしまう。Server Action 側で status を単一の真実として、この関数で
 * 最終的な order_amount / lost_reason を必ず再計算する。
 */
import type { DealStatus } from "@/types/deal";

export interface DealStatusAmounts {
  order_amount: number | null;
  lost_reason: string;
}

export function normalizeDealStatusAmounts(
  status: DealStatus,
  candidate: DealStatusAmounts,
): DealStatusAmounts {
  if (status === "受注") return { order_amount: candidate.order_amount, lost_reason: "" };
  if (status === "失注") return { order_amount: null, lost_reason: candidate.lost_reason };
  return { order_amount: null, lost_reason: "" };
}
