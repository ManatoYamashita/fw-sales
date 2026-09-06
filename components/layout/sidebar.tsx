"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeft, PanelLeftClose, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NAV_ITEMS } from "@/lib/domain/nav";
import {
  FOCUSABLE_SELECTOR,
  resolveDrawerFocusWrap,
} from "@/components/layout/sidebar-focus";
import { cn } from "@/lib/utils/cn";
import { UserMenu } from "@/components/layout/user-menu";
import type { NavBadgeCounts } from "@/lib/queries/stats";
import type { Profile } from "@/types/profile";

export interface SidebarProps {
  counts?: Partial<NavBadgeCounts>;
  /**
   * 現在ログイン中の profile (Phase 7 で `CURRENT_USER` 定数を撤廃)。
   * null は未認証想定だが proxy が拾うため通常は到達しない。
   */
  currentProfile?: Profile | null;
  /**
   * デスクトップ (md 以上) でアイコンレールに折りたたんだ初期状態。
   * SSR 時に Cookie `sidebar_collapsed` を読んで layout から注入し、
   * フォールバック中のちらつき (w-60 → w-16) を防ぐ。
   */
  defaultCollapsed?: boolean;
}

/** デスクトップの折りたたみ状態を 1 年間 Cookie に保存する。 */
function persistCollapsed(next: boolean): void {
  document.cookie = `sidebar_collapsed=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

export function Sidebar({
  counts,
  currentProfile,
  defaultCollapsed = false,
}: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const asideRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  /** 直前の open。閉じた「瞬間」だけフォーカスを戻すために持つ。 */
  const wasOpenRef = useRef(false);

  // md 以上へ広がったらドロワーを閉じる。閉じないと、開いたままデスクトップ幅に
  // なったときに下のスクロールロックとフォーカストラップが、常時可視のサイドバーに
  // 対して働き続けてページがスクロールできなくなる。
  //
  // Epic #225 D2 が禁じる「viewport の JS 判定」は、静的シェルと hydration 後で
  // 描画が食い違う場合の話。ここは初期値 false がサーバ・クライアントで一致し、
  // 描画を分岐させないため該当しない。
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const syncToViewport = () => {
      if (desktop.matches) setOpen(false);
    };
    syncToViewport();
    desktop.addEventListener("change", syncToViewport);
    return () => desktop.removeEventListener("change", syncToViewport);
  }, []);

  // ドロワー展開中のみ: Escape で閉じる / Tab をドロワー内で循環させる /
  // 背後のページをスクロールさせない。
  useEffect(() => {
    if (!open) return;

    const previousOverflowY = document.body.style.overflowY;
    // `overflow: hidden` ではなく y 軸だけを止める。globals.css の
    // `html, body { overflow-x: clip }` を上書きすると sticky が壊れるため。
    document.body.style.overflowY = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      const root = asideRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      const target = resolveDrawerFocusWrap(
        event.key,
        event.shiftKey,
        focusable.indexOf(document.activeElement as HTMLElement),
        focusable.length,
      );
      if (target === null) return;
      event.preventDefault();
      focusable[target]!.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflowY = previousOverflowY;
    };
  }, [open]);

  // 開いたらドロワー内へフォーカスを入れ、閉じたらハンバーガーへ戻す。
  // 戻さないと、X を押した瞬間にフォーカスを持っていた要素ごと DOM から消え、
  // 次の Tab がページ先頭からやり直しになる。
  useEffect(() => {
    if (open) {
      asideRef.current
        ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?.focus();
    } else if (wasOpenRef.current) {
      menuButtonRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  // デスクトップ (md 以上) のアイコンレール折りたたみ。モバイルのドロワー (open) とは独立。
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });

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
        ref={asideRef}
        id="sidebar-nav"
        aria-label="メインナビゲーション"
        className={cn(
          "fixed md:sticky md:top-0 md:self-start z-40 h-dvh w-60 shrink-0",
          "bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
          "flex flex-col",
          // visibility も遷移対象に含める。CSS の visibility は離散遷移なので、
          // 開くときは即 visible、閉じるときは 200ms 後に hidden となり、
          // スライドアウトのアニメーションを保ったまま隠せる。
          "transition-[transform,width,visibility] duration-200 ease-out",
          // デスクトップのみ折りたたみ幅を切替 (モバイルは常に w-60 ドロワー)
          collapsed ? "md:w-16" : "md:w-60",
          // 閉時は `invisible` で Tab 順と支援技術から外す (#253)。`-translate-x-full`
          // だけでは画面外に居るだけで、375px でナビ全リンクへ Tab が到達していた。
          // `display:none` ではなく visibility にするのは開閉アニメーションを保つため。
          // md 以上ではドロワーではなく常時可視のサイドバーなので必ず `visible` に戻す。
          open
            ? "translate-x-0 visible"
            : "-translate-x-full invisible md:translate-x-0 md:visible",
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex items-center gap-2.5 h-15 border-b border-sidebar-border px-4",
            collapsed && "md:px-0 md:justify-center",
          )}
        >
          <span
            className="h-9 w-9 rounded-lg bg-gradient-to-br from-info to-primary flex items-center justify-center text-primary-foreground shadow-xs shrink-0"
            aria-hidden
          >
            <Zap className="h-4.5 w-4.5" />
          </span>
          <div
            className={cn(
              "leading-tight min-w-0 flex-1",
              collapsed && "md:hidden",
            )}
          >
            <p className="text-sm font-semibold tracking-tight text-sidebar-foreground truncate">
              FirstWeb
            </p>
            <p className="text-[11px] text-muted-foreground -mt-0.5">
              Reserch AI for Sales
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
          <p
            className={cn(
              "px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
              collapsed && "md:hidden",
            )}
          >
            メニュー
          </p>
          {NAV_ITEMS.filter((item) => !item.disabled).map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = item.badgeKey ? counts?.[item.badgeKey] : undefined;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 h-9 px-3 rounded-md text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  collapsed && "md:justify-center md:px-0",
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
                <span
                  className={cn("flex-1 truncate", collapsed && "md:hidden")}
                >
                  {item.label}
                </span>
                {typeof count === "number" && count > 0 ? (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums",
                      collapsed && "md:hidden",
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

        {/* デスクトップ専用: アイコンレール折りたたみトグル (モバイルは X/Menu で開閉) */}
        <div className="hidden md:block px-2 py-2 border-t border-sidebar-border">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
            aria-pressed={collapsed}
            title={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
            className={cn(
              "flex items-center gap-2.5 h-9 w-full rounded-md text-sm transition-colors",
              "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed ? "justify-center px-0" : "px-3",
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {!collapsed ? (
              <span className="flex-1 text-left truncate">折りたたむ</span>
            ) : null}
          </button>
        </div>

        <UserMenu
          profile={currentProfile}
          variant="sidebar"
          collapsed={collapsed}
        />
      </aside>

      {/* Mobile menu trigger ─ サイドバー閉時のみ表示。開時は内側 X ボタンで閉じる */}
      {!open ? (
        <button
          ref={menuButtonRef}
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
