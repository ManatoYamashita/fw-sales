import type { ColumnDef } from "@/components/ui/data-table";
import { getNearestStationValue } from "@/lib/domain/nearest-station";
import type { SalesProgressRow } from "@/lib/domain/sales-progress";

/**
 * 店舗一覧の最寄駅列。
 *
 * `location` は既存のURLクエリ互換性 (`?sort=location`) のため維持する。
 */
export function buildStoreLocationColumn(): ColumnDef<SalesProgressRow> {
  return {
    key: "location",
    header: "最寄駅",
    sortKey: "location",
    sortDefaultDir: "asc",
    truncate: true,
    maxWidth: "200px",
    title: (row) =>
      getNearestStationValue(row.store.basic_info) ?? undefined,
    cell: (row) => (
      <span className="text-foreground/80">
        {getNearestStationValue(row.store.basic_info) ?? "—"}
      </span>
    ),
  };
}
