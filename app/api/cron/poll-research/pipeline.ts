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
import type { Structurer } from "@/lib/ai/deep-research/structurer";
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
  completed: number;
  started: number;
  deadline_reached: boolean;
}

/** 操作ごとの残り時間最小要件 (ms)。 */
const RESERVE_STAGE2_MS = 10_000; // Stage 2 構造化に必要な目安
const RESERVE_START_MS = 5_000; // startTask 1 件に必要な目安
const RESERVE_POLL_ONE_MS = 2_000; // getTask 1 件に必要な目安
const RESERVE_SWEEP_ONE_MS = 3_000; // cancelTask + DB write に必要な目安
const STUCK_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 時間

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

  // ---- Stage B: Polling fan-out --------------------------------------------
  if (!result.deadline_reached) {
    const pollLimit = getPollPerTick();
    const researching = await repos.deepResearch.findOldestResearching(pollLimit);
    for (const job of researching) {
      if (!hasTimeLeft(deadline, RESERVE_POLL_ONE_MS)) {
        result.deadline_reached = true;
        break;
      }
      const outcome = await pollOneResearching({
        job,
        drClient,
        structurer,
        deadline,
        signal,
      });
      result.polled += 1;
      if (outcome === "completed") result.completed += 1;
    }
  }

  // ---- Stage C: Start fan-in -----------------------------------------------
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
  await fireFailureNotification(job, errorEntry.message);
}

// ---------------------------------------------------------------------------
// Stage B — Polling
// ---------------------------------------------------------------------------

async function pollOneResearching(args: {
  job: DeepResearchJob;
  drClient: DeepResearchClient;
  structurer: Structurer;
  deadline: number;
  signal: AbortSignal;
}): Promise<"completed" | "still_running" | "failed" | "deadline"> {
  const { job, drClient, structurer, deadline, signal } = args;
  if (!job.deep_research_task_id) {
    // 想定外 (researching なのに task_id がない) → 失敗扱い
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

  if (state.state === "in_progress") return "still_running";

  if (state.state === "failed") {
    await markFailed(job, "stage1", "stage1_failed", state.reason);
    return "failed";
  }

  // completed: 残り時間 ≥ 10s なら Stage 2 構造化、足りなければ次 tick へ送る
  if (!hasTimeLeft(deadline, RESERVE_STAGE2_MS)) {
    return "deadline";
  }

  await runStage2AndFinalize({
    job,
    completedState: state,
    structurer,
    deadline,
    signal,
  });
  return "completed";
}

async function runStage2AndFinalize(args: {
  job: DeepResearchJob;
  completedState: Extract<DeepResearchTaskState, { state: "completed" }>;
  structurer: Structurer;
  deadline: number;
  signal: AbortSignal;
}): Promise<void> {
  const { job, completedState, structurer, deadline, signal } = args;
  const now = new Date().toISOString();

  // 状態を structuring に遷移、完了時刻も記録
  await repos.deepResearch.updateJobStatus(job.id, {
    status: "structuring",
    research_completed_at: now,
  });

  const store = await repos.store.get(job.store_id);
  if (!store) {
    await markFailed(
      job,
      "stage2",
      "stage2_store_not_found",
      "Stage 2 構造化前に対象店舗が見つかりませんでした",
    );
    return;
  }

  // 構造化用の AbortSignal は残り時間で制限
  const remaining = Math.max(deadline - Date.now() - 3_000, 1_000);
  const stage2Signal = AbortSignal.any
    ? AbortSignal.any([signal, AbortSignal.timeout(remaining)])
    : AbortSignal.timeout(remaining);

  const structured = await structurer.structure(
    {
      reportMarkdown: completedState.reportMarkdown,
      sourceUrls: completedState.sourceUrls,
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
    await markFailed(
      job,
      "stage2",
      `stage2_${errKind}`,
      `Stage 2 構造化に失敗しました (${errKind})`,
    );
    return;
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
        : completedState.reportMarkdown,
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

  revalidateTag(CACHE_TAGS.deepResearchByStore(job.store_id), "max");
  revalidateTag(CACHE_TAGS.deepResearchQueue, "max");

  await createDeepResearchNotification({
    kind: "deep_research_done",
    storeId: job.store_id,
    storeName: store.name,
    jobId: job.id,
    userId: job.user_id,
  });
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

function summarizeError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    if ("message" in err && typeof (err as { message?: unknown }).message === "string") {
      return String((err as { message: string }).message);
    }
    if ("kind" in err) {
      return `error kind=${String((err as { kind: unknown }).kind)}`;
    }
  }
  return "Deep Research API 呼出で正規化済エラーが発生";
}

// テスト用 export (kiro-impl の Implementation Notes 参照)
export const __internal = {
  hasTimeLeft,
  sweepStuckJob,
  pollOneResearching,
  startOneQueued,
};

// ストア型を限定 import するための副参照
export type _Store = Store;
