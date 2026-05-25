/**
 * Deep Research ジョブの 3 ステップ プログレスインジケータ (RSC)。
 *
 * queued (1/3) → researching (2/3) → structuring (3/3) を
 * 丸 + 横線のステップバーで視覚化する。 Tailwind のみで構築。
 */

import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { JobStatus } from "@/types/deep-research";

interface ResearchProgressIndicatorProps {
  status: JobStatus;
}

const STEPS = [
  { key: "queued", label: "キュー" },
  { key: "researching", label: "調査" },
  { key: "structuring", label: "構造化" },
] as const;

type StepState = "completed" | "current" | "upcoming";

function getStepStates(status: JobStatus): StepState[] {
  switch (status) {
    case "queued":
      return ["current", "upcoming", "upcoming"];
    case "researching":
      return ["completed", "current", "upcoming"];
    case "structuring":
      return ["completed", "completed", "current"];
    case "done":
      return ["completed", "completed", "completed"];
    case "failed":
    default:
      return ["completed", "completed", "upcoming"];
  }
}

export function ResearchProgressIndicator({
  status,
}: ResearchProgressIndicatorProps) {
  const states = getStepStates(status);

  return (
    <div className="flex items-center gap-0 w-full max-w-[180px]">
      {STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-0.5">
            <div
              className={cn(
                "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors",
                states[i] === "completed" &&
                  "bg-emerald-500 text-white",
                states[i] === "current" &&
                  "bg-blue-500 text-white animate-pulse",
                states[i] === "upcoming" &&
                  "bg-muted border border-border text-muted-foreground",
              )}
            >
              {states[i] === "completed" ? (
                <Check className="h-3 w-3" />
              ) : (
                i + 1
              )}
            </div>
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                "h-0.5 flex-1 mx-0.5 rounded-full mt-[-10px]",
                states[i] === "completed"
                  ? "bg-emerald-500"
                  : "bg-border",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
