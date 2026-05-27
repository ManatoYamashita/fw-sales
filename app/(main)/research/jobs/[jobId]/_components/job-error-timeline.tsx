import { AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DeepResearchJobErrorEntry } from "@/types/deep-research";

interface JobErrorTimelineProps {
  errors: DeepResearchJobErrorEntry[];
}

const STAGE_META: Record<string, { label: string; color: string }> = {
  stage1: { label: "Stage 1 (調査)", color: "text-blue-500" },
  stage2: { label: "Stage 2 (構造化)", color: "text-purple-500" },
  sweep: { label: "Sweep (スタック検出)", color: "text-orange-500" },
};

export function JobErrorTimeline({ errors }: JobErrorTimelineProps) {
  if (errors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">エラーログなし</p>
    );
  }

  return (
    <div className="space-y-3">
      {errors.map((entry, i) => {
        const meta = STAGE_META[entry.stage] ?? {
          label: entry.stage,
          color: "text-muted-foreground",
        };
        return (
          <div
            key={`${entry.occurred_at}-${i}`}
            className="flex gap-3 items-start border-l-2 border-border pl-4 py-2"
          >
            <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", meta.color)} />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-xs font-semibold", meta.color)}>
                  {meta.label}
                </span>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  {entry.kind}
                </code>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(entry.occurred_at).toLocaleString("ja-JP")}
                </span>
              </div>
              <p className="text-sm text-foreground/80 break-all">
                {entry.message}
              </p>
              {entry.cancel_result && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  cancel: {entry.cancel_result.cancelled ? "成功" : `失敗 (${entry.cancel_result.reason ?? "不明"})`}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
