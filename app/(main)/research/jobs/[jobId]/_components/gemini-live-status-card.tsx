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

/**
 * Google 側 dead-lock 判定の閾値 (ms)。
 *
 * Gemini Deep Research が `usage === null` (= トークン消費ゼロ) かつ
 * `apiCreatedAt === apiUpdatedAt` (= 内部状態が一度も更新されていない)
 * のまま **これ以上の時間が経過** したら、Google バックエンドが
 * このタスクを受領後一切処理していない可能性が高い。
 *
 * 2026-05-30 mpsh1mj9 実観測: created=14:56:39, updated=14:56:39 のまま 2h 経過、
 * usage=null。ユーザーがキャンセル + 再投入で復旧。
 *
 * 30 分は「Stage 1 通常下限 (30 分〜2 時間)」の下端と一致させ、
 * 「正常に Web 探索中なら usage は数千 token は乗っているはず」という前提に基づく。
 */
const DEADLOCK_DETECTION_MS = 30 * 60 * 1000;

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
  /**
   * 「いま」の Unix ms。dead-lock 判定の経過時間計算に使う。
   * `Date.now()` を render path で直接呼ぶと React 19 purity 規約に
   * 違反するため、effect 内で 30 秒間隔に更新して state 経由で参照する。
   */
  const [nowMs, setNowMs] = useState(0);
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

  // dead-lock 判定用の現在時刻を 5 秒間隔で更新。
  // `setState` を effect 本体で同期実行すると `react-hooks/set-state-in-effect`
  // (cascading render リスク) で叱られるため、interval callback のみで更新する。
  // mount 直後の 5 秒間は `nowMs === 0` で判定がスキップされる (許容)。
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

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
  const displayApiCreatedAt = lastResult?.apiCreatedAt ?? null;
  const displayApiUpdatedAt =
    lastResult?.apiUpdatedAt ?? apiUpdatedAtFromDb ?? null;
  const displayTokenUsage = lastResult?.tokenUsage ?? null;

  // Dead-lock 判定: in_progress, usage=null, created=updated, 経過時間 > 閾値
  const deadlockSuspicion = (() => {
    if (nowMs === 0) return null; // useEffect 起動前 (SSR)
    if (displayState !== "in_progress") return null;
    if (displayTokenUsage !== null) return null;
    if (!displayApiCreatedAt || !displayApiUpdatedAt) return null;
    if (displayApiCreatedAt !== displayApiUpdatedAt) return null;
    const createdMs = Date.parse(displayApiCreatedAt);
    if (!Number.isFinite(createdMs)) return null;
    const elapsedMs = nowMs - createdMs;
    if (elapsedMs < DEADLOCK_DETECTION_MS) return null;
    return {
      elapsedMinutes: Math.floor(elapsedMs / 60_000),
      createdIso: displayApiCreatedAt,
    };
  })();

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

            <dt className="text-muted-foreground">Gemini 側受領</dt>
            <dd
              title={
                displayApiCreatedAt
                  ? new Date(displayApiCreatedAt).toLocaleString("ja-JP")
                  : undefined
              }
            >
              {displayApiCreatedAt
                ? formatRelativeTime(displayApiCreatedAt)
                : "—"}
            </dd>

            <dt className="text-muted-foreground">トークン使用</dt>
            <dd>
              {displayTokenUsage ? (
                <span className="tabular-nums">
                  入力 {displayTokenUsage.promptTokens.toLocaleString()} /
                  出力 {displayTokenUsage.outputTokens.toLocaleString()}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  0 (Google 側で計算リソース未投入)
                </span>
              )}
            </dd>
          </dl>

          {deadlockSuspicion && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-foreground"
            >
              <p className="font-semibold text-warning">
                Google 側で処理が停滞している可能性があります
              </p>
              <p className="mt-1 text-foreground/80">
                受領から{deadlockSuspicion.elapsedMinutes}分経過していますが、
                トークン消費が 0、かつ Gemini 内部状態が一度も更新されていません
                (created === updated)。Google
                バックエンドがこのタスクを dead-lock している可能性があります。
                キャンセル + 再投入をご検討ください
                (放置すれば 6 時間後に自動 sweep されます)。
              </p>
            </div>
          )}

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
