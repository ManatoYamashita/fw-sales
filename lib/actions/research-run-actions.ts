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
      const store = await tx.store.getForUpdate(storeId);
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
 *
 * ## 現在 UI からは呼ばれていない(feat/ai-research-quality-ux-hardening)
 *
 * Primary CTA が `adoptRemainingAndCompleteReviewAction`(confirmed + inferred を
 * 採用して完了まで行う)へ置き換わったため、production caller は 0 件。
 * **本 hardening では意図的に削除していない**:
 *
 * - 削除は挙動改善ではなく cleanup であり、hardening の commit に混ぜると
 *   レビュー範囲が広がる
 * - 本 action のテストは `tx.store.getForUpdate` を使う行ロック契約も
 *   カバーしており、消すとその回帰検知も一緒に失われる
 *
 * 撤去は別 cleanup PR で行うこと(その際は対応するテストも同時に整理する)。
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

    const store = await tx.store.getForUpdate(storeId);
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

    const store = await tx.store.getForUpdate(storeId);
    if (store && store.stage === "未調査") {
      await tx.store.update(storeId, { stage: "調査済み" });
    }

    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");

    return success(undefined, "レビューを完了しました");
  });
}

export interface AdoptRemainingInput {
  runId: string;
  storeId: string;
}

export interface AdoptRemainingResult {
  /** マージ後の全 decisions。クライアントはこれで state を置き換える(再構築しない)。 */
  reviewDecisions: ReviewDecisions;
  /** tx 内で採用した now。クライアントで `nowIso()` を捏造させない。 */
  reviewCompletedAt: string;
  adoptedCount: number;
}

/**
 * 「残りを採用して調査完了」(feat/ai-research-quality-ux-hardening、Plan §12.2)。
 *
 * ## なぜ必要か
 *
 * 実運用の操作モデルは「AIが具体的に調査した値は基本採用。明らかにおかしいものだけ
 * 編集/却下。skipはほぼ使わない」だが、UIは逆に「全項目に個別判断を要求し、
 * 残りは『スキップ』して完了」というモデルだった。しかも
 * `bulkAdoptConfirmedAction` は `inferred` を意図的に除外していたため、
 * 一括操作を使っても未判断が必ず残り、Primary CTA が画面から消えていた。
 *
 * ## semantics(承認済みの仕様変更を含む)
 *
 * - 未判断 `confirmed` → adopted(tier A)
 * - 未判断 `inferred`  → adopted(tier B)
 *   **これは `bulkAdoptConfirmedAction` の「推定項目は1件ずつの人間判断を強制」という
 *   既存の設計判断を意図的に変更するもの**(ユーザー承認済み)。
 * - 未判断 `conflict`  → **自動採用しない。** 1件でも残っていれば failure を返し、
 *   トランザクションごとロールバックする(DBへ一切書き込まない)。
 * - 既存の `adopted` / `rejected` / `skipped` → 変更しない(immutable decision)。
 *
 * ## 不変条件
 *
 * - run 行ロック(`researchRun.getForUpdate`)+ **store 行ロック**
 *   (`store.getForUpdate`、Plan §12.2.2)。ロック順は run → store で既存 action と同一。
 * - `stores` への書き込みは `basic_info` と `stage` をまとめて **1回**。
 * - stage は `未調査` のときだけ `調査済み` へ昇格(`架電済み` を降格させない)。
 * - `revalidateTag` は **transaction の外**(`handoff-actions.ts` の規約に揃える)。
 */
export async function adoptRemainingAndCompleteReviewAction(
  input: AdoptRemainingInput,
): Promise<ActionResult<AdoptRemainingResult>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const { runId, storeId } = input;
  if (typeof runId !== "string" || runId.trim() === "") return failure("パラメータが不正です");
  if (typeof storeId !== "string" || storeId.trim() === "") return failure("パラメータが不正です");

  const result = await repos.transaction(async (tx) => {
    const run = await tx.researchRun.getForUpdate(runId);
    if (!run || run.store_id !== storeId) return failure("調査結果が見つかりません");
    if (run.status !== "succeeded") return failure("この調査はまだレビューできません");
    if (run.review_completed_at !== null) return failure("このレビューは既に完了しています");

    const items = run.result ?? [];
    const undecided = getUndecidedReviewableItems(items, run.review_decisions);

    // conflict は候補選択が必須。1件でも残っていれば書き込む前に中断する
    // (`buildAdoptedBasicInfoField` は conflict で throw するため、
    //  ここで弾かないと tx 全体が例外でロールバックされ、ユーザーには理由が伝わらない)。
    const conflicts = undecided.filter((item) => item.status === "conflict");
    if (conflicts.length > 0) {
      return failure(`候補を選択する必要がある項目が${conflicts.length}件あります`);
    }

    const store = await tx.store.getForUpdate(storeId);
    if (!store) return failure("店舗が見つかりません");

    // now は1度だけ取得し、全 decision と review_completed_at で使い回す(決定性)。
    const now = nowIso();
    let basicInfo = store.basic_info;
    const mergedDecisions: ReviewDecisions = { ...run.review_decisions };
    for (const item of undecided) {
      const field = buildAdoptedBasicInfoField(item, run.source_registry, now);
      basicInfo = mergeBasicInfo(basicInfo, { [item.key]: field }, "manual", now);
      mergedDecisions[item.key] = { decision: "adopted", decided_at: now };
    }

    // basic_info と stage を1回の update にまとめる(既存 completeReviewAction は
    // stage を別 update で書いていた)。stage 降格禁止ガードは従来どおり allow-list。
    const storePatch: { basic_info: typeof basicInfo; stage?: "調査済み" } = {
      basic_info: basicInfo,
    };
    if (store.stage === "未調査") storePatch.stage = "調査済み";
    await tx.store.update(storeId, storePatch);

    await tx.researchRun.update(runId, {
      review_decisions: mergedDecisions,
      review_completed_at: now,
    });

    return success(
      {
        reviewDecisions: mergedDecisions,
        reviewCompletedAt: now,
        adoptedCount: undecided.length,
      },
      undecided.length > 0
        ? `${undecided.length}件を採用してレビューを完了しました`
        : "レビューを完了しました",
    );
  });

  // revalidate は transaction 成功後にのみ行う(rollback 時に走らせない)。
  if (result.ok) {
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");
  }
  return result;
}
