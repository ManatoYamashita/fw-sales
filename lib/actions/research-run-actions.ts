"use server";

/**
 * AI 店舗調査 run の起動 Server Action(AI 店舗調査再設計 Plan v3.2, PR3)。
 *
 * `/research/[storeId]` の「AIで店舗を調査」ボタンから呼ばれる想定(UI結線はPR4)。
 * `store_research_runs` を1行作成し、Vercel Workflow(`workflows/store-research.ts`)を
 * 起動する。`start()` は起動をenqueueして即座に返る(fire-and-forget、Plan §16)。
 *
 * 二重実行防止: (1) `getLatestForStore` で早期チェックしユーザーへ分かりやすいメッセージを
 * 返す、(2) DB の部分ユニークインデックス(`store_research_runs_running_store_idx`,
 * PR1)がレースコンディション下の最終防御となる。
 *
 * 関連: workflows/store-research.ts, lib/repositories/research-run-repository.ts,
 *       Plan v3.2 §16, §17
 */

import { start } from "workflow/api";
import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentSession } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import { nowIso } from "@/lib/utils/date";
import { storeResearchWorkflow } from "@/workflows/store-research";
import { failure, success, type ActionResult } from "./_helpers";

export interface StartResearchRunResult {
  runId: string;
}

export async function startResearchRunAction(
  storeId: string,
): Promise<ActionResult<StartResearchRunResult>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  if (typeof storeId !== "string" || storeId.trim() === "") {
    return failure("店舗IDが不正です");
  }

  const rateLimit = checkRateLimit(storeId);
  if (!rateLimit.ok) return failure(rateLimit.message);

  const store = await repos.store.get(storeId);
  if (!store) return failure("店舗が見つかりません");

  const latest = await repos.researchRun.getLatestForStore(storeId);
  if (latest?.status === "running") {
    return failure("この店舗は既に調査中です。完了までお待ちください。");
  }

  let runId: string;
  try {
    const run = await repos.researchRun.create({
      store_id: storeId,
      requested_by_user_id: session.userId,
    });
    runId = run.id;
  } catch {
    // DB 部分ユニークインデックス違反(レースコンディションで二重起動された場合の最終防御)。
    return failure("この店舗は既に調査中です。完了までお待ちください。");
  }

  try {
    await start(storeResearchWorkflow, [runId, storeId]);
  } catch (err) {
    await repos.researchRun.update(runId, {
      status: "failed",
      error_kind: "workflow_start_failed",
      error_message: err instanceof Error ? err.message : "調査の開始に失敗しました",
      finished_at: nowIso(),
    });
    return failure("調査の開始に失敗しました。しばらくしてから再度お試しください。");
  }

  revalidateTag(CACHE_TAGS.store(storeId), "max");
  return success({ runId }, "AI店舗調査を開始しました");
}
