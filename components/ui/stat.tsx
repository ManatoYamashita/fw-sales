import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
  className?: string;
}

const toneClass: Record<NonNullable<StatProps["tone"]>, string> = {
  default: "text-slate-700 bg-slate-100",
  primary: "text-blue-700 bg-blue-100",
  success: "text-green-700 bg-green-100",
  warning: "text-amber-700 bg-amber-100",
  danger: "text-red-700 bg-red-100",
};

export function Stat({
  label,
  value,
  sub,
  icon,
  tone = "default",
  className,
}: StatProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-lg shadow-card",
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 [&>svg]:h-5 [&>svg]:w-5",
            toneClass[tone],
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
          {value}
        </p>
        {sub ? <p className="text-xs text-slate-500 mt-1">{sub}</p> : null}
      </div>
    </div>
  );
}
