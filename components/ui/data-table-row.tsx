"use client";

import { type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export interface DataTableRowProps {
  href?: string;
  className?: string;
  children: ReactNode;
}

export function DataTableRow({ href, className, children }: DataTableRowProps) {
  const router = useRouter();

  const shouldSkipNavigation = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (target.closest("[data-no-row-click]")) return true;
    if (target.closest("a, button, input, select, textarea, [role='button']")) {
      return true;
    }
    return false;
  };

  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if (!href) return;
    if (shouldSkipNavigation(e.target)) return;
    router.push(href);
  };

  return (
    <tr
      className={className}
      onClick={href ? onClick : undefined}
      onKeyDown={
        href
          ? (e: KeyboardEvent<HTMLTableRowElement>) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              if (shouldSkipNavigation(e.target)) return;
              e.preventDefault();
              router.push(href);
            }
          : undefined
      }
    >
      {children}
    </tr>
  );
}
