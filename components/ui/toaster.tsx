"use client";

import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { dismissToast, useToasts, type Toast } from "./toast";
import { cn } from "@/lib/utils/cn";

const toneStyle: Record<
  Toast["tone"],
  { wrap: string; icon: React.ElementType; iconWrap: string }
> = {
  success: {
    wrap: "border-success/30 bg-success-soft text-success-on-soft",
    icon: CheckCircle2,
    iconWrap: "text-success-on-soft",
  },
  error: {
    wrap: "border-destructive/30 bg-destructive-soft text-destructive-on-soft",
    icon: XCircle,
    iconWrap: "text-destructive-on-soft",
  },
  warning: {
    wrap: "border-warning/30 bg-warning-soft text-warning-on-soft",
    icon: AlertTriangle,
    iconWrap: "text-warning-on-soft",
  },
  info: {
    wrap: "border-border bg-card text-card-foreground",
    icon: Info,
    iconWrap: "text-info",
  },
};

export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="通知"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {toasts.map((toast) => {
        const tone = toneStyle[toast.tone];
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={cn(
              "pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border shadow-modal animate-slide-up",
              tone.wrap,
            )}
          >
            <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", tone.iconWrap)} />
            <p className="text-sm flex-1 leading-5">{toast.message}</p>
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => dismissToast(toast.id)}
              className="text-current/60 hover:text-current transition-colors -mr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
