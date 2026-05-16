"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Zap } from "lucide-react";
import { useState } from "react";
import { NAV_ITEMS } from "@/lib/domain/nav";
import { cn } from "@/lib/utils/cn";
import type { NavBadgeCounts } from "@/lib/queries/stats";
import type { Profile } from "@/types/profile";

export interface SidebarProps {
  counts?: Partial<NavBadgeCounts>;
  /**
   * 現在ログイン中の profile (Phase 7 で `CURRENT_USER` 定数を撤廃)。
   * null は未認証想定だが middleware が拾うため通常は到達しない。
   */
  currentProfile?: Profile | null;
}

export function Sidebar({ counts, currentProfile }: SidebarProps) {
  const displayName = currentProfile?.display_name ?? "ゲスト";
  // 現状 ProfileRole は "member" | "placeholder" の 2 値。
  // 表示は placeholder の場合のみラベルを変える(管理者ロールは将来 Issue で追加)。
  const role = currentProfile?.role === "placeholder" ? "未登録" : "メンバー";
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 backdrop-blur-sm md:hidden animate-fade-in"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="sidebar-nav"
        aria-label="メインナビゲーション"
        className={cn(
          "fixed md:sticky md:top-0 md:self-start z-40 h-dvh w-60 shrink-0",
          "bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
          "flex flex-col",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 h-15 border-b border-sidebar-border">
          <span
            className="h-9 w-9 rounded-lg bg-gradient-to-br from-info to-primary flex items-center justify-center text-primary-foreground shadow-xs"
            aria-hidden
          >
            <Zap className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight text-sidebar-foreground truncate">
              Firstweb
            </p>
            <p className="text-[11px] text-muted-foreground -mt-0.5">
              Lead OS
            </p>
          </div>
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={close}
            className={cn(
              "md:hidden -mr-2 inline-flex h-9 w-9 items-center justify-center rounded-md",
              "text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav
          aria-label="メイン"
          className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"
        >
          <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            メニュー
          </p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = item.badgeKey ? counts?.[item.badgeKey] : undefined;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 h-9 px-3 rounded-md text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-sm bg-sidebar-primary"
                  />
                ) : null}
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active
                      ? "text-sidebar-primary"
                      : "text-muted-foreground group-hover:text-sidebar-accent-foreground",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {typeof count === "number" && count > 0 ? (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* User block */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-1">
            <span
              className="h-9 w-9 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-sm font-semibold shrink-0 ring-1 ring-border"
              aria-hidden
            >
              {displayName.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">
                {displayName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {role}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile menu trigger ─ サイドバー閉時のみ表示。開時は内側 X ボタンで閉じる */}
      {!open ? (
        <button
          type="button"
          aria-label="メニューを開く"
          aria-expanded={open}
          aria-controls="sidebar-nav"
          onClick={() => setOpen(true)}
          className={cn(
            "md:hidden fixed top-3 left-3 z-50 inline-flex h-9 w-9 items-center justify-center rounded-md",
            "bg-card text-foreground border border-border shadow-card",
            "hover:bg-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Menu className="h-4 w-4" />
        </button>
      ) : null}
    </>
  );
}
