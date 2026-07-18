"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  DEAL_STATUSES, MEETING_TYPES, NEXT_ACTION_TYPES,
  type DealInput, type DealPatch, type DealStatus, type MeetingType, type NextActionType,
} from "@/types/deal";
import { today } from "@/lib/utils/date";
import { failure, readNullableNumber, readNullableString, readNumber, readString, success, type ActionResult } from "./_helpers";
import { requireAdmin } from "./_authz";

const ACTIVITY_MEMO_MAX = 5000;
const NEXT_ACTION_NOTE_MAX = 500;
const TEXT_MAX = 10000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

function isOneOf<T extends string>(value: string, values: readonly T[]): value is T {
  return (values as readonly string[]).includes(value);
}

async function requireSignedIn(): Promise<ActionResult<never> | null> {
  return (await getCurrentProfile()) ? null : failure("ログインが必要です");
}

function validateFields(formData: FormData): ActionResult<never> | null {
  const date = readString(formData, "date");
  const nextDate = readNullableString(formData, "next_action_date");
  const meetingType = readString(formData, "meeting_type");
  const status = readString(formData, "status");
  const nextType = readNullableString(formData, "next_action_type");
  if (formData.has("date") && !isValidYmd(date)) return failure("実施日は有効な日付 (YYYY-MM-DD) で入力してください");
  if (formData.has("next_action_date") && nextDate && !isValidYmd(nextDate)) return failure("次回アクション予定日は有効な日付 (YYYY-MM-DD) で入力してください");
  if (formData.has("meeting_type") && !isOneOf(meetingType, MEETING_TYPES)) return failure("活動種別が不正です");
  if (formData.has("status") && !isOneOf(status, DEAL_STATUSES)) return failure("営業状態が不正です");
  if (nextType && !isOneOf(nextType, NEXT_ACTION_TYPES)) return failure("次回アクション種別が不正です");
  for (const key of ["estimate_amount", "order_amount"] as const) {
    if (!formData.has(key) || readString(formData, key) === "") continue;
    const value = Number(readString(formData, key));
    if (!Number.isInteger(value) || value < 0) return failure("金額は0以上の整数で入力してください");
  }
  const activityMemo = readNullableString(formData, "activity_memo");
  const nextNote = readNullableString(formData, "next_action_note");
  if (activityMemo && activityMemo.length > ACTIVITY_MEMO_MAX) return failure("営業メモは5000文字以内で入力してください");
  if (nextNote && nextNote.length > NEXT_ACTION_NOTE_MAX) return failure("次回アクション内容は500文字以内で入力してください");
  for (const key of ["proposal", "discussion"] as const) if (readString(formData, key).length > TEXT_MAX) return failure("提案・ヒアリング内容は10000文字以内で入力してください");
  return null;
}

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

export async function createDealAction(storeId: string, _prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const denied = await requireSignedIn();
  if (denied) return denied;
  const invalid = validateFields(formData);
  if (invalid) return invalid;
  const store = await repos.store.get(storeId);
  if (!store) return failure("店舗が見つかりませんでした");
  const assigned = readNullableString(formData, "assigned_sales_user_id") ?? store.assigned_sales_user_id;
  if (assigned && !(await repos.profile.findById(assigned))) return failure("営業担当が見つかりませんでした");
  const input: DealInput = {
    store_id: storeId, store_name: store.name,
    date: readString(formData, "date") || today(),
    meeting_type: (readString(formData, "meeting_type") || "対面") as MeetingType,
    status: (readString(formData, "status") || "初回接触") as DealStatus,
    discussion: readString(formData, "discussion"), proposal: readString(formData, "proposal"),
    estimate_amount: readNumber(formData, "estimate_amount", 0), order_amount: readNullableNumber(formData, "order_amount"), lost_reason: readString(formData, "lost_reason"),
    assigned_sales_user_id: assigned,
    activity_memo: readNullableString(formData, "activity_memo"), next_action_date: readNullableString(formData, "next_action_date"), next_action_type: readNullableString(formData, "next_action_type") as NextActionType | null, next_action_note: readNullableString(formData, "next_action_note"),
  };
  try {
    const created = await repos.deal.create(input);
    invalidateDealScopes(created.id, storeId);
    return success({ id: created.id }, "営業記録を追加しました");
  } catch (error) {
    console.error("[salesActivity.create] failed", { storeId, message: error instanceof Error ? error.message : String(error) });
    return failure("営業記録の追加に失敗しました");
  }
}

export async function updateDealAction(dealId: string, _prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const denied = await requireSignedIn();
  if (denied) return denied;
  const invalid = validateFields(formData);
  if (invalid) return invalid;
  const current = await repos.deal.get(dealId);
  if (!current) return failure("営業記録が見つかりませんでした");
  const patch: DealPatch = {};
  const textFields = ["discussion", "proposal", "lost_reason"] as const;
  for (const key of textFields) if (formData.has(key)) patch[key] = readString(formData, key);
  if (formData.has("date")) patch.date = readString(formData, "date");
  if (formData.has("meeting_type")) patch.meeting_type = readString(formData, "meeting_type") as MeetingType;
  if (formData.has("status")) patch.status = readString(formData, "status") as DealStatus;
  if (formData.has("estimate_amount")) patch.estimate_amount = readNumber(formData, "estimate_amount", 0);
  if (formData.has("order_amount")) patch.order_amount = readNullableNumber(formData, "order_amount");
  if (formData.has("assigned_sales_user_id")) {
    const assigned = readNullableString(formData, "assigned_sales_user_id");
    if (assigned && !(await repos.profile.findById(assigned))) return failure("営業担当が見つかりませんでした");
    patch.assigned_sales_user_id = assigned;
  }
  if (formData.has("activity_memo")) patch.activity_memo = readNullableString(formData, "activity_memo");
  if (formData.has("next_action_date")) patch.next_action_date = readNullableString(formData, "next_action_date");
  if (formData.has("next_action_type")) patch.next_action_type = readNullableString(formData, "next_action_type") as NextActionType | null;
  if (formData.has("next_action_note")) patch.next_action_note = readNullableString(formData, "next_action_note");
  try {
    const updated = await repos.deal.update(dealId, patch);
    if (!updated) return failure("営業記録が見つかりませんでした");
    invalidateDealScopes(updated.id, current.store_id);
    return success({ id: updated.id }, "営業記録を更新しました");
  } catch (error) {
    console.error("[salesActivity.update] failed", { dealId, message: error instanceof Error ? error.message : String(error) });
    return failure("営業記録の更新に失敗しました");
  }
}

export async function deleteDealAction(dealId: string): Promise<ActionResult> {
  const guard = await requireAdmin("deals.delete");
  if (!guard.ok) return guard.denied;
  const current = await repos.deal.get(dealId);
  if (!current) return failure("営業記録が見つかりませんでした");
  await repos.deal.delete(dealId);
  invalidateDealScopes(dealId, current.store_id);
  console.log("[audit] deals.delete", { by: guard.profile.email, dealId });
  redirect(`/stores/${current.store_id}?tab=progress`);
}
