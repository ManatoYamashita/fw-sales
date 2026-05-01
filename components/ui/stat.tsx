import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type StatTone = "default" | "primary" | "success" | "warning" | "danger";

const toneIconClass: Record<StatTone, string> = {
  default: "text-muted-foreground bg-muted",
  primary: "text-info bg-info-soft",
  success: "text-success bg-success-soft",
  warning: "text-warning bg-warning-soft",
  danger: "text-destructive bg-destructive-soft",
};

export interface StatDelta {
  value: string;
  /** 上向き=正のシグナル(success), 下向き=負のシグナル(destructive) を表示 */
  trend?: "up" | "down" | "flat";
}

export interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: StatDelta;
  icon?: ReactNode;
  tone?: StatTone;
  className?: string;
}

const TREND_GLYPH: Record<NonNullable<StatDelta["trend"]>, string> = {
  up: "↗",
  down: "↘",
  flat: "→",
};

const TREND_CLASS: Record<NonNullable<StatDelta["trend"]>, string> = {
  up: "bg-success-soft text-success",
  down: "bg-destructive-soft text-destructive",
  flat: "bg-muted text-muted-foreground",
};

export function Stat({
  label,
  value,
  sub,
  delta,
  icon,
  tone = "default",
  className,
}: StatProps) {
  const trend = delta?.trend ?? "flat";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 p-5 bg-card text-card-foreground",
        "border border-border rounded-lg shadow-card transition-colors hover:bg-accent/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon ? (
          <span
            className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              "[&>svg]:h-4 [&>svg]:w-4",
              toneIconClass[tone],
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="text-3xl font-semibold tabular-nums leading-none text-foreground">
        {value}
      </p>
      <div className="flex items-center gap-2 min-h-5">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium tabular-nums",
              TREND_CLASS[trend],
            )}
          >
            <span aria-hidden>{TREND_GLYPH[trend]}</span>
            <span>{delta.value}</span>
          </span>
        ) : null}
        {sub ? (
          <span className="text-xs text-muted-foreground truncate">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}
