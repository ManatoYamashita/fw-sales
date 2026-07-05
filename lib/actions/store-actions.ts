"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { decideChannel } from "@/lib/domain/channel";
import { parsePostgresError, formatUserMessage } from "@/lib/db/postgres-error";
import {
  CHANNELS,
  CONTACT_FORMS,
  OPERATOR_TYPES,
  PRIORITIES,
  type Channel,
  type ContactForm,
  type OperatorType,
  type Priority,
  type StoreDeleteImpact,
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
import { requireAdmin } from "./_authz";

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
 * google_place_id / basic_info は通常フォームに存在しないため含めない。
 * create 時は呼び出し側で `google_place_id: null` と `basic_info: {}` を付与する。
 * update 時はそのまま StorePatch として渡し、既存値を保持する。
 */
function buildStoreInput(
  formData: FormData,
): Omit<StoreInput, "google_place_id" | "basic_info"> {
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

/**
 * `parsePostgresError` が null を返した場合に raw err の構造を Vercel logs に dump する
 * 診断ヘルパー。cause チェーン外の不明エラー (Drizzle / postgres-js の独自 wrapper、
 * fetch / network 系、想定外の generic error 等) を次回以降の障害分析で即特定できる
 * ようにする二段構え。PR #144 デプロイ後に UI が fallback 文言 ("店舗の削除に失敗しました")
 * になる症状を受けて追加 (2 段検出でもなお拾えない error 形状の最終手段ログ)。
 */
function dumpUnrecognizedErrorShape(scope: string, err: unknown) {
  const r = err as Record<string, unknown> | null;
  const cause = r?.cause as Record<string, unknown> | undefined;
  console.error(`${scope} unrecognized error shape`, {
    name: r?.name,
    constructor: (err as { constructor?: { name?: string } })?.constructor
      ?.name,
    keys: r ? Object.keys(r) : [],
    cause_name: cause?.name,
    cause_code: cause?.code,
    cause_constructor: (cause as { constructor?: { name?: string } } | undefined)
      ?.constructor?.name,
    raw_message: r?.message,
  });
}

export async function createStoreAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const input: StoreInput = {
    ...buildStoreInput(formData),
    google_place_id: null,
    basic_info: {},
  };
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
  const input: StoreInput = {
    ...buildStoreInput(formData),
    google_place_id: null,
    basic_info: {},
  };
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

/**
 * 削除確認ダイアログ向けに、店舗群へ紐づく子データのカテゴリ別件数を返す読み取り系
 * Server Action (store-cascade-delete / Issue #152)。
 *
 * - `bulkDeleteStoresAction` と同一の ID 正規化 (空・非文字列の除外 + 重複排除)
 * - 読み取り専用: `'use cache'` も `revalidateTag` も使わず、常に呼び出し時点の実データを返す
 * - 失敗時は診断情報 (SQLSTATE / constraint 等) を構造化ログにのみ残し、UI へは
 *   内部スキーマ情報を含まない汎用文言のみ返す (delete 系と同じ二系統設計)
 */
export async function getStoreDeleteImpactAction(
  ids: readonly string[],
): Promise<ActionResult<StoreDeleteImpact>> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return failure("削除対象の店舗が指定されていません");
  }
  const uniqueIds = [
    ...new Set(ids.filter((id) => typeof id === "string" && id.trim() !== "")),
  ];
  if (uniqueIds.length === 0) {
    return failure("削除対象の店舗が指定されていません");
  }

  try {
    const impact = await repos.store.getDeleteImpact(uniqueIds);
    return success(impact);
  } catch (err) {
    const parsed = parsePostgresError(err);
    // Vercel logs に SQLSTATE / detail / constraint を必ず残し、UI 用の文言とは分離する
    console.error("[stores.deleteImpact] failed", {
      requestedCount: uniqueIds.length,
      sample: uniqueIds.slice(0, 3),
      code: parsed?.code,
      detail: parsed?.detail,
      constraint: parsed?.constraint,
      table: parsed?.table,
      message:
        parsed?.message ?? (err instanceof Error ? err.message : String(err)),
    });
    if (parsed === null) dumpUnrecognizedErrorShape("[stores.deleteImpact]", err);
    return failure("紐づけデータの件数を取得できませんでした");
  }
}

export async function deleteStoreAction(id: string): Promise<ActionResult> {
  const guard = await requireAdmin("stores.delete");
  if (!guard.ok) return guard.denied;
  try {
    const removed = await repos.store.delete(id);
    if (!removed) return failure("店舗が見つかりませんでした");
  } catch (err) {
    const parsed = parsePostgresError(err);
    // Vercel logs に SQLSTATE / detail / constraint を必ず残し、UI 用の文言とは分離する
    console.error("[stores.delete] failed", {
      id,
      code: parsed?.code,
      detail: parsed?.detail,
      constraint: parsed?.constraint,
      table: parsed?.table,
      message:
        parsed?.message ?? (err instanceof Error ? err.message : String(err)),
    });
    if (parsed === null) dumpUnrecognizedErrorShape("[stores.delete]", err);
    return failure(formatUserMessage(parsed, "店舗の削除に失敗しました"));
  }
  // 関連レコード (商談 / 調査 / 引き継ぎ) は FK の ON DELETE CASCADE (migration 0021 で
  // 再宣言 / #152) により連鎖削除され、場所候補は SET NULL で紐付け解除される。
  // task 4.2 (PR3a): Deep Research タグは撤去 (#121 / #110 連動)。
  invalidateAllStoreScopes(id);
  revalidateTag(CACHE_TAGS.deals, "max");
  revalidateTag(CACHE_TAGS.dealsByStore(id), "max");
  revalidateTag(CACHE_TAGS.research, "max");
  revalidateTag(CACHE_TAGS.researchByStore(id), "max");
  revalidateTag(CACHE_TAGS.handoffs, "max");
  revalidateTag(CACHE_TAGS.handoffsByStore(id), "max");
  console.log("[audit] stores.delete", { by: guard.profile.email, id });
  redirect("/stores");
}

export interface BulkDeleteStoresResult {
  deletedCount: number;
  requestedCount: number;
}

/**
 * 店舗を一括削除する。関連レコード (商談 / 調査 / 引き継ぎ) は FK の
 * ON DELETE CASCADE (migration 0021 で再宣言 / #152) により連鎖削除され、
 * 場所候補は SET NULL で紐付け解除される。
 * 一覧ページに留まるため redirect せず、呼び出し側で router.refresh() する想定。
 */
export async function bulkDeleteStoresAction(
  ids: string[],
): Promise<ActionResult<BulkDeleteStoresResult>> {
  const guard = await requireAdmin("stores.bulkDelete");
  if (!guard.ok) return guard.denied;
  if (!Array.isArray(ids) || ids.length === 0) {
    return failure("削除対象の店舗が指定されていません");
  }
  const uniqueIds = [
    ...new Set(ids.filter((id) => typeof id === "string" && id.trim() !== "")),
  ];
  if (uniqueIds.length === 0) {
    return failure("削除対象の店舗が指定されていません");
  }

  let deletedCount: number;
  try {
    deletedCount = await repos.store.bulkDelete(uniqueIds);
  } catch (err) {
    const parsed = parsePostgresError(err);
    // Vercel logs に SQLSTATE / detail / constraint を必ず残し、UI 用の文言とは分離する。
    // sample は ID 全列挙を避けつつ調査の手掛かりに先頭 3 件のみ残す。
    console.error("[stores.bulkDelete] failed", {
      requestedCount: uniqueIds.length,
      sample: uniqueIds.slice(0, 3),
      code: parsed?.code,
      detail: parsed?.detail,
      constraint: parsed?.constraint,
      table: parsed?.table,
      message:
        parsed?.message ?? (err instanceof Error ? err.message : String(err)),
    });
    if (parsed === null) dumpUnrecognizedErrorShape("[stores.bulkDelete]", err);
    return failure(formatUserMessage(parsed, "店舗の削除に失敗しました"));
  }

  // 集合タグを広く revalidate する。
  // task 4.2 (PR3a): Deep Research タグは撤去 (#121 / #110 連動)。
  invalidateAllStoreScopes();
  revalidateTag(CACHE_TAGS.deals, "max");
  revalidateTag(CACHE_TAGS.research, "max");
  revalidateTag(CACHE_TAGS.handoffs, "max");
  // 各店舗スコープの *ByStore タグも削除 ID 分だけ飛ばし、単一削除 (deleteStoreAction) と
  // 対称にする。これらでタグ付けされた店舗詳細側のキャッシュが古い関連データを返すのを防ぐ。
  for (const id of uniqueIds) {
    revalidateTag(CACHE_TAGS.store(id), "max");
    revalidateTag(CACHE_TAGS.dealsByStore(id), "max");
    revalidateTag(CACHE_TAGS.researchByStore(id), "max");
    revalidateTag(CACHE_TAGS.handoffsByStore(id), "max");
  }

  console.log("[audit] stores.bulkDelete", {
    by: guard.profile.email,
    requestedCount: uniqueIds.length,
    deletedCount,
    sample: uniqueIds.slice(0, 3),
  });
  return success({ deletedCount, requestedCount: uniqueIds.length });
}
