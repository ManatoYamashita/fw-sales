"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

const OPTIONS = [
  { value: "light", label: "ライト", icon: Sun, hint: "白背景・通常用途" },
  { value: "dark", label: "ダーク", icon: Moon, hint: "暗背景・夜間や省電力" },
  { value: "system", label: "システム", icon: Monitor, hint: "OSの設定に追従" },
] as const;

const NOOP = () => () => {};
const TRUE = () => true;
const FALSE = () => false;

function useMounted(): boolean {
  return useSyncExternalStore(NOOP, TRUE, FALSE);
}

export function ThemeToggleCard() {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();
  const current = mounted ? (theme ?? "system") : "system";

  return (
    <Card>
      <Card.Header>
        <Card.Title>テーマ</Card.Title>
      </Card.Header>
      <Card.Body>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          配色テーマを切り替えます。「システム」は OS のダーク/ライト設定に追従します。
        </p>
        <div
          role="radiogroup"
          aria-label="テーマ選択"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2"
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(opt.value)}
                suppressHydrationWarning
                className={cn(
                  "relative flex items-start gap-3 p-3 rounded-lg border text-left",
                  "transition-[background-color,border-color,box-shadow]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-primary bg-primary/5 shadow-xs"
                    : "border-border hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {opt.label}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">
                    {opt.hint}
                  </span>
                </span>
                {active ? (
                  <Check
                    className="h-4 w-4 text-primary shrink-0 mt-1"
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </Card.Body>
    </Card>
  );
}
