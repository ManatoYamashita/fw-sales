"use client";

/**
 * Topbar Bell ドロップダウン (auth-and-notifications spec #16)
 *
 * - 未読件数バッジを表示し、クリックで最新通知 (default 10 件) を展開
 * - 通知の `kind` に応じてリンク先を決定 (通常は `link_url` に店舗 URL が埋め込まれる)
 * - 外側クリック / Escape キーで閉じる
 * - 通知のクリックで既読化し、ヘッダーの「すべて既読にする」で一括既読化する (#296)。
 *   バッジはサーバー応答を待たずに楽観的に減らし、失敗したときだけ元へ戻す
 * - リンク先が無い通知 (参照先店舗が削除済みなど) は遷移させず、既読化だけ行う
 *
 * 親 RSC が `getRecentNotifications(userId, limit=10)` の結果を props で渡す前提。
 *
 * 関連: requirements.md §4.1, §4.2, §4.3
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Inbox } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/toast";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/actions/notification-actions";
import {
  OVERLAY_ANCHOR_CONTAINER,
  OVERLAY_PANEL_ALIGN_END,
} from "@/components/ui/overlay-anchor-classes";
import type { Notification, NotificationKind } from "@/types/notification";

interface NotificationBellProps {
  notifications: readonly Notification[];
}

export function NotificationBell({ notifications }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // サーバー応答前に既読として扱う通知 ID (楽観更新)。props が最新化された後も
  // 残るが、そのときは read_at と一致するだけなので害はない。
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isMarkingAll, startMarkAll] = useTransition();

  const isRead = useCallback(
    (n: Notification) => n.read_at !== null || locallyRead.has(n.id),
    [locallyRead],
  );
  const unreadIds = notifications.filter((n) => !isRead(n)).map((n) => n.id);
  const unreadCount = unreadIds.length;

  const markLocally = useCallback((ids: readonly string[]) => {
    setLocallyRead((prev) => new Set([...prev, ...ids]));
  }, []);
  const unmarkLocally = useCallback((ids: readonly string[]) => {
    setLocallyRead((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const handleRead = useCallback(
    (notification: Notification) => {
      if (isRead(notification)) return;
      markLocally([notification.id]);
      void markNotificationReadAction(notification.id).then((result) => {
        if (!result.ok) {
          unmarkLocally([notification.id]);
          toast.error(result.error);
        }
      });
    },
    [isRead, markLocally, unmarkLocally],
  );

  const handleMarkAll = useCallback(() => {
    if (unreadIds.length === 0) return;
    const ids = unreadIds;
    markLocally(ids);
    startMarkAll(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        unmarkLocally(ids);
        toast.error(result.error);
      }
    });
  }, [unreadIds, markLocally, unmarkLocally]);

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
    // 位置の契約は overlay-anchor-classes.ts が単一の真実 (#225 Phase 3)。
    // ボタン側 (下の `relative`) は未読バッジの基準なのでそのまま残す。
    <div ref={containerRef} className={OVERLAY_ANCHOR_CONTAINER}>
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
            className="absolute top-1 right-1 inline-flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs font-medium leading-none"
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
          className={cn(
            "absolute mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover shadow-md z-30",
            OVERLAY_PANEL_ALIGN_END,
          )}
        >
          <div className="border-b border-border px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-medium">通知</span>
              <span className="text-xs text-muted-foreground">
                {unreadCount > 0 ? `${unreadCount} 件未読` : "未読なし"}
              </span>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={isMarkingAll}
                className="shrink-0 inline-flex min-h-8 items-center rounded-sm px-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                すべて既読にする
              </button>
            ) : null}
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
                  isUnread={!isRead(n)}
                  onRead={handleRead}
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
  isUnread: boolean;
  onRead: (notification: Notification) => void;
  onNavigate: () => void;
}

function NotificationRow({
  notification,
  isUnread,
  onRead,
  onNavigate,
}: NotificationRowProps) {
  const href = resolveLink(notification);
  const body = (
    <article
      className={cn(
        "px-3 py-2 hover:bg-accent transition-colors",
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
          <p className="text-xs text-muted-foreground mt-1">
            {formatRelativeJst(notification.created_at)}
          </p>
        </div>
      </div>
    </article>
  );

  const label = `${isUnread ? "未読: " : ""}${notification.title}`;
  if (href) {
    return (
      <li className="border-b border-border last:border-b-0">
        <Link
          href={href}
          aria-label={label}
          onClick={() => {
            onRead(notification);
            onNavigate();
          }}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {body}
        </Link>
      </li>
    );
  }
  // 遷移先が無い通知 (参照先が削除済みなど) は遷移させず、既読化だけ行う。
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-label={label}
        onClick={() => onRead(notification)}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {body}
      </button>
    </li>
  );
}

function resolveLink(n: Notification): string | null {
  if (n.link_url) return n.link_url;
  return defaultLinkForKind(n.kind);
}

function defaultLinkForKind(kind: NotificationKind): string | null {
  switch (kind) {
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
