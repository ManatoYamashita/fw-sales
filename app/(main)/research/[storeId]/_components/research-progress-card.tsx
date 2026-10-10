"use client";

/**
 * 調査中カード(Plan v3.2 §5.2)。runの`stage`をポーリングして進捗表示に反映する。
 *
 * #324 で次の 3 つを区別して表示する:
 * - 目安 (3〜5分) を過ぎても期限前なら、正常な長時間処理として待つよう伝える
 * - 期限 (`expires_at`) を過ぎたら異常として示す。ただし止まった確証は無いので
 *   「中断しました」とは言わない (`overdue` は上部の手順表示と共有する)
 * - 進捗を取得できないときは「進捗を確認できません」と出し、調査の失敗とは分ける
 *
 * 工程一覧の表示契約 (#323):
 * - 進行中: 回転アイコン + 行の強調 + 「進行中」/ 完了: チェック + 「完了」/ 未着手: 控えめな円 + 「未着手」
 * - 工程名に状態を埋め込まない (「〜中」と書かない)。状態は工程名の隣に文言で添える
 * - 一覧を出すのは期限前の running のときだけ。失敗・成功・期限超過では一覧ごと消え、回転が残らない
 */

import Link from "next/link";
import { AlertTriangle, Check, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
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
  { stage: "researching", label: "店舗情報を取得・分析" },
  { stage: "done", label: "結果を整理" },
];

type StepStatus = "done" | "active" | "pending";

/** 状態を色やアニメーションだけに頼らず読めるよう、各工程に文言でも状態を添える。 */
const STATUS_TEXT: Record<StepStatus, string> = {
  done: "完了",
  active: "進行中",
  pending: "未着手",
};

function stepStatus(
  stepStage: StoreResearchRunStage | "start",
  currentStage: StoreResearchRunStage | null,
): StepStatus {
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

/**
 * 工程の状態アイコン。上部の手順表示 (`research-flow-steps.tsx`) と同じ部品・色で揃える。
 *
 * - 進行中: 回転アイコン (動きを減らす設定では回転させず、形と「進行中」の文言で示す)
 * - 完了: チェック
 * - 未着手: 控えめな円 (枠線のみ)
 */
function StepIcon({ status }: { status: StepStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
        status === "active"
          ? "bg-primary text-primary-foreground"
          : status === "done"
            ? "bg-success-soft text-success-on-soft"
            : "border border-muted-foreground/40",
      )}
    >
      {status === "active" ? (
        <Loader2 className="size-3 motion-safe:animate-spin" />
      ) : status === "done" ? (
        <Check className="size-3" />
      ) : null}
    </span>
  );
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
        <ol aria-label="調査の工程" className="space-y-1">
          {STEPS.map((step) => {
            const status = stepStatus(step.stage, run.stage);
            const active = status === "active";
            return (
              <li
                key={step.stage}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-start gap-3 rounded-md px-3 py-2 text-sm",
                  active && "bg-primary/10",
                )}
              >
                <StepIcon status={status} />
                {/* 工程名と状態を隣に並べ、広い画面でも対応が離れないようにする。
                    狭い幅では状態だけが次の行へ折り返し、工程名は見切れない。 */}
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    className={cn(
                      active
                        ? "font-medium text-foreground"
                        : status === "done"
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      active ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {STATUS_TEXT[status]}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {/* 進捗一覧の補助情報。一覧と区切り、小さな文字でまとめる。 */}
        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          {/* 経過秒数はサーバとブラウザで別々に時計を読むため、描画の時点で 1 秒ずれうる。
              ずれを不一致として扱うと、React がこのツリーを作り直してしまう。 */}
          <p className="tabular-nums" suppressHydrationWarning>
            経過時間: {formatElapsed(elapsedSeconds)}(目安 3〜5分)
          </p>
          {elapsedSeconds > EXPECTED_MAX_SECONDS && (
            <p>
              目安の時間を過ぎていますが、処理は続いています。完了か失敗が確定すると、この表示は自動で切り替わります。
            </p>
          )}
          <p>このページを離れても調査は継続されます。</p>
        </div>
        {notice}
      </Card.Body>
    </Card>
  );
}
