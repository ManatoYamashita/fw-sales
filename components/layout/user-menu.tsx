"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { signOutAction } from "@/lib/actions/auth-actions";
import { cn } from "@/lib/utils/cn";
import type { Profile } from "@/types/profile";

function getInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

function getRoleLabel(profile: Profile | null | undefined): string {
  if (profile?.role === "placeholder") return "未登録";
  if (profile?.role === "admin") return "管理者";
  return "メンバー";
}

export interface UserMenuProps {
  /** 現在ログイン中のプロフィール。proxy が保護するため通常は null にならない。 */
  profile?: Profile | null;
  /** サイドバー下部か Topbar 右端か。 */
  variant?: "sidebar" | "topbar";
  /** サイドバーがアイコンレールへ折りたたまれているか。 */
  collapsed?: boolean;
}

/**
 * 現在ユーザーのアバター、Profile表示、サインアウトメニュー。
 * Sidebar と Topbar で同じ認証操作を提供し、表示位置だけを variant で切り替える。
 */
export function UserMenu({
  profile,
  variant = "topbar",
  collapsed = false,
}: UserMenuProps) {
  const displayName = profile?.display_name ?? "ゲスト";
  const role = getRoleLabel(profile);
  const isSidebar = variant === "sidebar";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleSignOut() {
    setSignOutError(null);
    startTransition(async () => {
      const result = await signOutAction();
      if (!result.ok) {
        setSignOutError(result.error);
        return;
      }
      setOpen(false);
      router.push(result.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <div
      ref={menuRef}
      className={cn(
        "relative",
        isSidebar && "px-3 py-3 border-t border-sidebar-border",
      )}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`ユーザーメニュー: ${displayName}`}
        onClick={() => setOpen((value) => !value)}
        title={isSidebar && collapsed ? displayName : undefined}
          className={cn(
            isSidebar
              ? "flex w-full items-center gap-3 px-1 py-1 rounded-md text-left hover:bg-sidebar-accent/60"
              : "inline-flex min-h-11 md:min-h-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent",
          "transition-colors focus-visible:outline-none focus-visible:ring-2",
          isSidebar
            ? "focus-visible:ring-sidebar-ring"
            : "focus-visible:ring-ring",
          isSidebar && collapsed && "md:justify-center",
        )}
      >
        <span
          className="h-9 w-9 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-sm font-semibold shrink-0 ring-1 ring-border overflow-hidden"
          aria-hidden
        >
          {profile?.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={profile.avatar_url}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span>{getInitial(displayName)}</span>
          )}
        </span>
        <span
          className={cn(
            "min-w-0 leading-tight",
            isSidebar ? "flex-1" : "hidden sm:block max-w-32",
            isSidebar && collapsed && "md:hidden",
          )}
        >
          <span
            className={cn(
              "block text-sm font-semibold truncate",
              isSidebar ? "text-sidebar-foreground" : "text-foreground",
            )}
          >
            {displayName}
          </span>
          <span className="block text-[11px] text-muted-foreground truncate">
            {role}
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "z-30 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
            isSidebar
              ? "absolute left-3 right-3 bottom-full mb-2"
              : "absolute right-0 top-full mt-2 w-56",
            isSidebar && collapsed && "md:left-2 md:right-auto md:w-56",
          )}
        >
          {profile?.email ? (
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-xs text-muted-foreground truncate">
                {profile.email}
              </p>
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={isPending}
            onClick={handleSignOut}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm rounded-sm w-full text-left",
              "hover:bg-accent hover:text-accent-foreground",
              "focus:bg-accent focus:text-accent-foreground focus:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            <span>{isPending ? "サインアウト中..." : "サインアウト"}</span>
          </button>
          {signOutError ? (
            <p
              role="alert"
              className="px-3 py-2 text-xs text-destructive border-t border-border mt-1"
            >
              {signOutError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
