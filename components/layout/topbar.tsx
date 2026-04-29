"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Plus } from "lucide-react";
import { NAV_ITEMS } from "@/lib/domain/nav";

function deriveBreadcrumb(pathname: string): { title: string; sub?: string } {
  if (pathname === "/" || pathname === "/dashboard") {
    return { title: "ダッシュボード" };
  }
  for (const item of NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      const isNew = pathname.endsWith("/new");
      const isDetail = pathname !== item.href && !isNew;
      return {
        title: item.label,
        sub: isNew ? "新規登録" : isDetail ? "詳細" : undefined,
      };
    }
  }
  return { title: "Firstweb Lead OS" };
}

export function Topbar() {
  const pathname = usePathname();
  const crumb = deriveBreadcrumb(pathname);

  return (
    <header className="sticky top-0 z-20 h-15 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6">
      <div className="flex items-center gap-3 pl-12 md:pl-0">
        <h1 className="text-base font-semibold text-slate-900">{crumb.title}</h1>
        {crumb.sub ? (
          <span className="text-sm text-slate-400">/ {crumb.sub}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="通知"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <Bell className="h-4 w-4" />
        </button>
        <Link
          href="/stores/new"
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">店舗登録</span>
        </Link>
      </div>
    </header>
  );
}
