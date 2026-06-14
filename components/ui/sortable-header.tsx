"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type SortDir = "asc" | "desc";

export interface SortableHeaderProps {
  /** URL の `?sort=` に書き込むキー */
  sortKey: string;
  /** 未選択列が選ばれた時の初期方向 */
  defaultDir?: SortDir;
  /** ヘッダ表示テキスト/ノード */
  label: ReactNode;
  /** a11y: aria-label の補助テキスト (例: "店舗名で並び替え") */
  ariaLabel?: string;
  /** ヘッダ全体の追加 className (text-align 等) */
  className?: string;
}

/**
 * テーブル列ヘッダ用のクリックでソートするボタン。
 *
 * - 未選択 → `?sort=<key>&dir=<defaultDir>`
 * - 同じ列 → `dir` を asc ↔ desc 反転
 * - 他の URL クエリ (q, stage, channel など) は保持
 *
 * `<Link replace scroll={false}>` でナビゲートし、スクロール位置とブラウザ履歴の
 * 肥大化を避ける。Next.js 16 では prefetch 既定で十分応答が早い。
 */
export function SortableHeader({
  sortKey,
  defaultDir = "asc",
  label,
  ariaLabel,
  className,
}: SortableHeaderProps) {
  const params = useSearchParams();
  const pathname = usePathname();

  const currentSort = params.get("sort");
  const currentDir = params.get("dir") === "asc" ? "asc" : "desc";
  const isActive = currentSort === sortKey;
  const effectiveDir: SortDir = isActive ? (currentDir as SortDir) : defaultDir;

  // クリック時の遷移先: 新しい dir を計算
  const nextDir: SortDir = isActive
    ? effectiveDir === "asc"
      ? "desc"
      : "asc"
    : defaultDir;

  const next = new URLSearchParams(params.toString());
  next.set("sort", sortKey);
  next.set("dir", nextDir);
  const href = `${pathname}?${next.toString()}`;

  const Icon = !isActive ? ArrowUpDown : effectiveDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <Link
      href={href}
      replace
      scroll={false}
      prefetch={false}
      aria-label={
        ariaLabel ??
        `${typeof label === "string" ? label : sortKey} で並び替え (現在: ${
          isActive ? (effectiveDir === "asc" ? "昇順" : "降順") : "未選択"
        })`
      }
      aria-sort={
        isActive ? (effectiveDir === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn(
        "group inline-flex items-center gap-1 select-none",
        "rounded-md -mx-1 px-1 py-0.5",
        "transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive && "text-foreground",
        className,
      )}
    >
      <span>{label}</span>
      <Icon
        aria-hidden
        className={cn(
          "h-3 w-3 shrink-0 transition-opacity",
          isActive ? "opacity-100" : "opacity-40 group-hover:opacity-80",
        )}
      />
    </Link>
  );
}
