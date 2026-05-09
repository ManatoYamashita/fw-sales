"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { type HandoffInput, type HandoffStatus } from "@/types/handoff";
import { today } from "@/lib/utils/date";
import {
  failure,
  readNumber,
  readString,
  success,
  type ActionResult,
} from "./_helpers";

function invalidate(handoffId?: string, storeId?: string) {
  revalidateTag(CACHE_TAGS.handoffs, "max");
  if (handoffId) revalidateTag(CACHE_TAGS.handoff(handoffId), "max");
  if (storeId) {
    revalidateTag(CACHE_TAGS.handoffsByStore(storeId), "max");
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");
  }
  revalidateTag(CACHE_TAGS.stats, "max");
  revalidateTag(CACHE_TAGS.kpi, "max");
  revalidateTag(CACHE_TAGS.actionQueue, "max");
}

function buildInput(
  formData: FormData,
  base: Pick<HandoffInput, "store_id" | "store_name" | "deal_id">,
  status: HandoffStatus = "運用確認待ち",
): HandoffInput {
  return {
    ...base,
    contract_services: readString(formData, "contract_services"),
    initial_fee: readNumber(formData, "initial_fee", 0),
    monthly_fee: readNumber(formData, "monthly_fee", 0),
    contract_period: readString(formData, "contract_period"),
    expected_result: readString(formData, "expected_result"),
    contract_owner: readString(formData, "contract_owner") || "佐藤(Firstweb)",
    caution: readString(formData, "caution"),
    ng_items: readString(formData, "ng_items"),
    due_date: readString(formData, "due_date"),
    materials_status: readString(formData, "materials_status"),
    ops_assignee: readString(formData, "ops_assignee"),
    contract_date: readString(formData, "contract_date") || today(),
    payment_confirmed: readString(formData, "payment_confirmed") || null,
    status,
  };
}

export async function createHandoffAction(
  dealId: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const deal = await repos.deal.get(dealId);
  if (!deal) return failure("商談が見つかりませんでした");

  const input = buildInput(formData, {
    store_id: deal.store_id,
    store_name: deal.store_name,
    deal_id: dealId,
  });

  try {
    // handoff create と店舗 stage 同期を 1 トランザクションで原子化
    // (research-handoff-db-migration §4.3, §4.4, §4.5)。
    const created = await repos.transaction(async ({ handoff, store }) => {
      const c = await handoff.create(input);
      await store.update(deal.store_id, { stage: "引き継ぎ待ち" });
      return c;
    });

    // tx 成功後にのみキャッシュ失効を実行。
    invalidate(created.id, deal.store_id);
    return success({ id: created.id }, "引き継ぎシートを作成しました");
  } catch (err) {
    return failure(err instanceof Error ? err.message : "作成に失敗しました");
  }
}

export async function updateHandoffAction(
  handoffId: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const current = await repos.handoff.get(handoffId);
  if (!current) return failure("引き継ぎが見つかりませんでした");

  const updated = await repos.handoff.update(handoffId, {
    contract_services: readString(formData, "contract_services"),
    initial_fee: readNumber(formData, "initial_fee", 0),
    monthly_fee: readNumber(formData, "monthly_fee", 0),
    contract_period: readString(formData, "contract_period"),
    expected_result: readString(formData, "expected_result"),
    contract_owner: readString(formData, "contract_owner"),
    caution: readString(formData, "caution"),
    ng_items: readString(formData, "ng_items"),
    due_date: readString(formData, "due_date"),
    materials_status: readString(formData, "materials_status"),
    ops_assignee: readString(formData, "ops_assignee"),
    contract_date: readString(formData, "contract_date"),
    payment_confirmed: readString(formData, "payment_confirmed") || null,
  });
  if (!updated) return failure("更新に失敗しました");

  invalidate(handoffId, current.store_id);
  return success({ id: handoffId }, "引き継ぎを更新しました");
}

export async function completeHandoffAction(
  handoffId: string,
): Promise<ActionResult> {
  const current = await repos.handoff.get(handoffId);
  if (!current) return failure("引き継ぎが見つかりませんでした");

  try {
    // handoff status 更新と店舗 stage 同期を 1 トランザクションで原子化
    // (research-handoff-db-migration §4.4, §4.5)。
    await repos.transaction(async ({ handoff, store }) => {
      await handoff.update(handoffId, { status: "完了" });
      await store.update(current.store_id, { stage: "引き継ぎ完了" });
    });

    // tx 成功後にのみキャッシュ失効を実行。
    invalidate(handoffId, current.store_id);
    return success(undefined, "運用への引き継ぎを完了しました");
  } catch (err) {
    return failure(err instanceof Error ? err.message : "完了に失敗しました");
  }
}

export async function deleteHandoffAction(
  handoffId: string,
): Promise<ActionResult> {
  const current = await repos.handoff.get(handoffId);
  if (!current) return failure("引き継ぎが見つかりませんでした");
  await repos.handoff.delete(handoffId);
  invalidate(handoffId, current.store_id);
  redirect("/handoffs");
}
