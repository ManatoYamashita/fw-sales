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
import { parsePostgresError } from "@/lib/db/postgres-error";
import { getCurrentSession } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import { nowIso } from "@/lib/utils/date";
import { storeResearchWorkflow } from "@/workflows/store-research";
import { mergeBasicInfo } from "@/lib/domain/basic-info-merge";
import {
  buildAdoptedBasicInfoField,
  classifyAdoptionEffect,
  getUndecidedReviewableItems,
  isEditedAdoption,
  isReviewableItem,
  isRunStuck,
  planReviewLanes,
} from "@/lib/domain/research-review";
import {
  AUDIT_EVENTS,
  type AdoptionEffectKind,
  type ResearchReviewCompletePayload,
  type ResearchReviewDecidePayload,
  type ReviewCompletionMethod,
} from "@/lib/observability/events";
import { snapshotSessionActor } from "@/lib/observability/actor";
import { writeAudit } from "@/lib/observability/audit";
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

/**
 * レビュー完了時点の判断の内訳を `research.review.complete` の payload にする。
 * 値は数えるだけで、項目キーや採用した値は含めない。
 */
function buildReviewCompletePayload(
  decisions: ReviewDecisions,
  method: ReviewCompletionMethod,
  autoSkippedCount: number,
  stageAdvanced: boolean,
): ResearchReviewCompletePayload {
  const counts = { adopted: 0, rejected: 0, skipped: 0 };
  for (const decision of Object.values(decisions)) counts[decision.decision]++;
  return {
    method,
    adoptedCount: counts.adopted,
    rejectedCount: counts.rejected,
    skippedCount: counts.skipped,
    autoSkippedCount,
    stageAdvanced,
  };
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
  let stuckRunFailedId: string | null = null;
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
      stuckRunFailedId = latest.id;
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
  } catch (err) {
    // SQLSTATE を判別する(fix: PR #180 review Finding 4)。旧実装は全ての失敗を
    // 二重起動として固定文言で返しログも残さなかったため、接続断・権限エラー等が
    // 誤った案内のまま検知不能になっていた。
    const parsed = parsePostgresError(err);
    if (parsed?.code === "23505") {
      // 部分ユニークインデックス違反(`store_research_runs_running_store_idx`)。
      // レースコンディションで二重起動された場合の最終防御。
      return failure("この店舗は既に調査中です。完了までお待ちください。");
    }
    // それ以外は原因不明の失敗として扱う。診断情報(SQLSTATE/constraint/table)は
    // Vercel logs にのみ残し、UI へは内部スキーマ情報を含まない汎用文言だけを返す
    // (`lib/actions/store-actions.ts` の既存 convention と同じ二系統設計)。
    //
    // `parsePostgresError` が null を返す形状(network/fetch系、想定外のwrapper等)でも
    // 「ログはあるが中身が全て undefined」にならないよう、error の識別子だけは残す。
    // 生メッセージは含めない(DB由来の値が混入しうるため)。
    console.error("[research.startRun] create failed", {
      storeId,
      code: parsed?.code,
      constraint: parsed?.constraint,
      table: parsed?.table,
      ...(parsed === null
        ? {
            unrecognized_error_name: err instanceof Error ? err.name : typeof err,
            unrecognized_error_constructor: (err as { constructor?: { name?: string } } | null)
              ?.constructor?.name,
          }
        : {}),
    });
    return failure("調査の開始に失敗しました。しばらくしてから再度お試しください。");
  }

  try {
    await start(storeResearchWorkflow, [runId, storeId]);
  } catch (err) {
    // DB へ raw message を残さなくなった分、運用診断は structured log 側で担保する
    // (同ファイルの `[research.startRun] create failed` と同じ規約。err オブジェクト
    // そのものは渡さず、種別を示す sanitized scalar のみ)。
    console.error("[research.startRun] workflow start failed", {
      storeId,
      runId,
      error_name: err instanceof Error ? err.name : typeof err,
      error_constructor: (err as { constructor?: { name?: string } } | null)?.constructor?.name,
    });
    await repos.researchRun.update(runId, {
      status: "failed",
      error_kind: "workflow_start_failed",
      // raw な起動エラーを DB へ保存しない(`workflows/store-research.ts:buildFailureRecord`
      // と同じ方針)。`error_message` は `StoreResearchRun` の一部として Client Component
      // へ渡り RSC payload に載るため、UI で非表示でもブラウザへは届く。診断の
      // Source of Truth は `error_kind` と structured log 側が担う。
      error_message: "調査の開始に失敗しました",
      finished_at: nowIso(),
    });
    return failure("調査の開始に失敗しました。しばらくしてから再度お試しください。");
  }

  // 監査は run の作成と Workflow の起動が成立した後に書く。失敗しても起動は取り消さない
  // (`writeAudit` は例外を投げない)。
  await writeAudit({
    event: AUDIT_EVENTS.researchRunStart,
    actor: snapshotSessionActor(session),
    storeId,
    runId,
    payload: { stuckRunFailedId },
  });
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
 * 変更しない。採用でも、いまの値と同じ(正規化して一致)なら `basic_info` は変更しない (#319)。
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

  // 監査に書く内容。transaction の中で、書き込みが成功する経路でだけ決める。
  // (`as` で宣言型を保つ。callback 内の代入は制御フロー解析に見えず、`null` に絞り込まれるため)
  let auditPayload = null as ResearchReviewDecidePayload | null;

  const result = await repos.transaction(async (tx) => {
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

    let payload: ResearchReviewDecidePayload;
    if (parsedDecision.data.decision === "adopted") {
      const store = await tx.store.getForUpdate(storeId);
      if (!store) return failure("店舗が見つかりません");

      const adoptOptions = { selectedCandidateId, editedValue: trimmedEditedValue };
      let field;
      try {
        field = buildAdoptedBasicInfoField(item, run.source_registry, now, adoptOptions);
      } catch {
        return failure("項目の反映に失敗しました");
      }

      // 採用しても値が変わらない(正規化して一致する)なら基本情報へ書き込まない (#319)。
      // 書き込むと、いまの値の表記・出典・更新日時が調査の値のもので置き換わってしまう。
      // 画面の「新規 / 変更なし / 上書き」と同じ判定を、監査の `effect` にも使う。
      const effect = classifyAdoptionEffect(store.basic_info[itemKey], field.value ?? "");
      if (effect.kind !== "same") {
        const mergedBasicInfo = mergeBasicInfo(store.basic_info, { [itemKey]: field }, "manual", now);
        await tx.store.update(storeId, { basic_info: mergedBasicInfo });
      }
      payload = {
        itemKey,
        decision: "adopted",
        effect: effect.kind,
        overwrittenOrigin: effect.kind === "overwrite" ? effect.origin : null,
        edited: isEditedAdoption(item, adoptOptions),
      };
    } else {
      payload = { itemKey, decision: parsedDecision.data.decision };
    }

    await tx.researchRun.update(runId, { review_decisions: mergedDecisions });
    auditPayload = payload;

    return success({ reviewDecisions: mergedDecisions });
  });

  // 監査と revalidate は transaction のコミット後にだけ行う(rollback 時に走らせない)。
  // 監査の書き込みに失敗しても判断の記録は取り消さない(`writeAudit` は例外を投げない)。
  if (result.ok && auditPayload) {
    await writeAudit({
      event: AUDIT_EVENTS.researchReviewDecide,
      actor: snapshotSessionActor(session),
      storeId,
      runId,
      payload: auditPayload,
    });
  }
  if (result.ok) revalidateTag(CACHE_TAGS.store(storeId), "max");
  return result;
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
  let auditPayload = null as ResearchReviewCompletePayload | null;

  const result = await repos.transaction(async (tx) => {
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

    const store = await tx.store.getForUpdate(storeId);
    const stageAdvanced = store?.stage === "未調査";
    if (stageAdvanced) {
      await tx.store.update(storeId, { stage: "調査済み" });
    }

    auditPayload = buildReviewCompletePayload(
      mergedDecisions,
      undecided.length > 0 ? "skip_remaining" : "all_decided",
      undecided.length,
      stageAdvanced,
    );
    return success(undefined, "レビューを完了しました");
  });

  // 監査と revalidate は transaction のコミット後にだけ行う(rollback 時に走らせない)。
  if (result.ok && auditPayload) {
    await writeAudit({
      event: AUDIT_EVENTS.researchReviewComplete,
      actor: snapshotSessionActor(session),
      storeId,
      runId,
      payload: auditPayload,
    });
  }
  if (result.ok) {
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");
  }
  return result;
}

export interface AdoptBulkLaneInput {
  runId: string;
  storeId: string;
  /**
   * 画面がまとめて採用すると表示した項目の key。サーバで計算し直した `bulk` に
   * 1 つでも含まれなければ、何も書き込まずに失敗する(表示後に基本情報が変わった場合)。
   */
  expectedKeys: string[];
  /** true なら、採用後に未判断が 0 件になることを確かめてレビューを完了する。 */
  complete: boolean;
}

export interface AdoptBulkLaneResult {
  /** マージ後の全 decisions。クライアントはこれで state を置き換える(再構築しない)。 */
  reviewDecisions: ReviewDecisions;
  /** 完了した場合の完了時刻(tx 内で採用した now)。完了しない場合は null。 */
  reviewCompletedAt: string | null;
  adoptedCount: number;
  /** 基本情報が実際に変わった件数(同じ値の項目は数えない)。 */
  changedCount: number;
}

/**
 * 主ボタン「N件をまとめて採用」「N件を採用して調査完了」(#301, #319)。
 *
 * ## 何を採用するか
 *
 * `planReviewLanes` が `bulk` に振り分けた項目だけ:
 * - 採用しても基本情報が変わらない項目(同じ値)
 * - 注記の無い確認済みで、いまの値が空の項目(新規)
 *
 * **推定の値・上書きになる値・注記ありの値・競合は採用しない。** これらは 1 件ずつ判断する。
 * 旧「残りを採用して調査完了」(`adoptRemainingAndCompleteReviewAction`)は推定まで採用し、
 * 既存の基本情報を無条件に上書きしていた(本番で再調査した 2 店舗の 24〜25 件)。
 *
 * ## 画面とサーバのずれを防ぐ
 *
 * 振り分けはロックした `stores.basic_info` でサーバ側でも計算し直す。画面が表示した
 * `expectedKeys` が 1 つでも `bulk` に無ければ、何も書き込まずに失敗する。
 * 画面に「6件をまとめて採用」と出ていたのに、表示後の手入力で 1 件が上書きに変わっていた、
 * といった場合に、見ていない上書きを起こさないため。
 *
 * ## 不変条件(旧 Action から引き継ぐ)
 *
 * - run 行ロック → store 行ロックの順(既存 action と同一)
 * - `stores` への書き込みは `basic_info` と `stage` をまとめて最大 1 回。変化が無ければ書かない
 * - 同じ値の項目は `basic_info` を書き換えない(判断だけ記録する)
 * - stage は `未調査` のときだけ `調査済み` へ昇格(完了する場合のみ)
 * - now は 1 度だけ取得し、全 decision と review_completed_at で使い回す
 * - `revalidateTag` は transaction の外
 */
export async function adoptBulkLaneAction(
  input: AdoptBulkLaneInput,
): Promise<ActionResult<AdoptBulkLaneResult>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const { runId, storeId, expectedKeys, complete } = input;
  if (typeof runId !== "string" || runId.trim() === "") return failure("パラメータが不正です");
  if (typeof storeId !== "string" || storeId.trim() === "") return failure("パラメータが不正です");
  if (typeof complete !== "boolean") return failure("パラメータが不正です");
  if (
    !Array.isArray(expectedKeys) ||
    expectedKeys.length === 0 ||
    expectedKeys.some((key) => typeof key !== "string" || key.trim() === "") ||
    new Set(expectedKeys).size !== expectedKeys.length
  ) {
    return failure("パラメータが不正です");
  }

  let auditEffectCounts = null as Record<AdoptionEffectKind, number> | null;
  let auditCompletePayload = null as ResearchReviewCompletePayload | null;

  const result = await repos.transaction(async (tx) => {
    const run = await tx.researchRun.getForUpdate(runId);
    if (!run || run.store_id !== storeId) return failure("調査結果が見つかりません");
    if (run.status !== "succeeded") return failure("この調査はまだレビューできません");
    if (run.review_completed_at !== null) return failure("このレビューは既に完了しています");

    const store = await tx.store.getForUpdate(storeId);
    if (!store) return failure("店舗が見つかりません");

    const items = run.result ?? [];
    const plan = planReviewLanes(items, run.review_decisions, store.basic_info);
    const bulkByKey = new Map(
      plan.filter((entry) => entry.lane === "bulk").map((entry) => [entry.item.key, entry.item]),
    );
    if (expectedKeys.some((key) => !bulkByKey.has(key))) {
      return failure(
        "画面を表示した後に基本情報か判断が変わりました。ページを再読み込みしてから、もう一度お試しください。",
      );
    }

    const expected = new Set(expectedKeys);
    const remaining = plan.filter((entry) => !expected.has(entry.item.key)).length;
    if (complete && remaining > 0) {
      return failure(`ほかに判断が必要な項目が${remaining}件あります`);
    }

    const now = nowIso();
    let basicInfo = store.basic_info;
    let changedCount = 0;
    // `bulk` の振り分け上は new / same しか来ないが、監査には実際の判定をそのまま数える。
    const effectCounts: Record<AdoptionEffectKind, number> = { new: 0, same: 0, overwrite: 0 };
    const mergedDecisions: ReviewDecisions = { ...run.review_decisions };
    for (const key of expectedKeys) {
      const item = bulkByKey.get(key)!;
      const field = buildAdoptedBasicInfoField(item, run.source_registry, now);
      const effect = classifyAdoptionEffect(basicInfo[key], field.value ?? "");
      effectCounts[effect.kind]++;
      if (effect.kind !== "same") {
        basicInfo = mergeBasicInfo(basicInfo, { [key]: field }, "manual", now);
        changedCount++;
      }
      mergedDecisions[key] = { decision: "adopted", decided_at: now };
    }

    const stageAdvanced = complete && store.stage === "未調査";
    const storePatch: { basic_info?: typeof basicInfo; stage?: "調査済み" } = {};
    if (changedCount > 0) storePatch.basic_info = basicInfo;
    if (stageAdvanced) storePatch.stage = "調査済み";
    if (Object.keys(storePatch).length > 0) await tx.store.update(storeId, storePatch);

    await tx.researchRun.update(runId, {
      review_decisions: mergedDecisions,
      ...(complete ? { review_completed_at: now } : {}),
    });

    auditEffectCounts = effectCounts;
    auditCompletePayload = complete
      ? buildReviewCompletePayload(mergedDecisions, "adopt_bulk", 0, stageAdvanced)
      : null;

    const adoptedCount = expectedKeys.length;
    return success(
      {
        reviewDecisions: mergedDecisions,
        reviewCompletedAt: complete ? now : null,
        adoptedCount,
        changedCount,
      },
      complete ? `${adoptedCount}件を採用してレビューを完了しました` : `${adoptedCount}件を採用しました`,
    );
  });

  // 監査と revalidate は transaction のコミット後にだけ行う(rollback 時に走らせない)。
  // 完了も伴う場合は「採用」と「完了」の 2 件を順に書く。どちらも失敗しても例外を投げないため、
  // 監査 DB が詰まったときの待ち時間は最大で 2 件分(`AUDIT_WRITE_WAIT_MS` × 2)になる。
  if (result.ok && auditEffectCounts) {
    const actor = snapshotSessionActor(session);
    await writeAudit({
      event: AUDIT_EVENTS.researchReviewBulkAdopt,
      actor,
      storeId,
      runId,
      payload: { itemKeys: expectedKeys, effectCounts: auditEffectCounts },
    });
    if (auditCompletePayload) {
      await writeAudit({
        event: AUDIT_EVENTS.researchReviewComplete,
        actor,
        storeId,
        runId,
        payload: auditCompletePayload,
      });
    }
  }
  if (result.ok) {
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    if (complete) revalidateTag(CACHE_TAGS.stores, "max");
  }
  return result;
}
