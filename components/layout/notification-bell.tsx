"use client";

/**
 * Topbar Bell ドロップダウン (deep-research-pipeline spec #43, Task 5.5)
 *
 * - 未読件数バッジを表示し、クリックで最新通知 (default 10 件) を展開
 * - 通知の `kind` に応じてリンク先を決定 (deep_research_done/failed → 該当店舗、
 *   deep_research_budget_warning → KPI 画面)
 * - 外側クリック / Escape キーで閉じる
 *
 * 親 RSC が `getRecentNotifications(userId, limit=10)` の結果を props で渡す前提。
 *
 * 関連: requirements.md §4.1, §4.2, §4.3
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Inbox } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { Notification, NotificationKind } from "@/types/notification";

interface NotificationBellProps {
  notifications: readonly Notification[];
}

export function NotificationBell({ notifications }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleToggle = useCallback(() => setOpen((v) => !v), []);
  const handleNavigate = useCallback(() => setOpen(false), []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`通知 (${unreadCount} 件未読)`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleToggle}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span
            className="absolute top-1 right-1 inline-flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium leading-none"
            aria-hidden
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="通知一覧"
          className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover shadow-md z-30"
        >
          <div className="border-b border-border px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-medium">通知</span>
            <span className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} 件未読` : "未読なし"}
            </span>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <li className="px-3 py-6 flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <Inbox className="h-6 w-6" />
                通知はありません
              </li>
            ) : (
              notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onNavigate={handleNavigate}
                />
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

interface NotificationRowProps {
  notification: Notification;
  onNavigate: () => void;
}

function NotificationRow({ notification, onNavigate }: NotificationRowProps) {
  const href = resolveLink(notification);
  const isUnread = notification.read_at === null;
  const body = (
    <article
      className={cn(
        "px-3 py-2 border-b border-border last:border-b-0 hover:bg-accent transition-colors",
        isUnread ? "bg-info-soft/30" : null,
      )}
    >
      <div className="flex items-start gap-2">
        {isUnread ? (
          <span
            aria-hidden
            className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-destructive shrink-0"
          />
        ) : (
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight truncate">
            {notification.title}
          </p>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {notification.body}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {formatRelativeJst(notification.created_at)}
          </p>
        </div>
      </div>
    </article>
  );

  if (href) {
    return (
      <li>
        <Link href={href} onClick={onNavigate} className="block">
          {body}
        </Link>
      </li>
    );
  }
  return <li>{body}</li>;
}

function resolveLink(n: Notification): string | null {
  if (n.link_url) return n.link_url;
  return defaultLinkForKind(n.kind);
}

function defaultLinkForKind(kind: NotificationKind): string | null {
  switch (kind) {
    case "deep_research_budget_warning":
      return "/kpi";
    case "deep_research_done":
    case "deep_research_failed":
    case "research_job_completed":
    case "research_job_failed":
      return null; // 通常は link_url に店舗 URL が埋め込まれている前提
    default:
      return null;
  }
}

function formatRelativeJst(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "たった今";
    if (diffMin < 60) return `${diffMin} 分前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} 時間前`;
    return new Intl.DateTimeFormat("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(d);
  } catch {
    return isoString;
  }
}
