"use client";

/**
 * UserMenu — アバター + ドロップダウン (auth-and-notifications spec, Issue #16)
 *
 * Topbar に表示される認証ユーザーのメニュー。アバター画像 (なければ表示名の頭文字)、
 * 表示名、メール、サインアウトボタンを含む。
 *
 * - `signOutAction` を Server Action として呼び出し、`redirectTo` で返された
 *   URL に `router.push` で遷移する (Req 1.6)
 * - Click-outside / Escape キーでメニューを閉じる
 * - 失敗時はインラインでエラー文言を表示
 *
 * 関連: design.md §「components/layout/user-menu.tsx」, requirements.md §1.5, §1.6
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { Profile } from "@/types/profile";
import { signOutAction } from "@/lib/actions/auth-actions";
import { cn } from "@/lib/utils/cn";

interface Props {
  readonly profile: Profile;
}

function getInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

export function UserMenu({ profile }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
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
    setError(null);
    startTransition(async () => {
      const result = await signOutAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(result.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`ユーザーメニュー: ${profile.display_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full",
          "bg-accent text-accent-foreground text-xs font-semibold",
          "hover:bg-accent/80 transition-colors overflow-hidden",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {profile.avatar_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={profile.avatar_url}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span aria-hidden>{getInitial(profile.display_name)}</span>
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full mt-2 z-30 min-w-56",
            "rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
          )}
        >
          <div className="px-3 py-2 border-b border-border mb-1">
            <p className="text-sm font-semibold truncate">
              {profile.display_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {profile.email}
            </p>
          </div>
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
            <LogOut className="h-4 w-4" />
            <span>{isPending ? "サインアウト中..." : "サインアウト"}</span>
          </button>
          {error ? (
            <p
              role="alert"
              className="px-3 py-2 text-xs text-destructive border-t border-border mt-1"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
