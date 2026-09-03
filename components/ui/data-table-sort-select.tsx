"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
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
 * ## 生の `<select>` を使う理由
 * `components/ui/select.tsx` は `h-9` (36px) 固定で、`className="h-11"` を重ねると
 * `cn` (素の clsx / tailwind-merge なし) では CSS の記述順で勝敗が決まる。
 * `Select` に size を足すのは全画面に効く変更なので #225 Phase 1 の領分。
 * ここでは 44px を確実に取るため生の `<select>` にリテラルのクラスを当てる。
 * ネイティブ picker なので、選択肢側のタッチターゲットは OS が保証する。
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
      <select
        id="card-sort-key"
        value={selected ? selected.sortKey : ""}
        onChange={(e) => {
          const opt = options.find((o) => o.sortKey === e.currentTarget.value);
          if (!opt) return;
          // 別の列を選んだらその列の既定方向から始める (SortableHeader と同じ規則)。
          router.replace(
            buildSortHref(pathname, params, opt.sortKey, opt.defaultDir),
            { scroll: false },
          );
        }}
        className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!selected ? (
          <option value="" disabled>
            並び替え
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.sortKey} value={o.sortKey}>
            {o.label}
          </option>
        ))}
      </select>

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
