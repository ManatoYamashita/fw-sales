import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type {
  ResearchFlowStep,
  ResearchFlowStepStatus,
} from "@/lib/domain/research-flow";

/** 状態を色だけに頼らず読めるよう、各ステップに文言でも状態を添える。 */
const STATUS_TEXT: Record<ResearchFlowStepStatus, string> = {
  current: "いまここ",
  running: "実行中",
  done: "完了",
  upcoming: "未着手",
};

/**
 * 推奨手順 (① AI調査 → ② レビュー → ③ 営業資産を生成) と現在地を示す (Issue #300)。
 *
 * 状態は番号/アイコン・文言・`aria-current` の 3 つで伝え、色は補助にとどめる。
 */
export function ResearchFlowSteps({ steps }: { steps: readonly ResearchFlowStep[] }) {
  return (
    <nav aria-label="営業資産ができるまでの手順" className="flex flex-col gap-2">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {steps.map((step, index) => {
          const active = step.status === "current" || step.status === "running";
          return (
            <li key={step.key} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              )}
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                  active
                    ? "border-primary bg-primary/10 text-foreground font-medium"
                    : "border-border text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                    active
                      ? "bg-primary text-primary-foreground"
                      : step.status === "done"
                        ? "bg-success-soft text-success-on-soft"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {step.status === "done" ? (
                    <Check className="size-3" />
                  ) : step.status === "running" ? (
                    <Loader2 className="size-3 motion-safe:animate-spin" />
                  ) : (
                    index + 1
                  )}
                </span>
                {step.label}
                <span className="text-xs text-muted-foreground">({STATUS_TEXT[step.status]})</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        店舗名だけで始められます。レビューで採用した項目が基本情報に入り、営業資産の生成に使われます。外部で調べた情報は「営業資産を生成」の補足情報に貼り付けられます。
      </p>
    </nav>
  );
}
