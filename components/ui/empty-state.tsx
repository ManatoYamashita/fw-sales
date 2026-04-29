import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6 gap-3",
        className,
      )}
    >
      {icon ? (
        <div className="text-slate-400 [&>svg]:h-10 [&>svg]:w-10">{icon}</div>
      ) : null}
      <p className="text-base font-semibold text-slate-700">{title}</p>
      {description ? (
        <p className="text-sm text-slate-500 max-w-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
