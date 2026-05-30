"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const RowNavigationContext = createContext(false);

/** 行クリックによるページ遷移の pending 中か。セル内でスピナー表示などに使う。 */
export function useDataTableRowNavigating(): boolean {
  return useContext(RowNavigationContext);
}

export interface DataTableRowProps {
  href?: string;
  className?: string;
  children: ReactNode;
}

export function DataTableRow({ href, className, children }: DataTableRowProps) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const isThisRowNavigating = Boolean(href && isNavigating && pendingHref === href);

  const shouldSkipNavigation = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (target.closest("[data-no-row-click]")) return true;
    if (target.closest("a, button, input, select, textarea, [role='button']")) {
      return true;
    }
    return false;
  };

  const navigate = () => {
    if (!href || isNavigating) return;
    setPendingHref(href);
    startTransition(() => {
      router.push(href);
    });
  };

  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if (!href) return;
    if (shouldSkipNavigation(e.target)) return;
    navigate();
  };

  const onMouseEnter = () => {
    if (href) router.prefetch(href);
  };

  return (
    <RowNavigationContext.Provider value={isThisRowNavigating}>
      <tr
        data-navigating={isThisRowNavigating ? "true" : undefined}
        aria-busy={isThisRowNavigating ? true : undefined}
        title={isThisRowNavigating ? "ページを読み込み中…" : undefined}
        className={cn(
          className,
          isThisRowNavigating && "bg-muted/70 cursor-wait",
        )}
        onClick={href ? onClick : undefined}
        onMouseEnter={href ? onMouseEnter : undefined}
        onKeyDown={
          href
            ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                if (shouldSkipNavigation(e.target)) return;
                e.preventDefault();
                navigate();
              }
            : undefined
        }
      >
        {children}
      </tr>
    </RowNavigationContext.Provider>
  );
}
