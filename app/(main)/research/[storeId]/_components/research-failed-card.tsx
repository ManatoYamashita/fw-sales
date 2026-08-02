"use client";

/** 調査失敗カード(Plan v3.2 §5.8)。エラー種別で文言を出し分ける。自動リトライはしない。 */

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { StoreResearchRun } from "@/types/research-run";

/**
 * `run.error_kind` は `workflows/store-research.ts:deriveErrorKind` が
 * `"retryable_exhausted"` または `"retryable_exhausted:api_error:503"` のように
 * prefix + sanitized kind の形で返すため、前方一致で判定する(完全一致にすると
 * HTTP status 付与後の値を取りこぼす、observability bug 修正で発見)。
 */
export function errorMessage(run: Pick<StoreResearchRun, "error_kind" | "error_message">): string {
  if (run.error_kind?.startsWith("retryable_exhausted") === true) {
    return "AI 調査が一時的なエラーで失敗しました(再試行済み)。再度お試しください。";
  }
  if (run.error_message) return run.error_message;
  return "AI 調査に失敗しました。再度お試しください。";
}

export function ResearchFailedCard({
  run,
  onRetry,
  retrying,
}: {
  run: StoreResearchRun;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>AI店舗調査</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">調査に失敗しました</p>
            <p className="text-muted-foreground mt-0.5">{errorMessage(run)}</p>
          </div>
        </div>
        <div className="flex justify-center py-1">
          <Button type="button" variant="primary" onClick={onRetry} disabled={retrying}>
            <RotateCcw className="h-3.5 w-3.5" />
            {retrying ? "開始中…" : "再調査する"}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
