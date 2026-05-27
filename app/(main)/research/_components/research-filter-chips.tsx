"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils/cn";

export type StatusFilter = "all" | "pending" | "done" | "failed";

interface FilterOption {
  value: StatusFilter;
  label: string;
  count: number;
}

interface ResearchFilterChipsProps {
  totalCount: number;
  pendingCount: number;
  doneCount: number;
  failedCount: number;
}

export function ResearchFilterChips({
  totalCount,
  pendingCount,
  doneCount,
  failedCount,
}: ResearchFilterChipsProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const VALID_FILTERS: StatusFilter[] = ["all", "pending", "done", "failed"];
  const raw = params.get("status") ?? "all";
  const current: StatusFilter = VALID_FILTERS.includes(raw as StatusFilter)
    ? (raw as StatusFilter)
    : "all";

  const options: FilterOption[] = [
    { value: "all", label: "全て", count: totalCount },
    { value: "pending", label: "実行中", count: pendingCount },
    { value: "done", label: "完了", count: doneCount },
    { value: "failed", label: "失敗", count: failedCount },
  ];

  const handleClick = (value: StatusFilter) => {
    startTransition(() => {
      if (value === "all") {
        router.replace("/research");
      } else {
        router.replace(`/research?status=${value}`);
      }
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {options.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleClick(opt.value)}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-colors border",
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground/70 border-border hover:bg-accent hover:text-foreground",
            )}
          >
            {opt.label}
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                active
                  ? "bg-background/20 text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {opt.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
