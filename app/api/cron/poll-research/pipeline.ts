/**
 * Deep Research パイプライン中核ロジック (deep-research-pipeline spec #43, Task 4.1)
 *
 * HTTP 層 (`route.ts`) から分離した純ロジック。3 ステージを deadline 内で順次実行する。
 *
 * 1. Stuck sweep — 6h+ inflight ジョブを cancelTask + failed 化 + 失敗通知
 * 2. Polling fan-out — researching ジョブ最大 N 件を getTask、completed なら
 *    Stage 2 構造化 → done 化 + 完了通知、failed なら通知のみ
 * 3. Start fan-in — in-flight < MAX なら最古 queued を Stage 1 起動
 *
 * 各操作前に `Date.now() < deadline` をチェックし、残り時間が足りなければ次 tick へ送る。
 * 自動リトライは行わない (R5.6)。
 *
 * 関連: design.md §pollResearchEndpoint Responsibilities, requirements.md
 *       §2.1, §2.2, §2.4, §2.5, §5.3, §5.4, §5.6, §6.3, §8.2, §8.4
 */

import "server-only";

import { repos } from "@/lib/repositories";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import {
  getInFlightCap,
  getPollPerTick,
  getMonthlyCap,
  getMonthlyWarningPercent,
} from "@/lib/env";
import { createDeepResearchClient } from "@/lib/ai/deep-research/client";
import { createStructurer } from "@/lib/ai/deep-research/structurer";
import { buildDeepResearchPrompt } from "@/lib/ai/deep-research/prompt";
import { createDeepResearchNotification } from "@/lib/db/notification-helpers";
import type {
  DeepResearchClient,
  DeepResearchTaskState,
} from "@/lib/ai/deep-research/client";
import type {
  Structurer,
  StructurerError,
} from "@/lib/ai/deep-research/structurer";
import type {
  DeepResearchJob,
  DeepResearchJobErrorEntry,
  DeepResearchReportInsert,
  HearingQuestion,
} from "@/types/deep-research";
import type { Store } from "@/types/store";

/** 1 tick の処理結果。HTTP レスポンス body に展開される。 */
export interface TickResult {
  swept: number;
  polled: number;
  /** researching → structuring に遷移したジョブ件数 (Stage 1 完了検知)。 */
  moved_to_structuring: number;
  /** Stage 2 構造化が完了して done になったジョブ件数。 */
  structured: number;
  /** done になったジョブの合計件数 (moved_to_structuring + structured の文脈での完了)。 */
  completed: number;
  started: number;
  deadline_reached: boolean;
}

/**
 * Stage 2 構造化の各種しきい値。
 *
 * RESERVE_STRUCTURING_BUDGET_MS: Stage 2 開始前に必要な最低残り時間。
 *   tick 開始直後 (deadline=55s) に Stage B が実行されるため通常は達する。
 *   残り < 40s の場合は structuring のまま次 tick へ (error_log は増やさない)。
 *
 * STAGE2_MAX_TIMEOUTS: Stage 2 実行中 timeout の最大許容回数。
 *   この回数を超えたら stage2_timeout_exceeded で failed にする。
 */
const RESERVE_STRUCTURING_BUDGET_MS = 40_000;
const STAGE2_MAX_TIMEOUTS = 3;
const RESERVE_START_MS = 5_000;
const RESERVE_POLL_ONE_MS = 2_000;
const RESERVE_SWEEP_ONE_MS = 3_000;
const STUCK_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 時間

/**
 * Stage 2 処理の結果。`runStage2AndFinalize` の戻り値。
 *
 * - "completed"        : report 挿入 + done 化 成功
 * - "still_structuring": timeout → structuring のまま次 tick へ
 * - "failed"           : 回復不能エラー → failed 化済み
 */
type Stage2FinalizeResult = "completed" | "still_structuring" | "failed";

/** error_log 内の "stage2_timeout" エントリ数を返す。再試行制御に使用。 */
function countStage2Timeouts(job: DeepResearchJob): number {
  const log = job.error_log ?? [];
  return log.filter(
    (e) => e.stage === "stage2" && e.kind === "stage2_timeout",
  ).length;
}

/**
 * 適応型ポーリング間隔。
 * 初回 45 分待ち → 以降 1/2 ずつ短縮 → 最短 5 分でクランプ。
 */
const INITIAL_POLL_DELAY_MS = 45 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 5 * 60 * 1000;

function shouldPollJob(job: DeepResearchJob, now: number): boolean {
  const startedAt = job.research_started_at
    ? new Date(job.research_started_at).getTime()
    : new Date(job.enqueued_at).getTime();

  const elapsed = now - startedAt;
  if (elapsed < INITIAL_POLL_DELAY_MS) return false;

  const lastPolled = job.api_updated_at
    ? new Date(job.api_updated_at).getTime()
    : 0;

  if (lastPolled <= startedAt) return true;

  const sinceStart = lastPolled - startedAt;
  let interval = INITIAL_POLL_DELAY_MS;
  let cursor = interval;
  while (cursor <= sinceStart) {
    interval = Math.max(Math.floor(interval / 2), MIN_POLL_INTERVAL_MS);
    cursor += interval;
  }
  return now >= lastPolled + interval;
}

export interface RunPollResearchTickInput {
  deadline: number;
  /** テスト用に SDK クライアントを差替え可能。本番では `createDeepResearchClient()` */
  drClient?: DeepResearchClient;
  /** テスト用に Structurer を差替え可能。本番では `createStructurer()` */
  structurer?: Structurer;
  /** AbortSignal — Vercel Function timeout 監視用 */
  signal?: AbortSignal;
}

export async function runPollResearchTick(
  input: RunPollResearchTickInput,
): Promise<TickResult> {
  const {
    deadline,
    drClient = createDeepResearchClient(),
    structurer = createStructurer(),
    signal = AbortSignal.timeout(60_000),
  } = input;

  const result: TickResult = {
    swept: 0,
    polled: 0,
    moved_to_structuring: 0,
    structured: 0,
    completed: 0,
    started: 0,
    deadline_reached: false,
  };

  // ---- Stage A: Stuck sweep -------------------------------------------------
  const sweepCutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuck = await repos.deepResearch.findStuckJobs(sweepCutoff);
  for (const job of stuck) {
    if (!hasTimeLeft(deadline, RESERVE_SWEEP_ONE_MS)) {
      result.deadline_reached = true;
      break;
    }
    await sweepStuckJob({ job, drClient, signal });
    result.swept += 1;
  }

  // ---- Stage B: Structuring fan-out (Stage 2 専用 tick) --------------------
  // tick 開始直後なので最大の時間バジェットを Stage 2 に割り当てられる。
  // 1 tick で最大 1 件処理 (Stage 2 は重いためバジェットを独占させる)。
  if (!result.deadline_reached) {
    const structuringJobs = await repos.deepResearch.findOldestStructuring(1);
    for (const job of structuringJobs) {
      if (!hasTimeLeft(deadline, RESERVE_STRUCTURING_BUDGET_MS)) {
        // 残り時間不足: structuring のまま次 tick へ送る。failed にしない。
        result.deadline_reached = true;
        break;
      }
      const outcome = await processOneStructuring({
        job,
        drClient,
        structurer,
        deadline,
        signal,
      });
      // "completed" のときのみカウント。"still_structuring" / "failed" は増やさない。
      if (outcome === "completed") {
        result.structured += 1;
        result.completed += 1;
      }
    }
  }

  // ---- Stage C: Polling fan-out (適応型間隔: 45→22→11→5 分) ----------------
  // completed 検知時は structuring に遷移するのみ。Stage 2 は実行しない。
  if (!result.deadline_reached) {
    const pollLimit = getPollPerTick();
    const researching = await repos.deepResearch.findOldestResearching(pollLimit);
    const now = Date.now();
    for (const job of researching) {
      if (!hasTimeLeft(deadline, RESERVE_POLL_ONE_MS)) {
        result.deadline_reached = true;
        break;
      }
      if (!shouldPollJob(job, now)) continue;
      const outcome = await pollOneResearching({
        job,
        drClient,
        signal,
      });
      result.polled += 1;
      if (outcome === "moved_to_structuring") result.moved_to_structuring += 1;
    }
  }

  // ---- Stage D: Start fan-in -----------------------------------------------
  if (!result.deadline_reached && hasTimeLeft(deadline, RESERVE_START_MS)) {
    const inFlight = await repos.deepResearch.countInFlight();
    const cap = getInFlightCap();
    if (inFlight < cap) {
      const claimed = await repos.deepResearch.claimOldestQueued();
      if (claimed && hasTimeLeft(deadline, RESERVE_START_MS)) {
        await startOneQueued({ job: claimed, drClient, signal });
        result.started += 1;
      }
    }
  }

  // ---- Budget warning (任意): 完了処理後の月次予算判定 ----------------------
  await maybeFireBudgetWarning();

  return result;
}

// ---------------------------------------------------------------------------
// Stage A — Stuck sweep
// ---------------------------------------------------------------------------

async function sweepStuckJob(args: {
  job: DeepResearchJob;
  drClient: DeepResearchClient;
  signal: AbortSignal;
}): Promise<void> {
  const { job, drClient, signal } = args;
  const occurredAt = new Date().toISOString();

  // cancelTask は best-effort
  let cancelResult: DeepResearchJobErrorEntry["cancel_result"];
  if (job.deep_research_task_id) {
    try {
      const r = await drClient.cancelTask(
        { taskId: job.deep_research_task_id },
        signal,
      );
      cancelResult = r.cancelled
        ? { cancelled: true }
        : { cancelled: false, reason: r.reason };
    } catch {
      cancelResult = { cancelled: false, reason: "api_error" };
    }
  }

  const stage = job.status === "structuring" ? "stage2" : "stage1";
  const errorEntry: DeepResearchJobErrorEntry = {
    stage: "sweep",
    kind: stage === "stage2" ? "stage2_stuck" : "stage1_stuck",
    message: `6h 経過した ${job.status} 状態のジョブを sweep 化`,
    occurred_at: occurredAt,
    ...(cancelResult !== undefined ? { cancel_result: cancelResult } : {}),
  };

  await repos.deepResearch.appendJobError(job.id, errorEntry);
  await repos.deepResearch.updateJobStatus(job.id, {
    status: "failed",
    completed_at: occurredAt,
  });
  // 詳細ページの `getDeepResearchJobById` (`"use cache"`) を即時無効化する。
  // 一覧 / 店舗別キャッシュも併せて無効化することで、cron / `after()` どちら
  // 経由の sweep でも UI が次レンダで最新になる。
  revalidateTag(CACHE_TAGS.deepResearchJob(job.id), "max");
  revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  await fireFailureNotification(job, errorEntry.message);
}

// ---------------------------------------------------------------------------
// Stage C — Polling (researching → structuring 遷移のみ。Stage 2 は実行しない)
// ---------------------------------------------------------------------------

/**
 * researching ジョブを 1 件ポーリングする。
 * Gemini が completed を返した場合は stage1_markdown / stage1_source_urls を保存し、
 * status を structuring に遷移する。Stage 2 構造化は実行しない (別 tick で行う)。
 */
async function pollOneResearching(args: {
  job: DeepResearchJob;
  drClient: DeepResearchClient;
  signal: AbortSignal;
}): Promise<"moved_to_structuring" | "still_running" | "failed"> {
  const { job, drClient, signal } = args;
  if (!job.deep_research_task_id) {
    await markFailed(
      job,
      "stage1",
      "task_id_missing",
      "researching 状態だが deep_research_task_id が空でした",
    );
    return "failed";
  }
  let state: DeepResearchTaskState;
  try {
    state = await drClient.getTask(
      { taskId: job.deep_research_task_id },
      signal,
    );
  } catch (err) {
    const kind = inferErrorKind(err);
    await markFailed(job, "stage1", `stage1_${kind}`, summarizeError(err));
    return "failed";
  }

  if (state.state === "in_progress") {
    if (state.apiUpdatedAt) {
      await repos.deepResearch.updateJobStatus(job.id, {
        status: "researching",
        api_updated_at: state.apiUpdatedAt,
      });
      // 詳細ページ (`getDeepResearchJobById` の `"use cache"`) を無効化。
      // `api_updated_at` 更新が UI に反映されない問題への対処。
      // `pollGeminiJobAction` (`deep-research-actions.ts:356`) と一貫性を保つ。
      revalidateTag(CACHE_TAGS.deepResearchJob(job.id), "max");
    }
    return "still_running";
  }

  if (state.state === "failed") {
    await markFailed(job, "stage1", "stage1_failed", state.reason);
    return "failed";
  }

  // completed: stage1_markdown / stage1_source_urls を保存して structuring に遷移。
  // Stage 2 はこの tick では実行しない (次 tick の Stage B で処理)。
  const now = new Date().toISOString();
  await repos.deepResearch.updateJobStatus(job.id, {
    status: "structuring",
    research_completed_at: now,
    api_updated_at: state.apiUpdatedAt ?? null,
    stage1_markdown: state.reportMarkdown,
    stage1_source_urls: state.sourceUrls,
  });
  return "moved_to_structuring";
}

// ---------------------------------------------------------------------------
// Stage B — Structuring (Stage 2 専用 tick)
// ---------------------------------------------------------------------------

/**
 * structuring ジョブを 1 件取得し、Stage 2 構造化を実行する。
 * stage1_markdown が job に保存されているため Gemini への追加呼出は不要。
 *
 * - 成功 → "completed" (report 挿入 + done 化済み)
 * - timeout: 上限未達 → "still_structuring" (structuring のまま次 tick へ)
 * - timeout: 上限超過 → "failed" (stage2_timeout_exceeded で failed 化済み)
 * - 他の失敗 → "failed"
 * - stage1_markdown なし → "failed"
 */
async function processOneStructuring(args: {
  job: DeepResearchJob;
  drClient: DeepResearchClient;
  structurer: Structurer;
  deadline: number;
  signal: AbortSignal;
}): Promise<Stage2FinalizeResult> {
  const { job, structurer, deadline, signal } = args;

  const reportMarkdown = job.stage1_markdown;
  const sourceUrls = job.stage1_source_urls ?? [];

  if (!reportMarkdown) {
    // stage1_markdown が空: 移行期の旧 structuring ジョブへの防護
    await markFailed(
      job,
      "stage2",
      "stage2_markdown_missing",
      "stage1_markdown が空のため Stage 2 を実行できませんでした",
    );
    return "failed";
  }

  // Stage 2 timeout 上限チェック
  const timeoutCount = countStage2Timeouts(job);
  if (timeoutCount >= STAGE2_MAX_TIMEOUTS) {
    await repos.deepResearch.appendJobError(job.id, {
      stage: "stage2",
      kind: "stage2_timeout_exceeded",
      message: `Stage 2 のタイムアウト再試行上限 (${STAGE2_MAX_TIMEOUTS} 回) を超えました`,
      occurred_at: new Date().toISOString(),
    });
    await repos.deepResearch.updateJobStatus(job.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });
    return "failed";
  }

  return runStage2AndFinalize({
    job,
    reportMarkdown,
    sourceUrls,
    structurer,
    deadline,
    signal,
  });
}

async function runStage2AndFinalize(args: {
  job: DeepResearchJob;
  reportMarkdown: string;
  sourceUrls: string[];
  structurer: Structurer;
  deadline: number;
  signal: AbortSignal;
}): Promise<Stage2FinalizeResult> {
  const { job, reportMarkdown, sourceUrls, structurer, deadline, signal } = args;

  const store = await repos.store.get(job.store_id);
  if (!store) {
    await markFailed(
      job,
      "stage2",
      "stage2_store_not_found",
      "Stage 2 構造化前に対象店舗が見つかりませんでした",
    );
    return "failed";
  }

  // 構造化用の AbortSignal は残り時間で制限
  const remaining = Math.max(deadline - Date.now() - 3_000, 1_000);
  const stage2Signal = AbortSignal.any
    ? AbortSignal.any([signal, AbortSignal.timeout(remaining)])
    : AbortSignal.timeout(remaining);

  const structured = await structurer.structure(
    {
      reportMarkdown,
      sourceUrls,
      storeContext: {
        name: store.name,
        prefecture: store.prefecture,
        city: store.city,
        address: store.address,
        genre: store.genre,
        site_url: store.site_url,
      },
    },
    stage2Signal,
  );

  if (!structured.ok) {
    const errKind = structured.error.kind;
    if (errKind === "timeout") {
      // 実行中 timeout: error_log に記録して structuring のまま次 tick へ。
      // countStage2Timeouts が上限を検出したら次 tick で failed になる。
      await repos.deepResearch.appendJobError(job.id, {
        stage: "stage2",
        kind: "stage2_timeout",
        message: "Stage 2 構造化が timeout しました。次 tick で再試行します",
        occurred_at: new Date().toISOString(),
      });
      return "still_structuring";
    }
    const detail = extractStructurerMessage(structured.error);
    await markFailed(
      job,
      "stage2",
      `stage2_${errKind}`,
      detail
        ? `Stage 2 構造化に失敗しました (${errKind}): ${detail}`
        : `Stage 2 構造化に失敗しました (${errKind})`,
    );
    return "failed";
  }

  // 構造化成功 → research_reports に書込 + ジョブ done 化 + 完了通知
  const completedAt = new Date().toISOString();
  const durationSec = computeDurationSec(
    job.research_started_at ?? job.enqueued_at,
    completedAt,
  );

  const reportInsert: DeepResearchReportInsert = {
    job_id: job.id,
    store_id: job.store_id,
    category_1_basic: structured.data.category_1_basic,
    category_2_owner: structured.data.category_2_owner,
    category_3_menu: structured.data.category_3_menu,
    category_4_customer: structured.data.category_4_customer,
    category_5_marketing: structured.data.category_5_marketing,
    category_6_competitor: structured.data.category_6_competitor,
    category_7_owned_media: structured.data.category_7_owned_media,
    category_8_other: structured.data.category_8_other,
    hearing_questions: structured.data.hearing_questions as HearingQuestion[],
    full_markdown:
      structured.data.full_markdown.length > 0
        ? structured.data.full_markdown
        : reportMarkdown,
    all_source_urls: structured.data.all_source_urls,
    total_cost_yen: null,
    total_duration_sec: durationSec,
  };

  await repos.transaction(async ({ deepResearch }) => {
    await deepResearch.insertReport(reportInsert);
    await deepResearch.updateJobStatus(job.id, {
      status: "done",
      completed_at: completedAt,
    });
  });

  revalidateTag(CACHE_TAGS.deepResearchJob(job.id), "max");
  revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");

  await createDeepResearchNotification({
    kind: "deep_research_done",
    storeId: job.store_id,
    storeName: store.name,
    jobId: job.id,
    userId: job.user_id,
  });

  return "completed";
}

// ---------------------------------------------------------------------------
// Stage C — Start
// ---------------------------------------------------------------------------

async function startOneQueued(args: {
  job: DeepResearchJob;
  drClient: DeepResearchClient;
  signal: AbortSignal;
}): Promise<void> {
  const { job, drClient, signal } = args;
  const store = await repos.store.get(job.store_id);
  if (!store) {
    await markFailed(
      job,
      "stage1",
      "stage1_store_not_found",
      "Stage 1 起動前に対象店舗が見つかりませんでした",
    );
    return;
  }

  const prompts = buildDeepResearchPrompt({
    store: {
      name: store.name,
      prefecture: store.prefecture,
      city: store.city,
      address: store.address,
      genre: store.genre,
      site_url: store.site_url,
    },
  });

  try {
    const handle = await drClient.startTask(
      {
        systemPrompt: prompts.stage1.systemPrompt,
        userPrompt: prompts.stage1.userPrompt,
      },
      signal,
    );
    const startedAt = new Date().toISOString();
    await repos.deepResearch.updateJobStatus(job.id, {
      status: "researching",
      deep_research_task_id: handle.taskId,
      attempts: job.attempts + 1,
      research_started_at: startedAt,
    });
    revalidateTag(CACHE_TAGS.deepResearchJob(job.id), "max");
    revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
    revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  } catch (err) {
    const kind = inferErrorKind(err);
    await markFailed(job, "stage1", `stage1_${kind}`, summarizeError(err));
  }
}

// ---------------------------------------------------------------------------
// 共通ヘルパ
// ---------------------------------------------------------------------------

function hasTimeLeft(deadline: number, reserveMs: number): boolean {
  return Date.now() + reserveMs < deadline;
}

async function markFailed(
  job: DeepResearchJob,
  stage: "stage1" | "stage2",
  kind: string,
  message: string,
): Promise<void> {
  const occurredAt = new Date().toISOString();
  await repos.deepResearch.appendJobError(job.id, {
    stage,
    kind,
    message,
    occurred_at: occurredAt,
  });
  await repos.deepResearch.updateJobStatus(job.id, {
    status: "failed",
    completed_at: occurredAt,
  });
  revalidateTag(CACHE_TAGS.deepResearchJob(job.id), "max");
  revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
  await fireFailureNotification(job, message);
}

async function fireFailureNotification(
  job: DeepResearchJob,
  reasonSummary: string,
): Promise<void> {
  const store = await repos.store.get(job.store_id);
  if (!store) return; // 店舗削除済の場合は no-op
  await createDeepResearchNotification({
    kind: "deep_research_failed",
    storeId: job.store_id,
    storeName: store.name,
    jobId: job.id,
    userId: job.user_id,
    reasonSummary,
  });
}

async function maybeFireBudgetWarning(): Promise<void> {
  const cap = getMonthlyCap();
  const percent = getMonthlyWarningPercent();
  const threshold = Math.ceil((cap * percent) / 100);
  const ym = currentYearMonthJst();
  const current = await repos.deepResearch.countByMonth(ym);
  if (current >= threshold && current < cap) {
    // 二重発火を避ける単純な抑止策: 既に当該閾値超の admin 通知が今月作られていれば skip
    // (実装簡素化のため毎 tick で発火する場合があるが、通知集約 UI 側で dedup する想定)
    await createDeepResearchNotification({
      kind: "deep_research_budget_warning",
      percent,
      currentCount: current,
      monthlyCap: cap,
    });
  }
}

function currentYearMonthJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function computeDurationSec(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 1000);
}

function inferErrorKind(err: unknown): string {
  if (typeof err === "object" && err !== null && "kind" in err) {
    return String((err as { kind: unknown }).kind);
  }
  return "unknown";
}

/**
 * Stage 2 構造化エラーから、error_log に残すべき詳細メッセージを抽出する純関数。
 *
 * - `message?` を持つ variant (api_error / auth_error / rate_limit /
 *   network_error / timeout / invalid_json / unknown) はその値を返す
 * - `schema_violation` は Zod issue を `" | "` で結合
 * - それ以外は undefined (kind 名だけで十分なケース)
 */
export function extractStructurerMessage(
  err: StructurerError,
): string | undefined {
  if ("message" in err && typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  if (err.kind === "schema_violation") {
    return err.zodIssues.join(" | ");
  }
  return undefined;
}

function summarizeError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") {
      return String(obj.message);
    }
    if (typeof obj.kind === "string") {
      const status = typeof obj.status === "number" ? ` (HTTP ${obj.status})` : "";
      return `${obj.kind}${status}`;
    }
  }
  return "Deep Research API 呼出で不明なエラーが発生";
}

// テスト用 export (kiro-impl の Implementation Notes 参照)
export const __internal = {
  hasTimeLeft,
  shouldPollJob,
  sweepStuckJob,
  pollOneResearching,
  processOneStructuring,
  runStage2AndFinalize,
  countStage2Timeouts,
  startOneQueued,
};

// ストア型を限定 import するための副参照
export type _Store = Store;
