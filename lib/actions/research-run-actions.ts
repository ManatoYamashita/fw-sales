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
import { mergeBasicInfo } from "@/lib/domain/basic-info-merge";
import {
  buildAdoptedBasicInfoField,
  getUndecidedReviewableItems,
  isReviewableItem,
  isRunStuck,
} from "@/lib/domain/research-review";
import {
  isValidReviewDecisionForItem,
  ReviewDecisionSchema,
  REVIEW_DECISION_TYPES,
} from "@/lib/ai/research-result-schema";
import type {
  ReviewDecision,
  ReviewDecisionType,
  ReviewDecisions,
  StoreResearchRun,
} from "@/types/research-run";
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
    // stuck run対策(Plan v3.2 §17): Workflowが想定外にクラッシュし
    // markFailedStepすら実行されなかった最悪ケースへの保険。expires_atを
    // 過ぎたrunning runは、部分ユニークインデックス
    // (store_research_runs_running_store_idx)が新規runの作成を阻害する前に
    // ここでfailedへ倒してから再調査を許可する。
    if (isRunStuck(latest, nowIso())) {
      await repos.researchRun.update(latest.id, {
        status: "failed",
        error_kind: "stuck_run_timeout",
        error_message: "処理時間が想定を超えたため中断しました。",
        finished_at: nowIso(),
      });
    } else {
      return failure("この店舗は既に調査中です。完了までお待ちください。");
    }
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

/**
 * run 進捗のポーリング用(PR4)。`repos.researchRun` は server-only のため、
 * client component からは本 Action 経由で読む。`'use cache'` は使わない
 * (running中のrunを数秒間隔で読むため、Cache Componentsのキャッシュ対象外)。
 */
export async function getResearchRunStatusAction(
  runId: string,
): Promise<ActionResult<StoreResearchRun>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");
  if (typeof runId !== "string" || runId.trim() === "") {
    return failure("runIdが不正です");
  }
  const run = await repos.researchRun.get(runId);
  if (!run) return failure("調査結果が見つかりません");
  return success(run);
}

export interface RecordReviewDecisionInput {
  runId: string;
  storeId: string;
  itemKey: string;
  decision: ReviewDecisionType;
  selectedCandidateId?: string;
  editedValue?: string;
}

/**
 * 53項目レビューの1件分の判断(採用/却下/スキップ)を記録する(PR4, Plan v3.2 §4, §15)。
 *
 * 「採用した項目のみ mergeBasicInfo(..., "manual") で stores.basic_info へ即時反映」
 * (Plan §4)の実装。却下・スキップは `review_decisions` の記録のみで `basic_info` は
 * 変更しない。
 *
 * feat/research-review-write-integrity(MAJOR10・MAJOR11)での変更:
 * - `repos.transaction` + `getForUpdate`(`SELECT ... FOR UPDATE`)でrun行をロックし、
 *   basic_info書込みとreview_decisions書込みを1トランザクションで原子化する。
 *   同一runへの並行操作(採用/却下/スキップ、一括採用、レビュー完了)を直列化する。
 * - 一度`review_decisions`に記録済みのitemKeyへの再判断は拒否する(immutable設計。
 *   採用後の訂正はbasic_info編集導線で行う想定)。
 * - `editedValue`は空文字・空白のみを拒否する(canonicalなbasic_infoへ空値を
 *   保存させない)。
 * - inputはTypeScriptの型だけを信頼せず、runtimeでも検証する。
 */
export async function recordReviewDecisionAction(
  input: RecordReviewDecisionInput,
): Promise<ActionResult<{ reviewDecisions: ReviewDecisions }>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const { runId, storeId, itemKey, decision, selectedCandidateId, editedValue } = input;
  if (typeof runId !== "string" || runId.trim() === "") return failure("パラメータが不正です");
  if (typeof storeId !== "string" || storeId.trim() === "") return failure("パラメータが不正です");
  if (typeof itemKey !== "string" || itemKey.trim() === "") return failure("パラメータが不正です");
  if (!(REVIEW_DECISION_TYPES as readonly string[]).includes(decision)) {
    return failure("パラメータが不正です");
  }
  if (selectedCandidateId !== undefined && typeof selectedCandidateId !== "string") {
    return failure("パラメータが不正です");
  }
  // 空文字は「未指定」ではなく明示的に不正値として拒否する(fix/ai-research-final-audit-hardening、
  // 監査で発見: 以前は isValidReviewDecisionForItem が候補一覧に "" が実在しないことに
  // よって偶然弾いていただけで、明示的なruntime検証ではなかった)。
  if (selectedCandidateId !== undefined && selectedCandidateId.trim() === "") {
    return failure("パラメータが不正です");
  }
  if (editedValue !== undefined && typeof editedValue !== "string") {
    return failure("パラメータが不正です");
  }

  const now = nowIso();
  const trimmedEditedValue = editedValue !== undefined ? editedValue.trim() : undefined;
  if (trimmedEditedValue !== undefined && trimmedEditedValue === "") {
    return failure("値を入力してください");
  }

  const reviewDecision: ReviewDecision =
    decision === "adopted"
      ? {
          decision: "adopted",
          decided_at: now,
          ...(selectedCandidateId !== undefined
            ? { selected_candidate_id: selectedCandidateId }
            : {}),
          ...(trimmedEditedValue !== undefined ? { edited_value: trimmedEditedValue } : {}),
        }
      : { decision, decided_at: now };

  // Zodによるruntime再検証(discriminated union .strict()で不正な組み合わせを弾く、
  // feat/research-review-write-integrity 追加修正E)。
  const parsedDecision = ReviewDecisionSchema.safeParse(reviewDecision);
  if (!parsedDecision.success) return failure("不正な選択です");

  return repos.transaction(async (tx) => {
    const run = await tx.researchRun.getForUpdate(runId);
    if (!run || run.store_id !== storeId) return failure("調査結果が見つかりません");
    if (run.status !== "succeeded") return failure("この調査はまだレビューできません");
    if (run.review_completed_at !== null) return failure("このレビューは既に完了しています");

    const item = (run.result ?? []).find((i) => i.key === itemKey);
    if (!item) return failure("対象の項目が見つかりません");
    if (!isReviewableItem(item)) return failure("この項目はレビュー対象外です");

    // MAJOR10: 一度記録した判断はimmutable。採用後の訂正はbasic_info編集導線で行う。
    if (run.review_decisions[itemKey] !== undefined) {
      return failure("この項目は既に判断済みです");
    }

    if (!isValidReviewDecisionForItem(parsedDecision.data, item)) {
      return failure("不正な選択です");
    }
    if (
      item.status === "conflict" &&
      parsedDecision.data.decision === "adopted" &&
      !selectedCandidateId
    ) {
      // isValidReviewDecisionForItem は selected_candidate_id 未指定を一般に許容するため
      // (rejected/skippedは候補選択不要)、conflict項目のadoptedにのみ本チェックを追加する。
      // 候補未選択のまま basic_info へ value:null を manual 書込みしてしまう抜け道を塞ぐ。
      return failure("競合している項目は候補を選択してください");
    }

    const mergedDecisions: ReviewDecisions = {
      ...run.review_decisions,
      [itemKey]: parsedDecision.data,
    };

    if (parsedDecision.data.decision === "adopted") {
      const store = await tx.store.get(storeId);
      if (!store) return failure("店舗が見つかりません");

      let field;
      try {
        field = buildAdoptedBasicInfoField(item, run.source_registry, now, {
          selectedCandidateId,
          editedValue: trimmedEditedValue,
        });
      } catch {
        return failure("項目の反映に失敗しました");
      }

      const mergedBasicInfo = mergeBasicInfo(store.basic_info, { [itemKey]: field }, "manual", now);
      await tx.store.update(storeId, { basic_info: mergedBasicInfo });
    }

    await tx.researchRun.update(runId, { review_decisions: mergedDecisions });
    revalidateTag(CACHE_TAGS.store(storeId), "max");

    return success({ reviewDecisions: mergedDecisions });
  });
}

/**
 * 確認済み(confirmed)項目のうち未対応のものを一括採用する(PR4, Plan v3.2 §5.3
 * 「確認済みを全て採用」)。推定(inferred)項目は対象外(1件ずつの人間判断を強制、
 * Plan §5.3)。store/run の書込みをそれぞれ1回にまとめ、項目数分の往復を避ける。
 */
export async function bulkAdoptConfirmedAction(input: {
  runId: string;
  storeId: string;
}): Promise<ActionResult<{ reviewDecisions: ReviewDecisions; adoptedCount: number }>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const { runId, storeId } = input;
  if (typeof runId !== "string" || runId.trim() === "") return failure("パラメータが不正です");
  if (typeof storeId !== "string" || storeId.trim() === "") return failure("パラメータが不正です");

  // feat/research-review-write-integrity(MAJOR10): getForUpdateでrun行をロックし、
  // recordReviewDecisionAction/completeReviewActionと同一runへの並行操作を直列化する。
  // basic_info書込みとreview_decisions書込みも1トランザクションで原子化する。
  return repos.transaction(async (tx) => {
    const run = await tx.researchRun.getForUpdate(runId);
    if (!run || run.store_id !== storeId) return failure("調査結果が見つかりません");
    if (run.status !== "succeeded") return failure("この調査はまだレビューできません");
    if (run.review_completed_at !== null) return failure("このレビューは既に完了しています");

    const targets = (run.result ?? []).filter(
      (item) => item.status === "confirmed" && run.review_decisions[item.key] === undefined,
    );
    if (targets.length === 0) {
      return success({ reviewDecisions: run.review_decisions, adoptedCount: 0 }, "対象がありません");
    }

    const store = await tx.store.get(storeId);
    if (!store) return failure("店舗が見つかりません");

    const now = nowIso();
    let basicInfo = store.basic_info;
    const mergedDecisions: ReviewDecisions = { ...run.review_decisions };
    for (const item of targets) {
      const field = buildAdoptedBasicInfoField(item, run.source_registry, now);
      basicInfo = mergeBasicInfo(basicInfo, { [item.key]: field }, "manual", now);
      mergedDecisions[item.key] = { decision: "adopted", decided_at: now };
    }

    await tx.store.update(storeId, { basic_info: basicInfo });
    await tx.researchRun.update(runId, { review_decisions: mergedDecisions });
    revalidateTag(CACHE_TAGS.store(storeId), "max");

    return success(
      { reviewDecisions: mergedDecisions, adoptedCount: targets.length },
      `${targets.length}件を採用しました`,
    );
  });
}

export interface CompleteReviewInput {
  runId: string;
  storeId: string;
  /** true の場合、未対応の reviewable item を一括 skipped にした上で完了する(Secondary操作)。 */
  skipRemaining: boolean;
}

/**
 * レビュー完了操作(PR4, Plan v3.2 §15)。
 *
 * - reviewable item が全件対応済みでなければ、`skipRemaining=false` の場合は失敗を返す
 *   (Primaryボタンの活性化条件と同じ判定をサーバ側でも強制する)。
 * - `skipRemaining=true` の場合、未対応item全件を機械的に `skipped` にしてから完了する。
 * - 完了後、`store.stage==="未調査"` の場合のみ `"調査済み"` へ遷移する(既に調査済み/
 *   架電済みの店舗を再調査した場合は降格させない、Plan §15)。
 */
export async function completeReviewAction(
  input: CompleteReviewInput,
): Promise<ActionResult<void>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const { runId, storeId, skipRemaining } = input;
  if (typeof runId !== "string" || runId.trim() === "") return failure("パラメータが不正です");
  if (typeof storeId !== "string" || storeId.trim() === "") return failure("パラメータが不正です");

  // feat/research-review-write-integrity(MAJOR10): getForUpdateでrun行をロックし、
  // review_decisions/review_completed_at書込みとstore.stage書込みを1トランザクションで
  // 原子化する(旧実装は別々のawaitで、片側のみ成功する不整合の余地があった)。
  return repos.transaction(async (tx) => {
    const run = await tx.researchRun.getForUpdate(runId);
    if (!run || run.store_id !== storeId) return failure("調査結果が見つかりません");
    if (run.status !== "succeeded") return failure("この調査はまだレビューできません");
    if (run.review_completed_at !== null) return failure("このレビューは既に完了しています");

    const items = run.result ?? [];
    const undecided = getUndecidedReviewableItems(items, run.review_decisions);

    let mergedDecisions = run.review_decisions;
    if (undecided.length > 0) {
      if (!skipRemaining) {
        return failure(`未対応の項目が${undecided.length}件残っています`);
      }
      const now = nowIso();
      mergedDecisions = { ...run.review_decisions };
      for (const item of undecided) {
        mergedDecisions[item.key] = { decision: "skipped", decided_at: now };
      }
    }

    await tx.researchRun.update(runId, {
      review_decisions: mergedDecisions,
      review_completed_at: nowIso(),
    });

    const store = await tx.store.get(storeId);
    if (store && store.stage === "未調査") {
      await tx.store.update(storeId, { stage: "調査済み" });
    }

    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");

    return success(undefined, "レビューを完了しました");
  });
}
