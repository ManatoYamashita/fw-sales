"use client";

/**
 * 調査中カード(Plan v3.2 §5.2)。runの`stage`をポーリングして進捗表示に反映する。
 *
 * #324 で次の 3 つを区別して表示する:
 * - 目安 (3〜5分) を過ぎても期限前なら、正常な長時間処理として待つよう伝える
 * - 期限 (`expires_at`) を過ぎたら異常として示す。ただし止まった確証は無いので
 *   「中断しました」とは言わない (`overdue` は上部の手順表示と共有する)
 * - 進捗を取得できないときは「進捗を確認できません」と出し、調査の失敗とは分ける
 */

import Link from "next/link";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useElapsedSeconds,
  useResearchRunPolling,
  type StatusCheckProblem,
} from "./use-research-run-polling";
import type { StoreResearchRun, StoreResearchRunStage } from "@/types/research-run";

/** 画面に示している目安 (3〜5分) の上限。これを過ぎても失敗とは扱わない。 */
export const EXPECTED_MAX_SECONDS = 5 * 60;

const STEPS: ReadonlyArray<{ stage: StoreResearchRunStage | "start"; label: string }> = [
  { stage: "start", label: "店舗を確認" },
  { stage: "discovering", label: "Web情報源を検索" },
  { stage: "researching", label: "店舗情報を取得・分析中" },
  { stage: "done", label: "結果を整理" },
];

function stepStatus(
  stepStage: StoreResearchRunStage | "start",
  currentStage: StoreResearchRunStage | null,
): "done" | "active" | "pending" {
  const order: ReadonlyArray<StoreResearchRunStage | "start"> = [
    "start",
    "discovering",
    "researching",
    "done",
  ];
  const currentIndex = order.indexOf(currentStage ?? "start");
  const stepIndex = order.indexOf(stepStage);
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}分${s}秒`;
}

/** 進捗を取得できなかったときの文。調査そのものの失敗ではないことを含める。 */
export function statusCheckProblemMessage(problem: StatusCheckProblem): string {
  switch (problem.kind) {
    case "signed_out":
      return "進捗を確認できません。ログインの有効期限が切れた可能性があります。ログインし直してから、このページを開き直してください。";
    case "rejected":
      return `進捗を確認できません(${problem.message})。ページを再読み込みして、もう一度確認してください。`;
    case "network":
      return "進捗を確認できません。通信状況を確認して、もう一度確認してください。";
  }
}

function StatusCheckNotice({
  problem,
  rechecking,
  onRecheck,
}: {
  problem: StatusCheckProblem;
  rechecking: boolean;
  onRecheck: () => void;
}) {
  return (
    <div role="alert" className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-2">
      <p className="text-foreground">{statusCheckProblemMessage(problem)}</p>
      <p className="text-xs text-muted-foreground">
        調査そのものは続いている可能性があります。確認できしだい、表示を更新します。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRecheck} pending={rechecking}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          進捗を再確認
        </Button>
        {problem.kind === "signed_out" && (
          <Link href="/login" className="text-sm text-primary underline underline-offset-2">
            ログインし直す
          </Link>
        )}
      </div>
    </div>
  );
}

export function ResearchProgressCard({
  run,
  onUpdate,
  overdue,
  onRetry,
  retrying,
  unavailableMessage,
}: {
  run: StoreResearchRun;
  onUpdate: (next: StoreResearchRun) => void;
  /**
   * running のまま期限を過ぎているか。上部の手順表示と同じ値を受け取る
   * (`useRunOverdue`)。カードの中で別に判定すると、上部と食い違う。
   */
  overdue: boolean;
  /** 期限を過ぎた run を打ち切って再調査する(Plan §17)。 */
  onRetry: () => void;
  retrying: boolean;
  /** いまの環境で AI 調査を実行できない理由。あれば再調査のボタンを出さない。 */
  unavailableMessage: string | null;
}) {
  const { problem, rechecking, recheck } = useResearchRunPolling(run, onUpdate);
  const elapsedSeconds = useElapsedSeconds(run.started_at, run.status === "running" && !overdue);
  const notice = problem && (
    <StatusCheckNotice problem={problem} rechecking={rechecking} onRecheck={recheck} />
  );

  if (overdue) {
    const limitMinutes = Math.round(
      (Date.parse(run.expires_at) - Date.parse(run.started_at)) / 60_000,
    );
    return (
      <Card>
        <Card.Header>
          <Card.Title>AI店舗調査</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-3">
          <div role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">上限の時間を過ぎても調査が終わっていません</p>
              <p className="text-muted-foreground mt-0.5">
                開始から{limitMinutes}分を過ぎても完了の連絡がありません。処理が止まっている可能性があります。
                {unavailableMessage === null &&
                  "再調査すると、この調査を打ち切って新しく調査し直します。"}
              </p>
            </div>
          </div>
          {notice}
          {unavailableMessage !== null ? (
            <p className="text-sm text-muted-foreground">{unavailableMessage}</p>
          ) : (
            <div className="flex justify-center py-1">
              <Button type="button" variant="primary" onClick={onRetry} pending={retrying}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {retrying ? "開始中…" : "再調査する"}
              </Button>
            </div>
          )}
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>AI店舗調査</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-3">
        <ul className="space-y-2">
          {STEPS.map((step) => {
            const status = stepStatus(step.stage, run.stage);
            return (
              <li key={step.stage} className="flex items-center gap-2 text-sm">
                <span
                  className={
                    status === "done"
                      ? "text-success"
                      : status === "active"
                        ? "text-primary"
                        : "text-muted-foreground"
                  }
                >
                  {status === "done" ? "●" : status === "active" ? "◐" : "○"}
                </span>
                <span
                  className={status === "pending" ? "text-muted-foreground" : "text-foreground"}
                >
                  {step.label}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {status === "done" ? "完了" : status === "active" ? "進行中" : "未着手"}
                </span>
              </li>
            );
          })}
        </ul>
        {/* 経過秒数はサーバとブラウザで別々に時計を読むため、描画の時点で 1 秒ずれうる。
            ずれを不一致として扱うと、React がこのツリーを作り直してしまう。 */}
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          経過時間: {formatElapsed(elapsedSeconds)}(目安 3〜5分)
        </p>
        {elapsedSeconds > EXPECTED_MAX_SECONDS && (
          <p className="text-xs text-muted-foreground">
            目安の時間を過ぎていますが、処理は続いています。完了か失敗が確定すると、この表示は自動で切り替わります。
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          このページを離れても調査は継続されます。
        </p>
        {notice}
      </Card.Body>
    </Card>
  );
}
