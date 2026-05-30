"use server";

/**
 * Deep Research パイプライン Server Actions (deep-research-pipeline spec, Issue #43)
 *
 * - `enqueueDeepResearchAction(storeId)`: 1 店舗単位でジョブをキュー登録
 * - `retryDeepResearchAction(failedJobId)`: 失敗ジョブを新規行として再投入
 *
 * 登録時の検証順序 (design.md §enqueueDeepResearchAction):
 *   ① 認証 (getCurrentSession)
 *   ② 店舗の必須項目 (name のみ) 取得 — 所在地等は任意
 *   ③ 重複ジョブ検出 (findActiveByStore)
 *   ④ 日次上限 (countByUserSinceDay)
 *   ⑤ 月次上限 (countByMonth)
 *   ⑥ insertJob + revalidateTag
 *
 * 失敗時は `ActionResult.failure(message)` を返し DB 状態は変更しない。
 * 自動リトライは行わない (R5.6) — 失敗ジョブからの再実行は本ファイルの
 * `retryDeepResearchAction` のみが起動する。
 *
 * 関連: design.md §Components and Interfaces / enqueueDeepResearchAction +
 *       retryDeepResearchAction, requirements.md §1.1, §1.2, §1.3, §1.5,
 *       §5.5, §5.6, §6.1, §6.2
 */

import "server-only";

import { revalidateTag } from "next/cache";
import { failure, success, type ActionResult } from "./_helpers";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentSession } from "@/lib/supabase/server";
import { getDailyUserCap, getMonthlyCap } from "@/lib/env";
import type { JobStatus } from "@/types/deep-research";

export interface EnqueueResult {
  jobId: string;
  status: JobStatus;
  duplicateOf?: string;
}

export interface RetryResult {
  newJobId: string;
  previousJobId: string;
}

/**
 * 指定店舗を Deep Research キューに登録する。
 *
 * - 認証ユーザー (`getCurrentSession`) が呼ぶことを前提
 * - 重複ジョブ・上限超過時は `ActionResult.failure` で詳細メッセージを返す
 * - 成功時に `CACHE_TAGS.deepResearchByStore(storeId)` を revalidate
 */
export async function enqueueDeepResearchAction(
  storeId: string,
): Promise<ActionResult<EnqueueResult>> {
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return failure("店舗 ID が指定されていません");
  }

  // ① 認証
  const session = await getCurrentSession();
  if (!session) {
    return failure("Deep Research の登録にはログインが必要です");
  }

  // ② 店舗の必須項目チェック (R1.3)
  // 必須は店舗名のみ。所在地など他の項目は Stage 1 の Deep Research AI が
  // 公開情報からベストエフォートで補完するため、未入力でも登録を許可する。
  const store = await repos.store.get(storeId);
  if (!store) {
    return failure("対象店舗が見つかりません");
  }
  if (!store.name || store.name.trim() === "") {
    return failure("必須項目が未入力です: 店舗名");
  }

  // ③ 重複ジョブ検出 (R1.2)
  const active = await repos.deepResearch.findActiveByStore(storeId);
  if (active) {
    return failure(
      `この店舗には既に進行中のジョブがあります (status=${active.status})`,
    );
  }

  // ④ 日次上限 (R6.1)
  const dailyCap = getDailyUserCap();
  const startOfTodayJst = startOfTodayJstAsUtc();
  const dailyCount = await repos.deepResearch.countByUserSinceDay(
    session.userId,
    startOfTodayJst,
  );
  if (dailyCount >= dailyCap) {
    return failure(
      `本日の登録上限 (${dailyCap} 件/日) に達しました。明日以降に再度お試しください`,
    );
  }

  // ⑤ 月次上限 (R6.2)
  const monthlyCap = getMonthlyCap();
  const yearMonthJst = currentYearMonthJst();
  const monthlyCount = await repos.deepResearch.countByMonth(yearMonthJst);
  if (monthlyCount >= monthlyCap) {
    return failure(
      `今月の総ジョブ上限 (${monthlyCap} 件/月) に達しました。来月以降に再度お試しください`,
    );
  }

  // ⑥ insertJob + revalidate
  const job = await repos.deepResearch.insertJob({
    store_id: storeId,
    user_id: session.userId,
  });
  revalidateTag(CACHE_TAGS.deepResearchByStore(storeId), "max");
  revalidateTag(CACHE_TAGS.deepResearchJob(job.id), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  return success({ jobId: job.id, status: job.status });
}

/**
 * 失敗ジョブから新規ジョブを作る (元行は touch しない、R5.6 監査性確保)。
 */
export async function retryDeepResearchAction(
  failedJobId: string,
): Promise<ActionResult<RetryResult>> {
  if (typeof failedJobId !== "string" || failedJobId.trim() === "") {
    return failure("ジョブ ID が指定されていません");
  }

  const session = await getCurrentSession();
  if (!session) {
    return failure("再投入にはログインが必要です");
  }

  const original = await repos.deepResearch.getById(failedJobId);
  if (!original) {
    return failure("対象ジョブが見つかりません");
  }
  if (original.status !== "failed") {
    return failure(
      `再投入は failed 状態のジョブのみ可能です (現在: ${original.status})`,
    );
  }

  // 既に同店舗で進行中の新ジョブがある場合は重複拒否 (retry 連打防止)
  const active = await repos.deepResearch.findActiveByStore(original.store_id);
  if (active) {
    return failure(
      `この店舗には既に進行中のジョブがあります (status=${active.status})`,
    );
  }

  // 日次/月次上限は通常 enqueue と同等に判定
  const dailyCap = getDailyUserCap();
  const dailyCount = await repos.deepResearch.countByUserSinceDay(
    session.userId,
    startOfTodayJstAsUtc(),
  );
  if (dailyCount >= dailyCap) {
    return failure(
      `本日の登録上限 (${dailyCap} 件/日) に達しました。明日以降に再度お試しください`,
    );
  }
  const monthlyCap = getMonthlyCap();
  const monthlyCount = await repos.deepResearch.countByMonth(
    currentYearMonthJst(),
  );
  if (monthlyCount >= monthlyCap) {
    return failure(
      `今月の総ジョブ上限 (${monthlyCap} 件/月) に達しました`,
    );
  }

  const newJob = await repos.deepResearch.insertJob({
    store_id: original.store_id,
    user_id: session.userId,
  });
  revalidateTag(CACHE_TAGS.deepResearchByStore(original.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchJob(newJob.id), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  return success({ newJobId: newJob.id, previousJobId: failedJobId });
}

// ---------------------------------------------------------------------------
// キャンセル / 削除
// ---------------------------------------------------------------------------

/**
 * queued / researching のジョブをキャンセルする。
 * researching の場合は Google API の cancelTask も呼ぶ (best-effort)。
 */
export async function cancelDeepResearchJobAction(
  jobId: string,
): Promise<ActionResult<void>> {
  "use server";

  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const job = await repos.deepResearch.getById(jobId);
  if (!job) return failure("ジョブが見つかりません");
  if (job.status !== "queued" && job.status !== "researching") {
    return failure(`キャンセルできるのは queued / researching のみです (現在: ${job.status})`);
  }

  if (job.status === "researching" && job.deep_research_task_id) {
    const { createDeepResearchClient } = await import(
      "@/lib/ai/deep-research/client"
    );
    const client = createDeepResearchClient();
    const cancelResult = await client.cancelTask(
      { taskId: job.deep_research_task_id },
      AbortSignal.timeout(10_000),
    );
    await repos.deepResearch.appendJobError(jobId, {
      stage: "stage1",
      kind: "manual_cancel",
      message: `ユーザー (${session.userId}) がキャンセル`,
      occurred_at: new Date().toISOString(),
      cancel_result: cancelResult,
    });
  } else {
    await repos.deepResearch.appendJobError(jobId, {
      stage: "stage1",
      kind: "manual_cancel",
      message: `ユーザー (${session.userId}) がキャンセル`,
      occurred_at: new Date().toISOString(),
    });
  }

  await repos.deepResearch.updateJobStatus(jobId, {
    status: "failed",
    completed_at: new Date().toISOString(),
  });
  revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchJob(jobId), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  return success(undefined);
}

/**
 * failed ジョブを物理削除する。
 */
export async function deleteDeepResearchJobAction(
  jobId: string,
): Promise<ActionResult<void>> {
  "use server";

  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const job = await repos.deepResearch.getById(jobId);
  if (!job) return failure("ジョブが見つかりません");
  if (job.deleted_at) {
    return failure("このジョブは既に削除済みです");
  }

  const deleted = await repos.deepResearch.softDeleteJob(jobId, session.userId);
  if (!deleted) return failure("削除に失敗しました");

  revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchJob(jobId), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  return success(undefined);
}

/**
 * 任意ステータスのジョブを 1 件論理削除する (`/research` 一覧用)。
 */
export async function softDeleteDeepResearchJobAction(
  jobId: string,
): Promise<ActionResult<void>> {
  "use server";

  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  if (typeof jobId !== "string" || jobId.trim() === "") {
    return failure("ジョブ ID が指定されていません");
  }

  const job = await repos.deepResearch.getById(jobId);
  if (!job) return failure("ジョブが見つかりません");
  if (job.deleted_at) return failure("このジョブは既に削除済みです");

  const deleted = await repos.deepResearch.softDeleteJob(jobId, session.userId);
  if (!deleted) return failure("削除に失敗しました");

  revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchJob(jobId), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  return success(undefined);
}

export interface SoftDeleteBulkResult {
  deletedCount: number;
  requestedCount: number;
}

/**
 * 指定ジョブを一括で論理削除する (`/research` 一覧の複数選択用)。
 */
export async function softDeleteDeepResearchJobsAction(
  jobIds: string[],
): Promise<ActionResult<SoftDeleteBulkResult>> {
  "use server";

  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return failure("削除対象のジョブが指定されていません");
  }

  const uniqueIds = [...new Set(jobIds.filter((id) => typeof id === "string"))];
  if (uniqueIds.length === 0) {
    return failure("削除対象のジョブが指定されていません");
  }

  const jobs = await Promise.all(
    uniqueIds.map(async (id) => repos.deepResearch.getById(id)),
  );
  const storeIds = new Set(
    jobs
      .filter((job): job is NonNullable<typeof job> => Boolean(job))
      .map((job) => job.store_id),
  );

  const deletedCount = await repos.deepResearch.softDeleteJobs(
    uniqueIds,
    session.userId,
  );

  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  for (const storeId of storeIds) {
    revalidateTag(CACHE_TAGS.deepResearchByStore(storeId), "max");
  }
  for (const jobId of uniqueIds) {
    revalidateTag(CACHE_TAGS.deepResearchJob(jobId), "max");
  }

  return success({
    deletedCount,
    requestedCount: uniqueIds.length,
  });
}

// ---------------------------------------------------------------------------
// Gemini ライブ問合せ (ジョブ詳細ページの「Gemini ライブ状態」Card 用)
// ---------------------------------------------------------------------------

export interface PollGeminiResult {
  jobId: string;
  state: "in_progress" | "completed" | "failed";
  /** Gemini Interaction の `created` フィールド (タスク受領時刻)。null = 未公開。 */
  apiCreatedAt: string | null;
  /** Gemini Interaction の `updated` フィールド (Google 側 state 最終更新)。 */
  apiUpdatedAt: string | null;
  /**
   * Gemini Interaction の `usage`。null は **Google 側でトークン消費ゼロ**
   * であることを示し、dead-lock 検出シグナルになる
   * (2026-05-30 mpsh1mj9 事例: created === updated かつ usage=null で 2h+ 経過)。
   */
  tokenUsage: { promptTokens: number; outputTokens: number } | null;
  polledAt: string;
  message?: string;
}

/**
 * 研究中ジョブの Gemini Interaction を 1 回ポーリングし、status と
 * `api_updated_at` を返す。 `done` / `failed` / `queued` / `structuring`
 * は早期 return で Gemini を呼ばない。
 *
 * - status 遷移は本アクションでは行わない (cron pipeline `pollOneResearching`
 *   に任せる)。Stage 2 構造化は重いため Server Action timeout のリスクを避ける。
 * - `in_progress` / `completed` で `apiUpdatedAt` が取れたら DB に書き戻す。
 *   これは cron pipeline の適応型ポーリング間隔判定 (`shouldPollJob`) と
 *   整合させるため (重複 Gemini 呼出を抑止する設計意図と一致)。
 * - `failed` のときは status を遷移させず `appendJobError` で監査ログに残す。
 *   実 status 遷移は次 cron tick が同じレスポンスを見て `markFailed` を呼ぶ。
 */
export async function pollGeminiJobAction(
  jobId: string,
): Promise<ActionResult<PollGeminiResult>> {
  "use server";

  if (typeof jobId !== "string" || jobId.trim() === "") {
    return failure("ジョブ ID が指定されていません");
  }

  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const job = await repos.deepResearch.getById(jobId);
  if (!job) return failure("ジョブが見つかりません");

  if (job.status === "done" || job.status === "failed") {
    return failure("完了/失敗ジョブは Gemini に問合せできません");
  }
  if (job.status === "queued" || !job.deep_research_task_id) {
    return failure("まだ Gemini に投入されていません");
  }
  if (job.status === "structuring") {
    return failure("Stage 2 構造化中のため Gemini への問合せはスキップします");
  }

  const { createDeepResearchClient } = await import(
    "@/lib/ai/deep-research/client"
  );
  const client = createDeepResearchClient();

  const polledAt = new Date().toISOString();
  try {
    const state = await client.getTask(
      { taskId: job.deep_research_task_id },
      AbortSignal.timeout(15_000),
    );

    if (state.state === "in_progress" && state.apiUpdatedAt) {
      await repos.deepResearch.updateJobStatus(jobId, {
        status: "researching",
        api_updated_at: state.apiUpdatedAt,
      });
    } else if (state.state === "completed") {
      await repos.deepResearch.updateJobStatus(jobId, {
        status: "researching",
        api_updated_at: state.apiUpdatedAt ?? polledAt,
      });
    } else if (state.state === "failed") {
      await repos.deepResearch.appendJobError(jobId, {
        stage: "stage1",
        kind: "manual_poll_stage1_failed",
        message: state.reason,
        occurred_at: polledAt,
      });
    }

    revalidateTag(CACHE_TAGS.deepResearchJob(jobId), "max");

    // 生レスポンスの主要メタデータを呼出側 (Card) へ公開する。
    // `tokenUsage === null` かつ `apiCreatedAt === apiUpdatedAt` で経過時間が
    // 長い場合は Google 側で処理が始まっていない可能性が高い (dead-lock)。
    const apiCreatedAt = state.apiCreatedAt ?? null;
    const apiUpdatedAt = state.apiUpdatedAt ?? null;
    const tokenUsage = state.tokenUsage ?? null;
    return success({
      jobId,
      state: state.state,
      apiCreatedAt,
      apiUpdatedAt,
      tokenUsage,
      polledAt,
      ...(state.state === "failed" ? { message: state.reason } : {}),
    });
  } catch (err) {
    const kind = inferErrorKind(err);
    const message = summarizeError(err);
    await repos.deepResearch.appendJobError(jobId, {
      stage: "stage1",
      kind: `manual_poll_${kind}`,
      message,
      occurred_at: polledAt,
    });
    revalidateTag(CACHE_TAGS.deepResearchJob(jobId), "max");
    return failure(`Gemini API 呼出に失敗しました (${kind})`);
  }
}

export interface JobStatusSnapshot {
  status: JobStatus;
  taskId: string | null;
}

/**
 * ジョブの現在 status / task_id を読み取り専用で返す (詳細ページの自動リフレッシュ判定用)。
 *
 * - poll tick は発火しない。`getById` で DB 最新を直接読み (`"use cache"` を経由しない)、
 *   背景 tick がジョブを進めたかをクライアントが軽量に検知できるようにする。
 * - クライアント (`JobAutoRefresh`) は本 status が前回値と変わった瞬間だけ
 *   `router.refresh()` を呼ぶため、`structuring` の Stage 2 が `after()` 経由で
 *   並行二重起動する事故を避けられる (refresh = ページ再描画 = `after()` 再発火のため)。
 */
export async function getDeepResearchJobStatusAction(
  jobId: string,
): Promise<ActionResult<JobStatusSnapshot>> {
  "use server";

  if (typeof jobId !== "string" || jobId.trim() === "") {
    return failure("ジョブ ID が指定されていません");
  }

  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const job = await repos.deepResearch.getById(jobId);
  if (!job) return failure("ジョブが見つかりません");

  return success({ status: job.status, taskId: job.deep_research_task_id });
}

function inferErrorKind(err: unknown): string {
  if (typeof err === "object" && err !== null && "kind" in err) {
    return String((err as { kind: unknown }).kind);
  }
  return "unknown";
}

function summarizeError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.kind === "string") {
      const status =
        typeof obj.status === "number" ? ` (HTTP ${obj.status})` : "";
      return `${obj.kind}${status}`;
    }
  }
  return "Gemini API 呼出で不明なエラーが発生";
}

// ---------------------------------------------------------------------------
// 時刻ヘルパ (JST 日次/月次集計)
// ---------------------------------------------------------------------------

/**
 * 現在の JST 日の 00:00:00 を UTC の `Date` として返す。
 * `countByUserSinceDay` に渡す閾値として使用 (JST 暦日基準)。
 */
function startOfTodayJstAsUtc(): Date {
  const now = new Date();
  // JST = UTC+9。`now` を UTC で見て、JST 当日の 00:00 (UTC では前日 15:00) を計算。
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  jstDate.setUTCHours(0, 0, 0, 0);
  // JST 0 時 → UTC 前日 15 時
  return new Date(jstDate.getTime() - 9 * 60 * 60 * 1000);
}

/** 現在の JST 月を `YYYY-MM` で返す。 */
function currentYearMonthJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}
