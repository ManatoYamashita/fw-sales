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
} from "@/types/store";
import type { AiAnalysisResult } from "@/types/ai-analysis";
import { validateAiAnalysis } from "@/lib/ai/validate";
import { STAGE_IDS, type StageId } from "@/types/stage";
import {
  failure,
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
    : "調査待ち";
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

function buildStoreInput(formData: FormData): StoreInput {
  const has_contact_form = asContactForm(readString(formData, "has_contact_form"));
  const channelInput = asChannel(readString(formData, "channel"));
  return {
    name: readString(formData, "name"),
    prefecture: readString(formData, "prefecture"),
    city: readString(formData, "city"),
    address: readString(formData, "address"),
    genre: readString(formData, "genre"),
    priority: asPriority(readString(formData, "priority")),
    stage: asStage(readString(formData, "stage") || "調査待ち"),
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
    assigned_planner: readString(formData, "assigned_planner"),
    assigned_sales: readString(formData, "assigned_sales"),
    operator_type: asOperatorType(readString(formData, "operator_type")),
    operator_name: readString(formData, "operator_name"),
    ai_analysis_result: readNullableAiAnalysis(formData, "ai_analysis_result"),
  };
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
  const input = buildStoreInput(formData);
  if (!input.name) return failure("店舗名を入力してください");

  const created = await repos.store.create(input);
  invalidateAllStoreScopes(created.id);
  return success(
    { id: created.id },
    `「${created.name}」を登録しました`,
  );
}

export async function createStoreAndRedirect(formData: FormData) {
  const input = buildStoreInput(formData);
  if (!input.name) {
    throw new Error("店舗名を入力してください");
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
  return success(undefined, `ステージを「${stage}」に変更しました`);
}

export async function deleteStoreAction(id: string): Promise<ActionResult> {
  const removed = await repos.store.delete(id);
  if (!removed) return failure("店舗が見つかりませんでした");
  invalidateAllStoreScopes();
  redirect("/stores");
}
