"use client";

/** 過去の調査結果の簡易一覧(Plan v3.2 §5.9)。主表示run以外を折りたたみ表示する。 */

import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/date";
import type { StoreResearchRun } from "@/types/research-run";

const STATUS_LABELS: Record<string, string> = {
  running: "実行中",
  succeeded: "成功",
  failed: "失敗",
};

export function PastRunsList({ runs }: { runs: readonly StoreResearchRun[] }) {
  return (
    <details className="border border-border rounded-lg">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-foreground bg-muted/30 rounded-lg">
        過去の調査結果({runs.length}件)
      </summary>
      <ul className="divide-y divide-border">
        {runs.map((run) => (
          <li key={run.id} className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{formatDateTime(run.started_at)}</span>
            <div className="flex items-center gap-2">
              {run.status === "succeeded" && run.review_completed_at === null && (
                <Badge tone="warning">要確認</Badge>
              )}
              <Badge tone={run.status === "succeeded" ? "success" : run.status === "failed" ? "destructive" : "secondary"}>
                {STATUS_LABELS[run.status] ?? run.status}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
