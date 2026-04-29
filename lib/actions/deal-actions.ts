"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import {
  DEAL_STATUSES,
  MEETING_TYPES,
  type DealInput,
  type DealStatus,
  type MeetingType,
} from "@/types/deal";
import type { StageId } from "@/types/stage";
import { today } from "@/lib/utils/date";
import {
  failure,
  readNullableNumber,
  readNumber,
  readString,
  success,
  type ActionResult,
} from "./_helpers";

function asMeetingType(v: string): MeetingType {
  return (MEETING_TYPES as readonly string[]).includes(v)
    ? (v as MeetingType)
    : "対面";
}

function asDealStatus(v: string): DealStatus {
  return (DEAL_STATUSES as readonly string[]).includes(v)
    ? (v as DealStatus)
    : "継続追客";
}

const STAGE_BY_DEAL_STATUS: Record<DealStatus, StageId> = {
  継続追客: "商談化",
  見積提出: "見積提出",
  受注: "受注",
  失注: "失注",
};

function invalidateDealScopes(dealId?: string, storeId?: string) {
  revalidateTag(CACHE_TAGS.deals, "max");
  if (dealId) revalidateTag(CACHE_TAGS.deal(dealId), "max");
  if (storeId) {
    revalidateTag(CACHE_TAGS.dealsByStore(storeId), "max");
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");
  }
  revalidateTag(CACHE_TAGS.stats, "max");
  revalidateTag(CACHE_TAGS.kpi, "max");
  revalidateTag(CACHE_TAGS.pipeline, "max");
}

export async function createDealAction(
  storeId: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const store = await repos.store.get(storeId);
  if (!store) return failure("店舗が見つかりませんでした");

  const status = asDealStatus(readString(formData, "status") || "継続追客");
  const input: DealInput = {
    store_id: storeId,
    store_name: store.name,
    date: readString(formData, "date") || today(),
    meeting_type: asMeetingType(readString(formData, "meeting_type")),
    discussion: readString(formData, "discussion"),
    proposal: readString(formData, "proposal"),
    estimate_amount: readNumber(formData, "estimate_amount", 0),
    order_amount: readNullableNumber(formData, "order_amount"),
    lost_reason: readString(formData, "lost_reason"),
    status,
    assigned_sales: readString(formData, "assigned_sales") || store.assigned_sales,
  };

  const created = await repos.deal.create(input);

  // store.stage を商談ステージへ同期
  const targetStage = STAGE_BY_DEAL_STATUS[status];
  if (store.stage !== targetStage) {
    await repos.store.update(storeId, { stage: targetStage });
  }

  invalidateDealScopes(created.id, storeId);
  return success({ id: created.id }, "商談を作成しました");
}

export async function updateDealAction(
  dealId: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const current = await repos.deal.get(dealId);
  if (!current) return failure("商談が見つかりませんでした");

  const status = asDealStatus(readString(formData, "status"));
  const updated = await repos.deal.update(dealId, {
    status,
    discussion: readString(formData, "discussion"),
    proposal: readString(formData, "proposal"),
    estimate_amount: readNumber(formData, "estimate_amount", 0),
    order_amount: readNullableNumber(formData, "order_amount"),
    lost_reason: readString(formData, "lost_reason"),
  });
  if (!updated) return failure("更新に失敗しました");

  // 受注/失注の場合は store.stage を同期
  const targetStage = STAGE_BY_DEAL_STATUS[status];
  await repos.store.update(current.store_id, { stage: targetStage });

  invalidateDealScopes(dealId, current.store_id);
  return success({ id: dealId }, "商談を更新しました");
}

export async function deleteDealAction(dealId: string): Promise<ActionResult> {
  const current = await repos.deal.get(dealId);
  if (!current) return failure("商談が見つかりませんでした");
  await repos.deal.delete(dealId);
  invalidateDealScopes(dealId, current.store_id);
  redirect("/deals");
}
