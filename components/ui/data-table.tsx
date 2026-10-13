"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { DataTableRow } from "./data-table-row";
import { SortableHeader, type SortDir } from "./sortable-header";
import { DataTableSortSelect, type SortOption } from "./data-table-sort-select";
import { DataTableSortReset } from "./data-table-sort-reset";
import {
  DATA_TABLE_CONTAINER_CLASS,
  resolveColumnHideClass,
  resolveViewSwitchClasses,
  type ColumnMinContainerWidth,
} from "./data-table-responsive";

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  /**
   * `<th>` と `<td>` の双方へ付く追加 className。
   *
   * **display を切り替えるユーティリティを入れないこと。** 列の表示・非表示は
   * `minContainerWidth` が一元管理しており、variant 付きの display を混ぜると
   * 生成順に依存して勝敗が非決定的になる。
   */
  className?: string;
  /**
   * このカラム上でのクリックは行リンクへ伝搬させない (例: 操作カラム)。
   * `rowHref` が設定されている時のみ意味を持つ。
   */
  preventRowClick?: boolean;
  /** セル内容を 1 行省略 (…) で切り詰める。`maxWidth` と組み合わせて使用。 */
  truncate?: boolean;
  /** truncate 時のセル最大幅。例: "260px"。 */
  maxWidth?: string;
  /** truncate 時の native tooltip (title 属性) として表示する全文。 */
  title?: (row: T) => string | undefined;
  /**
   * この列を描画するのに必要な**コンテナ幅** (px)。省略時は常に表示。
   *
   * viewport ではなくテーブルの表示領域を見るので、サイドバーの折りたたみに
   * 自動追従する。適用は `DataTable` 側で `<th>` / `<td>` へ一括で行うため、
   * 呼び出し元が viewport ブレークポイント付きの display ユーティリティを
   * 直書きしてはいけない (片方だけ直る事故になる)。
   * 取りうる値は `data-table-responsive.ts` 参照。
   */
  minContainerWidth?: ColumnMinContainerWidth;
  /**
   * URL クエリ `?sort=<sortKey>` に書き込むキー。
   * 指定された列ヘッダはクリックでソート切替できる button へ昇格する。
   * `header` が文字列の場合は自動でラベル化、ReactNode の場合は header をそのまま使う。
   */
  sortKey?: string;
  /** 未選択列クリック時の初期方向 (省略時 `asc`) */
  sortDefaultDir?: SortDir;
  /** a11y 用の補助 aria-label */
  sortAriaLabel?: string;
}

export type DataTableDensity = "compact" | "normal";

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyState?: ReactNode;
  className?: string;
  density?: DataTableDensity;
  /** 行クリック時のラッパー (Link 用途) */
  rowHref?: (row: T) => string | undefined;
  /**
   * 現在有効なソートキー (URL の `?sort=`)。**サーバで確定した値**を渡す想定で、
   * `DataTable` 側では `useSearchParams` を読まない (静的シェルを壊さないため)。
   *
   * 一致する `sortKey` を持つ列は `minContainerWidth` を無視して常に表示する。
   */
  activeSortKey?: string;
  rowSelection?: {
    selectedRowKeys: string[];
    onChange: (keys: string[]) => void;
    allRowsLabel?: string;
    rowLabel?: (row: T) => string;
  };
  /**
   * サーバで確定した現在のソート方向 (#234)。コンパクト表示の並び替えコントロールが
   * 現在値を表示するために使う。`activeSortKey` と同じく `useSearchParams` は読まない。
   */
  activeSortDir?: SortDir;
  /**
   * URL に `sort` が無いときのページの既定の並び (#330)。
   *
   * 指定すると、コンパクト表示の並び替えに「解除」を出す。現在の並びがこの既定と
   * 一致するときは出さない (押しても何も変わらないため)。
   */
  defaultSort?: { sortKey: string; dir: SortDir };
  /**
   * 狭いコンテナで `<table>` の代わりに描画するコンパクト表示 (#234 で導入、
   * #330 で枠付きカードから区切り線の行へ組み直し)。名前は導入時のまま残している。
   *
   * **未指定なら出力は現行と 1 バイトも変わらない。** コンパクト表示を必要としない
   * テーブル (dashboard / handoffs) へ影響を出さないための設計。
   *
   * 指定すると表とリストの**両方を DOM に出し**、コンテナクエリで排他に
   * 出し分ける。JS による viewport 判定は使わない (PPR の静的シェルが viewport を
   * 知らず、hydration 後の差し替えでレイアウトシフトとフォーカス喪失が起きるため)。
   *
   * リストは表と同じ見た目の規則に寄せる: `<thead>` に当たる帯 (全選択・並び替え) を
   * 先頭に置き、行は表の行と同じ薄い区切り線で分け、行ごとの枠は持たない。
   * 選択のチェックボックスは帯と各行で同じ 44px の列にそろえる。
   */
  cardView?: {
    /**
     * 1 行ぶんの中身を描画する。区切り線・左右の余白・選択のチェックボックスは
     * `DataTable` 側が持つので、ここでは枠や外側の余白を付けないこと。
     */
    render: (row: T) => ReactNode;
    /** リストの aria-label。 */
    label?: string;
  };
}

const ROW_PADDING: Record<DataTableDensity, string> = {
  compact: "px-3 py-2",
  normal: "px-4 py-3",
};

const HEADER_PADDING: Record<DataTableDensity, string> = {
  compact: "px-3 py-2",
  normal: "px-4 py-2.5",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyState,
  className,
  density = "normal",
  rowHref,
  rowSelection,
  activeSortKey,
  activeSortDir,
  defaultSort,
  cardView,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <div className={className}>{emptyState ?? null}</div>;
  }

  const rowIds = rows.map((row) => rowKey(row));
  const selectedSet = rowSelection
    ? new Set(rowSelection.selectedRowKeys)
    : new Set<string>();
  const allSelected =
    rowSelection && rowIds.length > 0 && rowIds.every((id) => selectedSet.has(id));

  const toggleAllRows = (checked: boolean) => {
    if (!rowSelection) return;
    rowSelection.onChange(checked ? rowIds : []);
  };

  const toggleOneRow = (id: string, checked: boolean) => {
    if (!rowSelection) return;
    const next = new Set(rowSelection.selectedRowKeys);
    if (checked) next.add(id);
    else next.delete(id);
    rowSelection.onChange([...next]);
  };

  // 列の出し分けはコンテナクエリ (CSS のみ)。選択列の有無で閾値が 48px ずれる。
  const hideClass = (col: ColumnDef<T>) =>
    resolveColumnHideClass(col, {
      activeSortKey,
      hasSelectionColumn: Boolean(rowSelection),
    });

  // 表 ⇄ カードの切替も同じコンテナクエリで行う。2 本は完全な補集合なので
  // 「両方隠れる」状態は構造上作れない。
  const viewSwitch = resolveViewSwitchClasses({
    hasSelectionColumn: Boolean(rowSelection),
  });
  const sortOptions: SortOption[] = cardView
    ? columns
        .filter((c) => c.sortKey)
        .map((c) => ({
          sortKey: c.sortKey!,
          label:
            typeof c.header === "string"
              ? c.header
              : (c.sortAriaLabel ?? c.sortKey!),
          defaultDir: c.sortDefaultDir ?? "asc",
        }))
    : [];

  return (
    <div className={cn(DATA_TABLE_CONTAINER_CLASS, "overflow-x-auto", className)}>
      <table
        className={cn(
          "w-full text-sm border-collapse",
          // cardView が無いときは素の table のまま (blast radius ゼロ)。
          cardView && viewSwitch.table,
        )}
      >
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50 border-y border-border">
            {rowSelection ? (
              // 44px のタッチターゲットを <label> で確保する (#234)。セル padding を
              // 4px まで詰めることで min-content は 4 + 44 = 48px となり、
              // SELECTION_COLUMN_WIDTH と 段階表示の閾値表はどちらも不変のまま。
              <th className="px-0.5 py-0 font-semibold whitespace-nowrap w-12 text-center">
                <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center align-middle">
                  <input
                    type="checkbox"
                    checked={Boolean(allSelected)}
                    onChange={(e) => toggleAllRows(e.currentTarget.checked)}
                    aria-label={rowSelection.allRowsLabel ?? "全行を選択"}
                    className="h-4 w-4 accent-primary"
                  />
                </label>
              </th>
            ) : null}
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  HEADER_PADDING[density],
                  "font-semibold whitespace-nowrap",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.className,
                  hideClass(col),
                )}
                style={
                  col.width || col.maxWidth
                    ? { width: col.width, maxWidth: col.maxWidth }
                    : undefined
                }
              >
                {col.sortKey ? (
                  <SortableHeader
                    sortKey={col.sortKey}
                    defaultDir={col.sortDefaultDir}
                    label={col.header}
                    ariaLabel={col.sortAriaLabel}
                  />
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            const id = rowKey(row);
            return (
              <DataTableRow
                key={id}
                href={href}
                className={cn(
                  "border-b border-border/60 last:border-b-0 transition-colors",
                  href &&
                    "cursor-pointer hover:bg-muted/70 active:bg-muted/80 data-[navigating=true]:hover:bg-muted/70",
                )}
              >
                {rowSelection ? (
                  <td
                    data-no-row-click="true"
                    onClick={(e) => e.stopPropagation()}
                    className="px-0.5 py-0 align-middle text-center w-12"
                  >
                    <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center align-middle">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggleOneRow(id, e.currentTarget.checked)}
                        aria-label={rowSelection.rowLabel?.(row) ?? "行を選択"}
                        className="h-4 w-4 accent-primary"
                      />
                    </label>
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    data-no-row-click={col.preventRowClick ? "true" : undefined}
                    className={cn(
                      ROW_PADDING[density],
                      "align-middle text-foreground/90 whitespace-nowrap",
                      col.align === "right" && "text-right tabular-nums",
                      col.align === "center" && "text-center",
                      col.className,
                      hideClass(col),
                    )}
                    style={col.maxWidth ? { maxWidth: col.maxWidth } : undefined}
                  >
                    {col.truncate ? (
                      <div className="truncate" title={col.title?.(row)}>
                        {col.cell(row)}
                      </div>
                    ) : (
                      col.cell(row)
                    )}
                  </td>
                ))}
              </DataTableRow>
            );
          })}
        </tbody>
      </table>

      {cardView ? (
        <div className={cn(viewSwitch.cardList)}>
          {rowSelection || sortOptions.length > 0 ? (
            /*
              表の <thead> に当たる帯。選択・並び替えをここへまとめ、下の行と同じ左端
              (選択のチェックボックス列) にそろえる。並び替えは右へ寄せ、折り返したときも
              右端に置く (`[&>*+*]:ml-auto`。flex-wrap の 2 行目は justify-between が効かない)。
            */
            <div
              className={cn(
                "flex flex-wrap items-center gap-x-1 border-b border-border bg-muted/50 pr-3 [&>*+*]:ml-auto",
                rowSelection ? "pl-0.5" : "pl-4",
              )}
            >
              {rowSelection ? (
                // 表の <thead> チェックボックスがコンパクト表示では消えるため、
                // 等価の「すべて選択」をここに置く。これが無いと admin は狭幅で
                // 一括操作へ到達できなくなる。
                <label className="inline-flex h-11 cursor-pointer items-center pr-1 text-sm text-muted-foreground">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={Boolean(allSelected)}
                      onChange={(e) => toggleAllRows(e.currentTarget.checked)}
                      aria-label={rowSelection.allRowsLabel ?? "全行を選択"}
                      className="h-4 w-4 accent-primary"
                    />
                  </span>
                  すべて選択
                </label>
              ) : null}
              {sortOptions.length > 0 ? (
                <div className="flex min-w-0 items-center gap-1">
                  <DataTableSortSelect
                    options={sortOptions}
                    activeSortKey={activeSortKey}
                    activeSortDir={activeSortDir}
                    className="min-w-0"
                  />
                  {defaultSort &&
                  activeSortKey !== undefined &&
                  (activeSortKey !== defaultSort.sortKey ||
                    activeSortDir !== defaultSort.dir) ? (
                    <DataTableSortReset />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/*
            Tailwind preflight が `list-style: none` を当てるため、Safari + VoiceOver で
            リストのセマンティクスが失われる。role="list" で明示的に復元する。
            行どうしは表の行と同じ薄い区切り線で分け、行ごとの枠は持たない (#330)。
          */}
          <ul role="list" aria-label={cardView.label ?? "一覧 (コンパクト表示)"}>
            {rows.map((row) => {
              const id = rowKey(row);
              return (
                <li
                  key={id}
                  className={cn(
                    "flex items-start gap-1 border-b border-border/60 pt-0.5 pb-2.5 pr-3 last:border-b-0",
                    rowSelection ? "pl-0.5" : "pl-4",
                  )}
                >
                  {rowSelection ? (
                    <label className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(id)}
                        onChange={(e) => toggleOneRow(id, e.currentTarget.checked)}
                        aria-label={rowSelection.rowLabel?.(row) ?? "行を選択"}
                        className="h-4 w-4 accent-primary"
                      />
                    </label>
                  ) : null}
                  {/* min-w-0 が無いと子の truncate が効かず 375px で横溢れする。 */}
                  <div className="min-w-0 flex-1">{cardView.render(row)}</div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
