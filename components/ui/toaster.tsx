"use client";

import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import {
  dismissToast,
  pauseToast,
  resumeToast,
  useToasts,
  type Toast,
} from "./toast";
import { cn } from "@/lib/utils/cn";
import { useRef } from "react";

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
  const regularToasts = toasts.filter((toast) => toast.tone !== "error");
  const errorToasts = toasts.filter((toast) => toast.tone === "error");

  const renderToast = (toast: Toast) => {
    const tone = toneStyle[toast.tone];
    const Icon = tone.icon;
    return <ToastItem key={toast.id} toast={toast} tone={tone} Icon={Icon} />;
  };

  return (
    <div
      role="region"
      aria-label="通知"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {/* 空でも残す。連続する polite 通知を同じ live region で安定して伝える。 */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="flex flex-col gap-2"
      >
        {regularToasts.map(renderToast)}
      </div>
      <div className="flex flex-col gap-2">
        {errorToasts.map(renderToast)}
      </div>
    </div>
  );
}

function ToastItem({
  toast,
  tone,
  Icon,
}: {
  toast: Toast;
  tone: (typeof toneStyle)[Toast["tone"]];
  Icon: React.ElementType;
}) {
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const syncTimer = () => {
    if (hoveredRef.current || focusedRef.current) pauseToast(toast.id);
    else resumeToast(toast.id);
  };

  return (
    <div
      role={toast.tone === "error" ? "alert" : undefined}
      aria-atomic="true"
      className={cn(
        "pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border shadow-modal animate-slide-up",
        tone.wrap,
      )}
      onMouseEnter={() => {
        hoveredRef.current = true;
        syncTimer();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        syncTimer();
      }}
      onFocus={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focusedRef.current = true;
        syncTimer();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focusedRef.current = false;
        syncTimer();
      }}
    >
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", tone.iconWrap)} aria-hidden />
      <p className="text-sm flex-1 leading-5">{toast.message}</p>
      <button
        type="button"
        aria-label="閉じる"
        onClick={() => dismissToast(toast.id)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-current/60 hover:text-current transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
