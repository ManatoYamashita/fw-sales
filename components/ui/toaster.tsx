"use client";

import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { dismissToast, useToasts, type Toast } from "./toast";
import { cn } from "@/lib/utils/cn";

const toneStyle: Record<Toast["tone"], { wrap: string; icon: React.ElementType }> = {
  success: {
    wrap: "border-green-200 bg-green-50 text-green-900",
    icon: CheckCircle2,
  },
  error: {
    wrap: "border-red-200 bg-red-50 text-red-900",
    icon: XCircle,
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50 text-amber-900",
    icon: AlertTriangle,
  },
  info: {
    wrap: "border-slate-200 bg-white text-slate-900",
    icon: Info,
  },
};

export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="通知"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm"
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
              "flex items-start gap-3 px-4 py-3 rounded-lg border shadow-modal animate-slide-up",
              tone.wrap,
            )}
          >
            <Icon className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm flex-1 leading-5">{toast.message}</p>
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => dismissToast(toast.id)}
              className="text-current/60 hover:text-current transition-colors -mr-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
