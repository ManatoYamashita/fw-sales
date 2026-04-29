"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap } from "lucide-react";
import { useState } from "react";
import { NAV_ITEMS } from "@/lib/domain/nav";
import { CURRENT_USER } from "@/lib/domain/staff";
import { cn } from "@/lib/utils/cn";
import type { NavBadgeCounts } from "@/lib/queries/stats";

export interface SidebarProps {
  counts?: Partial<NavBadgeCounts>;
}

export function Sidebar({ counts }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 md:hidden"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="sidebar-nav"
        aria-label="メインナビゲーション"
        className={cn(
          "fixed md:static z-40 h-dvh md:h-auto md:min-h-dvh w-60 shrink-0 bg-slate-900 text-slate-200 flex flex-col",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex items-center gap-2.5 px-4 h-15 border-b border-slate-800">
          <span className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white">
            <Zap className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">Firstweb</p>
            <p className="text-xs text-slate-400">Lead OS</p>
          </div>
        </div>

        <nav
          aria-label="メイン"
          className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"
        >
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
                className={cn(
                  "flex items-center gap-2.5 h-9 px-3 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {typeof count === "number" && count > 0 ? (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold",
                      active ? "bg-blue-500 text-white" : "bg-slate-700 text-slate-100",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-slate-800">
          <p className="text-xs text-slate-400">ログイン中</p>
          <p className="text-sm font-semibold text-white mt-0.5">
            {CURRENT_USER.name}
          </p>
          <p className="text-xs text-slate-400">{CURRENT_USER.role}</p>
        </div>
      </aside>

      <button
        type="button"
        aria-label={open ? "メニューを閉じる" : "メニューを開く"}
        aria-expanded={open}
        aria-controls="sidebar-nav"
        onClick={() => setOpen((v) => !v)}
        className="md:hidden fixed top-3 left-3 z-50 inline-flex h-9 w-9 items-center justify-center rounded-md bg-white border border-slate-200 shadow-card text-slate-700"
      >
        <span className="block h-0.5 w-4 bg-current relative before:content-[''] before:absolute before:-top-1.5 before:left-0 before:h-0.5 before:w-4 before:bg-current after:content-[''] after:absolute after:top-1.5 after:left-0 after:h-0.5 after:w-4 after:bg-current" />
      </button>
    </>
  );
}
