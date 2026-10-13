"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buildSortResetHref } from "./sortable-header-params";

/**
 * 狭幅一覧の「並び替えを解除」リンク (#330)。
 *
 * `DataTableSortSelect` は基準の変更と方向の反転しか持たないため、共有 URL などで
 * `?sort=…&dir=…` を持って開いた利用者が既定の並びへ戻る手段がここにしか無い。
 * 既定の並びのときは `DataTable` が描画しない。
 *
 * 絞り込みのクエリは保つ (`buildSortResetHref`)。見た目は小さな文字でも、
 * ヒット領域は 44px を確保する。
 */
export function DataTableSortReset() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Link
      href={buildSortResetHref(pathname, params)}
      replace
      scroll={false}
      prefetch={false}
      aria-label="並び替えを解除 (既定の並び順に戻す)"
      className="inline-flex h-11 shrink-0 items-center rounded-md px-2 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      解除
    </Link>
  );
}
