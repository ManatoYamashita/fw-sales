"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Plus } from "lucide-react";
import { NAV_ITEMS } from "@/lib/domain/nav";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import type { Profile } from "@/types/profile";
import { cn } from "@/lib/utils/cn";

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
  return [{ label: "Firstweb Lead OS" }];
}

interface TopbarProps {
  readonly currentProfile?: Profile;
}

export function Topbar({ currentProfile }: TopbarProps) {
  const pathname = usePathname();
  const items = deriveBreadcrumb(pathname);

  return (
    <header className="sticky top-0 z-20 h-15 bg-background/80 backdrop-blur-md border-b border-border flex items-center justify-between px-4 md:px-6 gap-4">
      <div className="flex items-center gap-3 pl-12 md:pl-0 min-w-0">
        <Breadcrumb items={items} />
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <button
          type="button"
          aria-label="通知"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4 w-4" />
        </button>
        <Link
          href="/stores/new"
          className={cn(buttonVariants({ variant: "default", size: "md" }))}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">店舗登録</span>
        </Link>
        {currentProfile ? <UserMenu profile={currentProfile} /> : null}
      </div>
    </header>
  );
}
