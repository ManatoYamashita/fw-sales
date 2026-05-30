"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/utils/relative-time";
import {
  pollGeminiJobAction,
  type PollGeminiResult,
} from "@/lib/actions/deep-research-actions";
import type { JobStatus } from "@/types/deep-research";

interface GeminiLiveStatusCardProps {
  jobId: string;
  status: JobStatus;
  taskId: string | null;
  apiUpdatedAtFromDb: string | null;
}

const COOLDOWN_MS = 10_000;

const STATE_META: Record<
  PollGeminiResult["state"],
  {
    label: string;
    tone: "info" | "success" | "destructive";
    description: string;
  }
> = {
  in_progress: {
    label: "進行中",
    tone: "info",
    description: "Gemini Deep Research が継続中です",
  },
  completed: {
    label: "完了",
    tone: "success",
    description: "cron が次 tick で Stage 2 構造化を実行します",
  },
  failed: {
    label: "失敗",
    tone: "destructive",
    description: "次 cron tick でジョブが failed に遷移します",
  },
};

export function GeminiLiveStatusCard({
  jobId,
  status,
  taskId,
  apiUpdatedAtFromDb,
}: GeminiLiveStatusCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<PollGeminiResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
  const ranOnceRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canPoll = status === "researching" && !!taskId;
  const cooldownActive = cooldownRemainingMs > 0;

  const startCooldown = useCallback(() => {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    // 残秒数を 1s 間隔で減算。`Date.now()` は effect 内クロージャでのみ使い、
    // React 19 の component-purity ルール (render 中の impure 呼出禁止) に抵触しない。
    const endsAt = Date.now() + COOLDOWN_MS;
    const tick = () => {
      const remain = Math.max(endsAt - Date.now(), 0);
      setCooldownRemainingMs(remain);
      if (remain === 0 && cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
    tick();
    cooldownTimerRef.current = setInterval(tick, 1000);
  }, []);

  const runPoll = useCallback(() => {
    if (!canPoll) return;
    startTransition(async () => {
      const result = await pollGeminiJobAction(jobId);
      const nowIso = new Date().toISOString();
      if (result.ok) {
        setLastResult(result.data);
        setLastError(null);
        setLastPolledAt(result.data.polledAt);
        router.refresh();
      } else {
        setLastError(result.error);
        setLastPolledAt(nowIso);
      }
      startCooldown();
    });
  }, [canPoll, jobId, router, startCooldown]);

  useEffect(() => {
    if (!canPoll) return;
    if (ranOnceRef.current) return;
    ranOnceRef.current = true;
    runPoll();
  }, [canPoll, runPoll]);

  useEffect(
    () => () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    },
    [],
  );

  if (!canPoll) {
    return null;
  }

  const buttonDisabled = pending || cooldownActive;
  const cooldownRemainingSec = Math.ceil(cooldownRemainingMs / 1000);
  const buttonLabel = pending
    ? "問合せ中…"
    : cooldownActive
      ? `次の問合せまで ${cooldownRemainingSec}s`
      : "更新";
  const buttonTitle = pending
    ? "Gemini に問合せ中です。完了までしばらくお待ちください。"
    : cooldownActive
      ? `連続呼出を抑止するクールダウン中です (残り ${cooldownRemainingSec}s)。`
      : "Gemini に最新状態を問合せる";
  const displayState = lastResult?.state;
  const displayApiUpdatedAt =
    lastResult?.apiUpdatedAt ?? apiUpdatedAtFromDb ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gemini ライブ状態</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={runPoll}
          disabled={buttonDisabled}
          aria-label={buttonTitle}
          title={buttonTitle}
        >
          {pending ? (
            <Spinner />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {buttonLabel}
        </Button>
      </CardHeader>
      <CardBody>
        <div aria-live="polite" aria-atomic="true">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Gemini 状態</dt>
            <dd>
              {pending && !displayState ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Spinner />
                  問合せ中…
                </span>
              ) : displayState ? (
                <span className="inline-flex items-center gap-2">
                  <Badge tone={STATE_META[displayState].tone}>
                    {STATE_META[displayState].label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {STATE_META[displayState].description}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">未取得</span>
              )}
            </dd>

            <dt className="text-muted-foreground">最終問合せ</dt>
            <dd
              title={
                lastPolledAt
                  ? new Date(lastPolledAt).toLocaleString("ja-JP")
                  : undefined
              }
            >
              {formatRelativeTime(lastPolledAt)}
            </dd>

            <dt className="text-muted-foreground">Gemini 側更新</dt>
            <dd
              title={
                displayApiUpdatedAt
                  ? new Date(displayApiUpdatedAt).toLocaleString("ja-JP")
                  : undefined
              }
            >
              {formatRelativeTime(displayApiUpdatedAt)}
            </dd>
          </dl>

          {(lastError || lastResult?.message) && (
            <p className="mt-3 text-xs text-destructive break-words">
              {lastError ?? lastResult?.message}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
