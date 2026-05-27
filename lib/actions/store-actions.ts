"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { decideChannel } from "@/lib/domain/channel";
import {
  CHANNELS,
  CONTACT_FORMS,
  OPERATOR_TYPES,
  PRIORITIES,
  type Channel,
  type ContactForm,
  type OperatorType,
  type Priority,
  type StoreInput,
  type StorePatch,
} from "@/types/store";
import type { AiAnalysisResult } from "@/types/ai-analysis";
import { validateAiAnalysis } from "@/lib/ai/validate";
import { STAGE_IDS, type StageId } from "@/types/stage";
import {
  failure,
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  success,
  type ActionResult,
} from "./_helpers";

function asPriority(value: string): Priority {
  return (PRIORITIES as readonly string[]).includes(value)
    ? (value as Priority)
    : "中";
}

function asContactForm(value: string): ContactForm {
  return (CONTACT_FORMS as readonly string[]).includes(value)
    ? (value as ContactForm)
    : "未確認";
}

function asChannel(value: string): Channel | undefined {
  return (CHANNELS as readonly string[]).includes(value)
    ? (value as Channel)
    : undefined;
}

function asStage(value: string): StageId {
  return (STAGE_IDS as readonly string[]).includes(value)
    ? (value as StageId)
    : "未調査";
}

function asOperatorType(value: string): OperatorType {
  return (OPERATOR_TYPES as readonly string[]).includes(value)
    ? (value as OperatorType)
    : "未設定";
}

/**
 * FormData の `ai_analysis_result` フィールドから AI 分析結果を読出す。
 * - 空文字 / 不正な JSON / Zod スキーマ違反 はすべて `null` 扱いとし、保存処理は失敗させない
 * - クライアントが信頼境界の外で改ざんした入力を受け取った時の防御 (Req 7.3)
 */
function readNullableAiAnalysis(
  formData: FormData,
  key: string,
): AiAnalysisResult | null {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = validateAiAnalysis(parsed);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * FormData から StoreInput の共通フィールドを読み取る。
 * google_place_id は通常フォームに存在しないため含めない。
 * create 時は呼び出し側で `google_place_id: null` を付与する。
 * update 時はそのまま StorePatch として渡し、既存値を保持する。
 */
function buildStoreInput(formData: FormData): Omit<StoreInput, "google_place_id"> {
  const has_contact_form = asContactForm(readString(formData, "has_contact_form"));
  const channelInput = asChannel(readString(formData, "channel"));
  return {
    name: readString(formData, "name"),
    prefecture: readString(formData, "prefecture"),
    city: readString(formData, "city"),
    address: readString(formData, "address"),
    genre: readString(formData, "genre"),
    priority: asPriority(readString(formData, "priority")),
    stage: asStage(readString(formData, "stage") || "未調査"),
    has_contact_form,
    channel: channelInput ?? decideChannel(has_contact_form),
    map_url: readString(formData, "map_url"),
    site_url: readString(formData, "site_url"),
    instagram_url: readString(formData, "instagram_url"),
    phone: readString(formData, "phone"),
    target_service: readString(formData, "target_service"),
    review_count: readNumber(formData, "review_count", 0),
    review_avg: readNumber(formData, "review_avg", 0),
    memo: readString(formData, "memo"),
    // Phase 8 で旧 text 列 DROP 済。user_id 列のみを保持する。
    assigned_planner_user_id: readNullableString(formData, "assigned_planner_user_id"),
    assigned_sales_user_id: readNullableString(formData, "assigned_sales_user_id"),
    operator_type: asOperatorType(readString(formData, "operator_type")),
    operator_name: readString(formData, "operator_name"),
    ai_analysis_result: readNullableAiAnalysis(formData, "ai_analysis_result"),
    lat: readNullableNumber(formData, "lat"),
    lng: readNullableNumber(formData, "lng"),
    business_hours: readString(formData, "business_hours"),
  };
}

/**
 * StoreInput の `assigned_*_user_id` がいずれも有効な profile.id を指していることを
 * 検証する。`null` (未割当) は OK、UUID が profiles に存在しなければエラーメッセージを返す。
 * 不正値による FK 違反を Server Action 層で早期検出するための防御層。
 * 成功時は null を返す。
 */
async function validateAssignedUserIds(
  input: Pick<StoreInput, "assigned_planner_user_id" | "assigned_sales_user_id">,
): Promise<string | null> {
  const ids = [input.assigned_planner_user_id, input.assigned_sales_user_id].filter(
    (id): id is string => id !== null && id !== "",
  );
  for (const id of ids) {
    const profile = await repos.profile.findById(id);
    if (!profile) {
      return `担当者が見つかりませんでした (id: ${id})`;
    }
  }
  return null;
}

function invalidateAllStoreScopes(id?: string) {
  revalidateTag(CACHE_TAGS.stores, "max");
  revalidateTag(CACHE_TAGS.stats, "max");
  revalidateTag(CACHE_TAGS.pipeline, "max");
  revalidateTag(CACHE_TAGS.kpi, "max");
  revalidateTag(CACHE_TAGS.actionQueue, "max");
  if (id) revalidateTag(CACHE_TAGS.store(id), "max");
}

export async function createStoreAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const input: StoreInput = { ...buildStoreInput(formData), google_place_id: null };
  if (!input.name) return failure("店舗名を入力してください");
  const assigneeError = await validateAssignedUserIds(input);
  if (assigneeError) return failure(assigneeError);

  const created = await repos.store.create(input);
  invalidateAllStoreScopes(created.id);
  return success(
    { id: created.id },
    `「${created.name}」を登録しました`,
  );
}

export async function createStoreAndRedirect(formData: FormData) {
  const input: StoreInput = { ...buildStoreInput(formData), google_place_id: null };
  if (!input.name) {
    throw new Error("店舗名を入力してください");
  }
  const assigneeError = await validateAssignedUserIds(input);
  if (assigneeError) {
    throw new Error(assigneeError);
  }
  const created = await repos.store.create(input);
  invalidateAllStoreScopes(created.id);
  redirect(`/stores/${created.id}`);
}

export async function updateStoreAction(
  id: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const input = buildStoreInput(formData);
  if (!input.name) return failure("店舗名を入力してください");
  const assigneeError = await validateAssignedUserIds(input);
  if (assigneeError) return failure(assigneeError);
  const updated = await repos.store.update(id, input);
  if (!updated) return failure("店舗が見つかりませんでした");
  invalidateAllStoreScopes(id);
  return success({ id }, "更新しました");
}

export async function updateStoreStageAction(
  id: string,
  stage: StageId,
): Promise<ActionResult> {
  const updated = await repos.store.update(id, { stage });
  if (!updated) return failure("店舗が見つかりませんでした");
  invalidateAllStoreScopes(id);
  return success(undefined, `状態を「${stage}」に変更しました`);
}

/**
 * インライン編集用の Server Action。
 * 詳細画面の各セクションが部分パッチを直接送信し、原子的に更新する。
 *
 * - FormData ではなく直接 patch オブジェクトを受け取る(Server Action は object 引数 OK)
 * - patch に含まれないフィールドは現状維持
 * - 成功時は updated_at が当日に更新される(repository 側の責務)
 */
export async function updateStorePatchAction(
  id: string,
  patch: StorePatch,
): Promise<ActionResult> {
  const updated = await repos.store.update(id, patch);
  if (!updated) return failure("店舗が見つかりませんでした");
  invalidateAllStoreScopes(id);
  return success(undefined, "更新しました");
}

export async function deleteStoreAction(id: string): Promise<ActionResult> {
  const dealsToDelete = await repos.deal.list(id);
  try {
    await repos.transaction(async ({ deal, store }) => {
      for (const d of dealsToDelete) {
        await deal.delete(d.id);
      }
      const removed = await store.delete(id);
      if (!removed) throw new Error("店舗が見つかりませんでした");
    });
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "店舗の削除に失敗しました",
    );
  }
  invalidateAllStoreScopes(id);
  revalidateTag(CACHE_TAGS.deals, "max");
  revalidateTag(CACHE_TAGS.dealsByStore(id), "max");
  for (const d of dealsToDelete) {
    revalidateTag(CACHE_TAGS.deal(d.id), "max");
  }
  redirect("/stores");
}
