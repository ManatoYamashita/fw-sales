"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import {
  DEAL_STATUSES, MEETING_TYPES, NEXT_ACTION_TYPES,
  type DealInput, type DealPatch, type DealStatus, type MeetingType, type NextActionType,
} from "@/types/deal";
import type { StageId } from "@/types/stage";
import { todayInTimeZone } from "@/lib/utils/date";
import { normalizeDealStatusAmounts } from "@/lib/domain/deal-status";
import { failure, readNullableNumber, readNullableString, readNumber, readString, success, type ActionResult } from "./_helpers";
import { requireAdmin, requireSignedIn } from "./_authz";

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

/**
 * Deal 作成/更新時に自動昇格させる目標 stage。
 *
 * 現行の StageId は 4 段階 (未調査 → 調査済み → DeepResearch済み → 架電済み) のみで、
 * 旧 main の STAGE_BY_DEAL_STATUS が参照していた 商談化/見積提出/受注/失注 のような
 * DealStatus 別 stage はもう存在しない。営業記録 (どの DealStatus であっても) が
 * 作成/更新されたこと自体が「架電済み」を意味するため、全 DealStatus を一律で
 * この最終段階へ昇格させる。stage は決して後退させない (既に 架電済み ならそのまま)。
 */
const CONTACTED_STAGE: StageId = "架電済み";

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
  if (readString(formData, "lost_reason").length > TEXT_MAX) return failure("失注理由は10000文字以内で入力してください");
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
  const status = (readString(formData, "status") || "初回接触") as DealStatus;
  const statusAmounts = normalizeDealStatusAmounts(status, {
    order_amount: readNullableNumber(formData, "order_amount"),
    lost_reason: readString(formData, "lost_reason"),
  });
  const input: DealInput = {
    store_id: storeId, store_name: store.name,
    date: readString(formData, "date") || todayInTimeZone("Asia/Tokyo"),
    meeting_type: (readString(formData, "meeting_type") || "対面") as MeetingType,
    status,
    discussion: readString(formData, "discussion"), proposal: readString(formData, "proposal"),
    estimate_amount: readNumber(formData, "estimate_amount", 0), order_amount: statusAmounts.order_amount, lost_reason: statusAmounts.lost_reason,
    assigned_sales_user_id: assigned,
    activity_memo: readNullableString(formData, "activity_memo"), next_action_date: readNullableString(formData, "next_action_date"), next_action_type: readNullableString(formData, "next_action_type") as NextActionType | null, next_action_note: readNullableString(formData, "next_action_note"),
  };
  try {
    // Deal 作成 + (未到達の場合のみ) Store stage の "架電済み" への昇格を 1 トランザクションで
    // 実行する。失敗時は ROLLBACK されるため、tx 外側で invalidateDealScopes を呼ぶことで
    // 部分失敗時のキャッシュ汚染を防ぐ。
    const created = await repos.transaction(async ({ deal, store: storeTx }) => {
      const c = await deal.create(input);
      if (store.stage !== CONTACTED_STAGE) {
        await storeTx.update(storeId, { stage: CONTACTED_STAGE });
      }
      return c;
    });
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
  const textFields = ["discussion", "proposal"] as const;
  for (const key of textFields) if (formData.has(key)) patch[key] = readString(formData, key);
  if (formData.has("date")) patch.date = readString(formData, "date");
  if (formData.has("meeting_type")) patch.meeting_type = readString(formData, "meeting_type") as MeetingType;
  if (formData.has("status")) patch.status = readString(formData, "status") as DealStatus;
  if (formData.has("estimate_amount")) patch.estimate_amount = readNumber(formData, "estimate_amount", 0);
  // status に応じて order_amount / lost_reason を常に再計算する (現在値 + FormData の
  // 変更値 + 変更後 status から最終値を決定し、旧値の残存を防ぐ)。status / order_amount /
  // lost_reason のいずれも未送信ならこのブロック自体をスキップし、他フィールドのみの
  // 部分パッチを維持する。
  if (formData.has("status") || formData.has("order_amount") || formData.has("lost_reason")) {
    const finalStatus = (formData.has("status") ? readString(formData, "status") : current.status) as DealStatus;
    const statusAmounts = normalizeDealStatusAmounts(finalStatus, {
      order_amount: formData.has("order_amount") ? readNullableNumber(formData, "order_amount") : current.order_amount,
      lost_reason: formData.has("lost_reason") ? readString(formData, "lost_reason") : current.lost_reason,
    });
    patch.order_amount = statusAmounts.order_amount;
    patch.lost_reason = statusAmounts.lost_reason;
  }
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
    const store = await repos.store.get(current.store_id);
    // Store が既に "架電済み" ならプレーンな Deal 更新のみで済ませる。未到達の場合だけ
    // トランザクションで Deal 更新 + Store stage 昇格を原子的に行う。
    const updated = store && store.stage !== CONTACTED_STAGE
      ? await repos.transaction(async ({ deal, store: storeTx }) => {
          const u = await deal.update(dealId, patch);
          if (!u) throw new Error("営業記録が見つかりませんでした");
          await storeTx.update(current.store_id, { stage: CONTACTED_STAGE });
          return u;
        })
      : await repos.deal.update(dealId, patch);
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
