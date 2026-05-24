"use server";

/**
 * Deep Research パイプライン Server Actions (deep-research-pipeline spec, Issue #43)
 *
 * - `enqueueDeepResearchAction(storeId)`: 1 店舗単位でジョブをキュー登録
 * - `retryDeepResearchAction(failedJobId)`: 失敗ジョブを新規行として再投入
 *
 * 登録時の検証順序 (design.md §enqueueDeepResearchAction):
 *   ① 認証 (getCurrentSession)
 *   ② 店舗の必須項目 (name, address) 取得
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
  const store = await repos.store.get(storeId);
  if (!store) {
    return failure("対象店舗が見つかりません");
  }
  const missing: string[] = [];
  if (!store.name || store.name.trim() === "") missing.push("店舗名");
  if (
    !store.address ||
    store.address.trim() === "" ||
    !store.prefecture ||
    !store.city
  ) {
    missing.push("所在地");
  }
  if (missing.length > 0) {
    return failure(`必須項目が未入力です: ${missing.join(", ")}`);
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
  return success({ newJobId: newJob.id, previousJobId: failedJobId });
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
