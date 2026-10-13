import "server-only";

/**
 * アプリの調査 run (`store_research_runs`) と Workflow SDK の実行 (Workflow run) を
 * 関連付け、実行基盤の終了状態をアプリの run へ反映する (Issue #324)。
 *
 * ## なぜ必要か
 *
 * `startResearchRunAction` は `start()` が起動を enqueue した時点で戻る。その後、
 * Workflow 本体の最初の step に届く前に実行基盤で失敗すると (実例: `VERCEL_URL` が空文字で
 * `TypeError: Invalid URL`)、`markFailedStep` も Action の catch も走らず、アプリの run は
 * `running` のまま `expires_at` (30 分) まで「実行中」と表示され続けた。
 *
 * そこで起動時に Workflow run ID をアプリの run に記録し、進捗の取得
 * (`getResearchRunStatusAction`) のたびに実行基盤の状態を確かめる。実行基盤が終了
 * (`failed` / `cancelled` / `completed`) しているのにアプリの run が `running` のままなら、
 * もう誰も更新しないので `failed` として記録する。
 *
 * ## 記録先
 *
 * 列を増やさず、既存の jsonb 列 `token_usage` に `{ workflow_run_id }` として置く
 * (列の追加は「migration だけの PR → 適用 → コードの PR」の 2 段階が要るため)。
 * `token_usage` は run が終わるまで Workflow から書かれない列で、成功・失敗の記録時に
 * 丸ごと置き換わる。突き合わせが必要なのは `running` の間だけなので、それで足りる。
 *
 * ## 書き込みは compare-and-swap のみ
 *
 * どちらの書き込みも `updateIfRunning` (status が running の行だけを更新) を使う。
 * Workflow 自身が成功・失敗を記録し終えていれば 0 行更新になり、その記録
 * (より詳しい `error_kind`) を上書きしない。
 */

import { getRun } from "workflow/api";
import { repos } from "@/lib/repositories";
import { nowIso } from "@/lib/utils/date";
import type { StoreResearchRun, StoreResearchRunPatch } from "@/types/research-run";

/** `token_usage` の中で Workflow run ID を置くキー。 */
export const WORKFLOW_RUN_ID_KEY = "workflow_run_id";

/** 実行基盤の終了状態ごとに記録する `error_kind`。表示文言は `research-failed-card.tsx`。 */
export const WORKFLOW_RUN_ENDED_ERROR_KINDS = {
  failed: "workflow_run_failed",
  cancelled: "workflow_run_cancelled",
  // Workflow 本体は成功を記録してから終わるので、ここに来るのは記録に失敗した場合だけ。
  completed: "workflow_run_completed_without_result",
} as const;

type EndedWorkflowStatus = keyof typeof WORKFLOW_RUN_ENDED_ERROR_KINDS;

function isEndedWorkflowStatus(status: string): status is EndedWorkflowStatus {
  return Object.hasOwn(WORKFLOW_RUN_ENDED_ERROR_KINDS, status);
}

/**
 * 失敗を記録するときの `error_message`。`workflows/store-research.ts` の
 * `FAILED_RUN_MESSAGE` と同じ固定文で、例外の中身は保存しない (RSC payload に載るため)。
 */
const FAILED_RUN_MESSAGE = "AI店舗調査に失敗しました";

/**
 * 実行基盤へ状態を問い合わせる上限。Server Action はクライアントから 1 つずつ送られるため、
 * 問い合わせが詰まると同じ画面の他の操作まで待たされる。
 */
export const WORKFLOW_STATUS_TIMEOUT_MS = 3_000;

/**
 * 空文字の `VERCEL_URL` を未定義に戻す。
 *
 * Workflow SDK 5.0.0-beta.38 は `process.env.VERCEL_URL !== undefined` で Vercel 上かを判定し、
 * 空文字でも `https://` を URL として組み立てて `TypeError: Invalid URL` で失敗する
 * (`@workflow/core/dist/workflow.js` の `runWorkflow`、`dist/runtime/step-executor.js` の
 * `executeStep`)。Vercel は常に値の入った `VERCEL_URL` を渡すので、空文字は Vercel の外で
 * 「Vercel ではない」つもりで渡されたものとみなしてよい。
 *
 * ローカルでは Action と Workflow の実行が同じ Node プロセスで動くため、`start()` の前に
 * 直せば、続く Workflow の実行にも効く。
 */
export function dropBlankVercelUrl(env: Record<string, string | undefined> = process.env): void {
  if (env.VERCEL_URL !== undefined && env.VERCEL_URL.trim() === "") {
    delete env.VERCEL_URL;
  }
}

/** アプリの run に記録された Workflow run ID。記録が無ければ null。 */
export function readWorkflowRunId(run: Pick<StoreResearchRun, "token_usage">): string | null {
  const value = run.token_usage?.[WORKFLOW_RUN_ID_KEY];
  return typeof value === "string" && value !== "" ? value : null;
}

interface RunWriter {
  updateIfRunning(id: string, patch: StoreResearchRunPatch): Promise<StoreResearchRun | null>;
  get(id: string): Promise<StoreResearchRun | null>;
}

export interface WorkflowRunSyncDeps {
  /** Workflow run の状態 (`pending` / `running` / `completed` / `failed` / `cancelled`)。 */
  getWorkflowRunStatus(workflowRunId: string): Promise<string>;
  runs: RunWriter;
  now(): string;
  timeoutMs: number;
}

const defaultDeps: WorkflowRunSyncDeps = {
  getWorkflowRunStatus: (workflowRunId) => getRun(workflowRunId).status,
  runs: repos.researchRun,
  now: nowIso,
  timeoutMs: WORKFLOW_STATUS_TIMEOUT_MS,
};

/** 例外の中身は出さず、種類だけをログに残す (`research-run-actions.ts` と同じ規約)。 */
function errorIdentity(err: unknown) {
  return {
    error_name: err instanceof Error ? err.name : typeof err,
    error_constructor: (err as { constructor?: { name?: string } } | null)?.constructor?.name,
  };
}

/**
 * 起動した Workflow run の ID をアプリの run に記録する。
 *
 * 記録できなくても調査は進んでいるので、例外は投げずにログだけ残す (突き合わせが
 * できない run は、従来どおり `expires_at` を過ぎた時点で時間超過として扱われる)。
 */
export async function linkWorkflowRun(
  runId: string,
  workflowRunId: string,
  runs: Pick<RunWriter, "updateIfRunning"> = repos.researchRun,
): Promise<void> {
  try {
    await runs.updateIfRunning(runId, { token_usage: { [WORKFLOW_RUN_ID_KEY]: workflowRunId } });
  } catch (err) {
    console.error("[research.workflowRun] link failed", { runId, ...errorIdentity(err) });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("workflow status timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface WorkflowRunSyncResult {
  run: StoreResearchRun;
  /** この呼び出しでアプリの run を failed にしたか。 */
  markedFailed: boolean;
}

/**
 * `running` のアプリ run について、実行基盤が終了していれば `failed` として記録する。
 *
 * 実行基盤に問い合わせられない (通信失敗・時間切れ・run が見つからない) ときは、
 * 失敗とは断定せず、アプリの run をそのまま返す。
 */
export async function syncRunWithWorkflow(
  run: StoreResearchRun,
  deps: WorkflowRunSyncDeps = defaultDeps,
): Promise<WorkflowRunSyncResult> {
  const unchanged = { run, markedFailed: false };
  if (run.status !== "running") return unchanged;
  const workflowRunId = readWorkflowRunId(run);
  if (workflowRunId === null) return unchanged;

  let workflowStatus: string;
  try {
    workflowStatus = await withTimeout(
      deps.getWorkflowRunStatus(workflowRunId),
      deps.timeoutMs,
    );
  } catch (err) {
    console.warn("[research.workflowRun] status unavailable", {
      runId: run.id,
      ...errorIdentity(err),
    });
    return unchanged;
  }
  if (!isEndedWorkflowStatus(workflowStatus)) return unchanged;

  const errorKind = WORKFLOW_RUN_ENDED_ERROR_KINDS[workflowStatus];
  const updated = await deps.runs.updateIfRunning(run.id, {
    status: "failed",
    error_kind: errorKind,
    error_message: FAILED_RUN_MESSAGE,
    finished_at: deps.now(),
  });
  if (updated === null) {
    // 問い合わせの間に Workflow 自身が結果を記録した。そちらを返す。
    return { run: (await deps.runs.get(run.id)) ?? run, markedFailed: false };
  }

  console.error("[research.workflowRun] ended without updating the app run", {
    runId: run.id,
    workflow_status: workflowStatus,
    error_kind: errorKind,
  });
  return { run: updated, markedFailed: true };
}
