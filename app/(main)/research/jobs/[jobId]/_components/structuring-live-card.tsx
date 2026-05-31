"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/utils/relative-time";
import { advanceStructuringAction } from "@/lib/actions/deep-research-actions";
import type { JobStatus } from "@/types/deep-research";

/**
 * Stage 2 (構造化中) ジョブ詳細ページのライブ進行 Card。
 *
 * researching の `GeminiLiveStatusCard` と対称。GitHub Actions cron が遅延しても、
 * 画面を開いている間は一定間隔で `advanceStructuringAction` を呼び、Stage 2
 * 構造化を能動的に前進させる。`status` が structuring を外れたら監視を止め、
 * `router.refresh()` で画面を最新化する。
 *
 * 設計上の注意:
 * - Stage 2 は重い (Gemini 構造化呼出)。間隔ポーリングは単一フライト
 *   (`inFlightRef`) で連打・自己並行を防ぐ。
 * - 並行 cron tick との競合は action 側で UNIQUE(job_id) 違反を握りつぶすため、
 *   レポート重複や誤 failed は起きない。
 */

const POLL_INTERVAL_MS = 15_000;

interface StructuringLiveCardProps {
  jobId: string;
  status: JobStatus;
  attempts: number;
}

export function StructuringLiveCard({
  jobId,
  status,
  attempts,
}: StructuringLiveCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const active = status === "structuring";

  const runAdvance = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    startTransition(async () => {
      try {
        const result = await advanceStructuringAction(jobId);
        setLastPolledAt(new Date().toISOString());
        if (result.ok) {
          setLastError(null);
          if (result.data.status !== status) {
            // 構造化が done / failed に確定した。画面を最新化する。
            router.refresh();
          }
        } else {
          setLastError(result.error);
        }
      } finally {
        inFlightRef.current = false;
      }
    });
  }, [jobId, status, router]);

  // structuring の間だけ一定間隔で構造化を前進させる。
  useEffect(() => {
    if (!active) return;
    const id = setInterval(runAdvance, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, runAdvance]);

  if (!active) return null;

  const intervalSec = Math.round(POLL_INTERVAL_MS / 1000);

  return (
    <Card>
      <CardHeader>
        <CardTitle>構造化ライブ状態</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={runAdvance}
          disabled={pending}
          aria-label="Stage 2 構造化を今すぐ実行する"
          title="Stage 2 構造化を今すぐ実行する"
        >
          {pending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
          {pending ? "構造化処理中…" : "今すぐ構造化"}
        </Button>
      </CardHeader>
      <CardBody>
        <div aria-live="polite" aria-atomic="true">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">状態</dt>
            <dd>
              <span className="inline-flex items-center gap-2">
                <Badge tone="info">構造化中</Badge>
                <span className="text-xs text-muted-foreground">
                  Stage 1 のレポートを 51 項目 JSON に構造化しています
                </span>
              </span>
            </dd>

            <dt className="text-muted-foreground">最終確認</dt>
            <dd
              title={
                lastPolledAt
                  ? new Date(lastPolledAt).toLocaleString("ja-JP")
                  : undefined
              }
            >
              {formatRelativeTime(lastPolledAt)}
            </dd>

            <dt className="text-muted-foreground">試行回数</dt>
            <dd>{attempts}</dd>
          </dl>

          <p className="mt-3 text-xs text-muted-foreground">
            画面を開いている間は約 {intervalSec}{" "}
            秒ごとに自動で構造化を進めます (cron 遅延時の保険)。
          </p>

          {lastError && (
            <p className="mt-2 text-xs text-destructive break-words">
              {lastError}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
