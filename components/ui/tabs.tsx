"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
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

/**
 * 矢印キーで移動する先を、有効なタブの並びの中から決める (#252)。
 *
 * `TabsTrigger` は roving tabindex (アクティブ以外は `tabIndex={-1}`) を採るため、
 * この移動が無いと**非アクティブタブへ到達する手段が Tab キーにも矢印キーにも
 * 存在しない**。マウス/タッチ専用の UI になってしまう。狭幅の横スクロール (#252) を
 * 入れるだけでは、スクロール領域をキーボードで動かす手段が無いままになる
 * (フォーカス可能な子がアクティブタブ 1 個しかないため、ブラウザの
 * 「フォーカス可能な子を持たないスクローラを focusable にする」ヒューリスティクスも
 * 空振りする。#231 で踏んだのと同じ罠)。
 *
 * @param key `KeyboardEvent.key`
 * @param currentIndex いまフォーカスがあるタブの、有効タブ列の中での位置。
 *   フォーカスがタブ列の外や無効タブにある場合は -1。
 * @param enabledCount 無効化されていないタブの数
 * @returns 移動先の index (有効タブ列の中での位置)。移動しないキーなら null
 */
export function resolveTabNavigationTarget(
  key: string,
  currentIndex: number,
  enabledCount: number,
): number | null {
  if (enabledCount <= 0) return null;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return enabledCount - 1;
    // 端では反対側へ回り込む (ARIA Authoring Practices の Tabs パターン)。
    case "ArrowRight":
      return currentIndex < 0 ? 0 : (currentIndex + 1) % enabledCount;
    case "ArrowLeft":
      return currentIndex < 0
        ? enabledCount - 1
        : (currentIndex - 1 + enabledCount) % enabledCount;
    default:
      return null;
  }
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { variant, value } = useTabsContext();
  const listRef = useRef<HTMLDivElement | null>(null);

  /** 無効化されていないタブ要素。DOM 順がそのまま表示順。 */
  const enabledTabs = (): HTMLElement[] =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(
        '[role="tab"]:not([disabled])',
      ) ?? [],
    );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const tabs = enabledTabs();
    const target = resolveTabNavigationTarget(
      event.key,
      tabs.indexOf(document.activeElement as HTMLElement),
      tabs.length,
    );
    if (target === null) return;

    // Home/End のページスクロールと、矢印キーによるスクロール領域の横移動を止める
    // (タブ移動に伴うスクロールは下の scrollIntoView が行う)。
    event.preventDefault();

    const next = tabs[target]!;
    next.focus({ preventScroll: true });
    // 自動アクティベーション。フォーカスの移動でそのタブを選ぶ (WAI-ARIA の推奨)。
    // click() を通すことで、消費者が TabsTrigger へ渡した onClick も同じ経路を通る。
    next.click();
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // 選択中のタブがスクロール範囲の外にあるなら見える位置へ送る。
  // deep link (`?tab=ai` 等) で範囲外のタブが初期選択される場合にここが効く。
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn(
        // 狭幅では横スクロールへ退避する (#252)。`inline-flex` のままにして
        // `max-w-full` を足すことで、収まるうちは従来どおり内容幅に縮む
        // (`flex` にするとトラックがコンテナ幅いっぱいに広がり見た目が変わる)。
        // スクロールバーは出さない。トラックは 32px 級の高さしかなく、
        // 出すと高さが変わってアクティブタブの位置が動くため。
        "inline-flex max-w-full items-center gap-1 overflow-x-auto scrollbar-none",
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
