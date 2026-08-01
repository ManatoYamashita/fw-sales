"use client";

/** 調査中カード(Plan v3.2 §5.2)。runの`stage`をポーリングして進捗表示に反映する。 */

import { Card } from "@/components/ui/card";
import { useElapsedSeconds, useResearchRunPolling } from "./use-research-run-polling";
import type { StoreResearchRun, StoreResearchRunStage } from "@/types/research-run";

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

export function ResearchProgressCard({
  run,
  onUpdate,
}: {
  run: StoreResearchRun;
  onUpdate: (next: StoreResearchRun) => void;
}) {
  useResearchRunPolling(run, onUpdate);
  const elapsedSeconds = useElapsedSeconds(run.started_at, run.status === "running");

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
        <p className="text-xs text-muted-foreground">
          経過時間: {formatElapsed(elapsedSeconds)}(目安 3〜5分)
        </p>
        <p className="text-xs text-muted-foreground">
          このページを離れても調査は継続されます。
        </p>
      </Card.Body>
    </Card>
  );
}
