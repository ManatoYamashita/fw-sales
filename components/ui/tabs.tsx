"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";

export type TabsVariant = "default" | "pill";

interface TabsContextValue {
  value: string;
  setValue: (next: string) => void;
  tabsId: string;
  variant: TabsVariant;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound must be used inside <Tabs>");
  return ctx;
}

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (next: string) => void;
  className?: string;
  children: ReactNode;
  /**
   * 見た目バリアント。
   * - `default`: 角丸ボックス型(既存挙動、後方互換)
   * - `pill`: ピル型。アクティブは `bg-foreground / text-background`、トラックは `rounded-full`
   */
  variant?: TabsVariant;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
  variant = "default",
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const tabsId = useId();
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;
  const setValue = (next: string) => {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value: current, setValue, tabsId, variant }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { variant } = useTabsContext();
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1",
        variant === "pill"
          ? "rounded-full bg-muted/60 p-1"
          : "bg-muted/50 border border-border rounded-md p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const ctx = useTabsContext();
  const active = ctx.value === value;
  const isPill = ctx.variant === "pill";
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.tabsId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${ctx.tabsId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium",
        "transition-[color,background-color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isPill ? "rounded-full px-4 py-1.5" : "rounded-sm px-3 py-1.5",
        active
          ? isPill
            ? "bg-foreground text-background shadow-sm"
            : "bg-background text-foreground shadow-xs"
          : isPill
            ? "text-muted-foreground hover:text-foreground"
            : "text-muted-foreground hover:text-foreground",
        className,
      )}
      onClick={() => ctx.setValue(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useTabsContext();
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.tabsId}-panel-${value}`}
      aria-labelledby={`${ctx.tabsId}-tab-${value}`}
      tabIndex={0}
      className={cn("pt-4 focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
