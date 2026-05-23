"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { NAV_ITEMS } from "@/lib/domain/nav";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NotificationBell } from "@/components/layout/notification-bell";
import { cn } from "@/lib/utils/cn";
import type { Notification } from "@/types/notification";

function deriveBreadcrumb(pathname: string): BreadcrumbItem[] {
  if (pathname === "/" || pathname === "/dashboard") {
    return [{ label: "ダッシュボード" }];
  }
  for (const item of NAV_ITEMS) {
    if (pathname === item.href) {
      return [{ label: item.label }];
    }
    if (pathname.startsWith(`${item.href}/`)) {
      const isNew = pathname.endsWith("/new");
      const isEdit = pathname.endsWith("/edit");
      const sub = isNew
        ? "新規登録"
        : isEdit
          ? "編集"
          : "詳細";
      return [
        { label: item.label, href: item.href },
        { label: sub },
      ];
    }
  }
  return [{ label: "FirstWeb - Reserch AI for Sales" }];
}

export interface TopbarProps {
  /**
   * 親 RSC (`(main)/layout.tsx` の `TopbarShell`) が `getRecentNotifications`
   * で解決した最新通知配列。deep-research-pipeline spec #43 で追加。
   */
  notifications?: readonly Notification[];
}

export function Topbar({ notifications = [] }: TopbarProps) {
  const pathname = usePathname();
  const items = deriveBreadcrumb(pathname);
  const isOnStoreNew = pathname === "/stores/new";

  return (
    <header className="sticky top-0 z-20 h-15 bg-background/80 backdrop-blur-md border-b border-border flex items-center justify-between px-4 md:px-6 gap-4">
      <div className="flex items-center gap-3 pl-12 md:pl-0 min-w-0">
        <Breadcrumb items={items} />
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <NotificationBell notifications={notifications} />
        {isOnStoreNew ? (
          <button
            type="button"
            disabled
            aria-current="page"
            className={cn(buttonVariants({ variant: "default", size: "md" }))}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">店舗登録</span>
          </button>
        ) : (
          <Link
            href="/stores/new"
            className={cn(buttonVariants({ variant: "default", size: "md" }))}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">店舗登録</span>
          </Link>
        )}
      </div>
    </header>
  );
}
