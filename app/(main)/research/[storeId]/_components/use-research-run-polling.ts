"use client";

/**
 * running中の `store_research_runs` をポーリングして最新状態を返すhook(PR4)。
 *
 * Cache Components / Server Actionsには組み込みのpolling機構が無いため、
 * `getResearchRunStatusAction` を一定間隔で呼ぶ素朴な実装とする(`lib/actions/
 * research-run-actions.ts` 参照)。`status !== "running"` になった時点で自動停止する。
 */

import { useEffect, useState } from "react";
import { getResearchRunStatusAction } from "@/lib/actions/research-run-actions";
import type { StoreResearchRun } from "@/types/research-run";

const POLL_INTERVAL_MS = 4000;

export function useResearchRunPolling(
  run: StoreResearchRun,
  onUpdate: (next: StoreResearchRun) => void,
): void {
  useEffect(() => {
    if (run.status !== "running") return;

    let cancelled = false;
    const pollTimer = setInterval(async () => {
      const res = await getResearchRunStatusAction(run.id);
      if (cancelled) return;
      if (res.ok) onUpdate(res.data);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run.id/status の変化のみで再起動すれば十分
  }, [run.id, run.status]);
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
