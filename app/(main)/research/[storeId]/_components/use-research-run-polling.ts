"use client";

/**
 * running中の `store_research_runs` をポーリングして最新状態を返すhook(PR4)。
 *
 * Cache Components / Server Actionsには組み込みのpolling機構が無いため、
 * `getResearchRunStatusAction` を一定間隔で呼ぶ素朴な実装とする(`lib/actions/
 * research-run-actions.ts` 参照)。`status !== "running"` になった時点で自動停止する。
 *
 * #324: 進捗を取得できなかったこと (Action の失敗・通信の例外) を呼び出し側へ返す。
 * 取得できないことは調査の失敗ではないので、run の状態は変えずに別の表示にする。
 * 取得に失敗してもポーリングは続け、次に取得できた時点で表示を戻す。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getResearchRunStatusAction } from "@/lib/actions/research-run-actions";
import { isRunStuck } from "@/lib/domain/research-review";
import type { StoreResearchRun } from "@/types/research-run";

const POLL_INTERVAL_MS = 4000;

/** `getResearchRunStatusAction` が未ログイン時に返す文。 */
export const STATUS_CHECK_SIGNED_OUT_ERROR = "ログインが必要です";

/**
 * 進捗を取得できなかった理由。
 *
 * - `signed_out`: ログインが切れている。再ログインが要る
 * - `rejected`: Action が理由付きで断った (run が見つからない等)。`message` は Action が返す
 *   利用者向けの固定文で、例外の中身ではない
 * - `network`: 応答が返らなかった (通信断・サーバの例外)
 */
export type StatusCheckProblem =
  | { kind: "signed_out" }
  | { kind: "rejected"; message: string }
  | { kind: "network" };

export function classifyStatusCheckFailure(error: string | null): StatusCheckProblem {
  if (error === null) return { kind: "network" };
  if (error === STATUS_CHECK_SIGNED_OUT_ERROR) return { kind: "signed_out" };
  return { kind: "rejected", message: error };
}

export type StatusCheckOutcome =
  | { ok: true; run: StoreResearchRun }
  | { ok: false; problem: StatusCheckProblem };

/**
 * 進捗を 1 回取得し、結果を「最新の run」か「取得できなかった理由」に分ける。
 * 例外は外へ漏らさない (`startTransition` 外の interval から呼ぶため、漏れると未処理の
 * rejection になり、画面には何も出ない)。
 */
export async function checkResearchRunStatus(
  runId: string,
  fetchStatus: typeof getResearchRunStatusAction = getResearchRunStatusAction,
): Promise<StatusCheckOutcome> {
  try {
    const res = await fetchStatus(runId);
    return res.ok
      ? { ok: true, run: res.data }
      : { ok: false, problem: classifyStatusCheckFailure(res.error) };
  } catch {
    return { ok: false, problem: classifyStatusCheckFailure(null) };
  }
}

export interface ResearchRunPolling {
  /** 直近の取得に失敗していれば、その理由。取得できたら null に戻る。 */
  problem: StatusCheckProblem | null;
  /** 「進捗を再確認」で今すぐ取得している間 true。 */
  rechecking: boolean;
  recheck: () => void;
}

export function useResearchRunPolling(
  run: StoreResearchRun,
  onUpdate: (next: StoreResearchRun) => void,
): ResearchRunPolling {
  const [problem, setProblem] = useState<StatusCheckProblem | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const inFlight = useRef(false);
  // interval から最新の onUpdate を呼ぶため ref に置く (毎回 interval を張り直さない)。
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  const check = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    const outcome = await checkResearchRunStatus(run.id);
    inFlight.current = false;
    if (outcome.ok) {
      setProblem(null);
      onUpdateRef.current(outcome.run);
    } else {
      setProblem(outcome.problem);
    }
  }, [run.id]);

  useEffect(() => {
    if (run.status !== "running") return;

    let cancelled = false;
    const pollTimer = setInterval(() => {
      if (!cancelled) void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, [run.status, check]);

  const recheck = useCallback(() => {
    setRechecking(true);
    void check().finally(() => setRechecking(false));
  }, [check]);

  return { problem, rechecking, recheck };
}

export function useElapsedSeconds(startedAt: string, active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - Date.parse(startedAt));

  useEffect(() => {
    if (!active) return;
    const startedAtMs = Date.parse(startedAt);
    const tick = () => setElapsedMs(Date.now() - startedAtMs);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt, active]);

  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/** `setTimeout` に渡せる最大の待ち時間 (約 24.8 日)。超えると即時に発火してしまう。 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * 主表示 run が running のまま期限 (`expires_at`) を過ぎているか (`isRunStuck`)。
 *
 * 上部の手順表示と本文の進捗カードは、この 1 つの値を共有して切り替える (#324)。
 * 期限ちょうどに再描画するタイマーを張るので、ポーリングが止まっていても両方が同じ
 * 描画で切り替わる。
 */
export function useRunOverdue(
  run: Pick<StoreResearchRun, "status" | "expires_at"> | null,
): boolean {
  const running = run?.status === "running";
  const expiresAt = run?.expires_at ?? null;
  const [, setDeadlineTick] = useState(0);

  useEffect(() => {
    if (!running || expiresAt === null) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (!(remaining > 0)) return;
    const timer = setTimeout(
      () => setDeadlineTick((n) => n + 1),
      Math.min(remaining + 50, MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(timer);
  }, [running, expiresAt]);

  return run !== null && isRunStuck(run, new Date().toISOString());
}
