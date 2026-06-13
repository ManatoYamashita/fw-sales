"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "@/lib/hooks/use-mounted";
import { cn } from "@/lib/utils/cn";

const ORDER = ["light", "dark", "system"] as const;
type ThemeMode = (typeof ORDER)[number];

const ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const LABELS: Record<ThemeMode, string> = {
  light: "ライト",
  dark: "ダーク",
  system: "システム",
};

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();
  const current = (mounted ? (theme ?? "system") : "system") as ThemeMode;
  const Icon = ICONS[current] ?? Monitor;
  const label = LABELS[current] ?? "システム";

  function cycleTheme() {
    const idx = ORDER.indexOf(current);
    const next = ORDER[(idx + 1) % ORDER.length] ?? "system";
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={`テーマ切替 (現在: ${label})`}
      title={`テーマ: ${label} (クリックで切替)`}
      suppressHydrationWarning
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground",
        "hover:bg-accent hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
