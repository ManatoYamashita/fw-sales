"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Select } from "./select";
import {
  buildSortHref,
  readSortState,
  type SortDir,
} from "./sortable-header-params";

export interface SortOption {
  /** URL の `?sort=` に書き込むキー。 */
  sortKey: string;
  /** 表示ラベル。 */
  label: string;
  /** その列を新たに選んだときの初期方向。 */
  defaultDir: SortDir;
}

export interface DataTableSortSelectProps {
  options: SortOption[];
  /** サーバで確定した現在のソートキー。 */
  activeSortKey?: string;
  /** サーバで確定した現在の方向。 */
  activeSortDir?: SortDir;
  className?: string;
}

/**
 * カードモードの並び替えコントロール (#234 / PR3/3)。
 *
 * ## なぜ必要か
 * カード表示では列ヘッダが消えるため `SortableHeader` に触れなくなる。
 * `SortableHeader` は asc ⇄ desc のトグルしか持たず「ソート解除」が無いので、
 * `?sort=name&dir=desc` を持ったまま 375px を開いた利用者は
 * **並び順を知覚できず、変更もできず、解除もできない**状態に陥る。
 * ブックマーク・共有 URL・端末回転で普通に起きる (#220 要件 5)。
 *
 * ## 共通 Select を使う (#334)
 *
 * #234 の初版は、`Select` が 36px 固定で 44px を確保できなかったため生の `<select>` を
 * 置き、選択肢側のタッチ領域を OS の picker に委ねていた。#334 で「デスクトップ・
 * モバイルとも、ブラウザ / OS 標準のプルダウンを出さない」方針になり、共通 `Select` の
 * `density="touch"` (常に 44px、候補も 44px) へ移した。候補パネルの配置・キー操作は
 * `select.tsx` が受け持つ。
 */
export function DataTableSortSelect({
  options,
  activeSortKey,
  activeSortDir,
  className,
}: DataTableSortSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (options.length === 0) return null;

  // サーバ確定値を優先し、無ければ URL から読む (`SortableHeader` と同じ解釈)。
  const fromUrl = readSortState(params);
  const currentKey = activeSortKey ?? fromUrl.sortKey ?? "";
  const currentDir: SortDir = activeSortDir ?? fromUrl.dir;
  const selected = options.find((o) => o.sortKey === currentKey);
  const flippedDir: SortDir = currentDir === "asc" ? "desc" : "asc";
  const selectOptions = options.map((o) => ({ value: o.sortKey, label: o.label }));

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      // 表示中は表と排他なので、リスト全体のラベルと重複しないよう役割を明示する。
      role="group"
      aria-label="並び替え"
    >
      <label htmlFor="card-sort-key" className="sr-only">
        並び替えの基準
      </label>
      <Select
        id="card-sort-key"
        width="auto"
        density="touch"
        options={selectOptions}
        value={selected ? selected.sortKey : ""}
        placeholder="並び替え"
        onValueChange={(value) => {
          const opt = options.find((o) => o.sortKey === value);
          if (!opt) return;
          // 別の列を選んだらその列の既定方向から始める (SortableHeader と同じ規則)。
          router.replace(
            buildSortHref(pathname, params, opt.sortKey, opt.defaultDir),
            { scroll: false },
          );
        }}
        className="min-w-0 flex-1"
      />

      {selected ? (
        <Link
          href={buildSortHref(pathname, params, selected.sortKey, flippedDir)}
          replace
          scroll={false}
          prefetch={false}
          aria-label={`並び順を${flippedDir === "asc" ? "昇順" : "降順"}に変更 (現在: ${
            currentDir === "asc" ? "昇順" : "降順"
          })`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {currentDir === "asc" ? (
            <ArrowUp className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDown className="h-4 w-4" aria-hidden />
          )}
        </Link>
      ) : null}
    </div>
  );
}
