"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { DataTableRow } from "./data-table-row";
import { SortableHeader, type SortDir } from "./sortable-header";
import {
  DATA_TABLE_CONTAINER_CLASS,
  resolveColumnHideClass,
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

  return (
    <div className={cn(DATA_TABLE_CONTAINER_CLASS, "overflow-x-auto", className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50 border-y border-border">
            {rowSelection ? (
              <th
                className={cn(
                  HEADER_PADDING[density],
                  "font-semibold whitespace-nowrap w-10 text-center",
                )}
              >
                <input
                  type="checkbox"
                  checked={Boolean(allSelected)}
                  onChange={(e) => toggleAllRows(e.currentTarget.checked)}
                  aria-label={rowSelection.allRowsLabel ?? "全行を選択"}
                  className="h-4 w-4 accent-primary"
                />
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
                    className={cn(
                      ROW_PADDING[density],
                      "align-middle text-center w-10",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggleOneRow(id, e.currentTarget.checked)}
                      aria-label={rowSelection.rowLabel?.(row) ?? "行を選択"}
                      className="h-4 w-4 accent-primary"
                    />
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
    </div>
  );
}
