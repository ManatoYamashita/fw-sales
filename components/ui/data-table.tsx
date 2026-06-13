"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { DataTableRow } from "./data-table-row";

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
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
  return (
    <div className={cn("overflow-x-auto", className)}>
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
                )}
                style={
                  col.width || col.maxWidth
                    ? { width: col.width, maxWidth: col.maxWidth }
                    : undefined
                }
              >
                {col.header}
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
