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
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <div className={className}>{emptyState ?? null}</div>;
  }
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50 border-y border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  HEADER_PADDING[density],
                  "font-semibold",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.className,
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <DataTableRow
                key={rowKey(row)}
                href={href}
                className={cn(
                  "border-b border-border/60 last:border-b-0 hover:bg-muted/40 transition-colors",
                  href && "cursor-pointer",
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    data-no-row-click={col.preventRowClick ? "true" : undefined}
                    className={cn(
                      ROW_PADDING[density],
                      "align-middle text-foreground/90",
                      col.align === "right" && "text-right tabular-nums",
                      col.align === "center" && "text-center",
                      col.className,
                    )}
                  >
                    {col.cell(row)}
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
