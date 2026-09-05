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
    // 業態より上位。#175 / #177 が「エリア表示を最寄駅表示へ」と決めた列なので、
    // 2000px 未満で 1 列落とすときは業態を先に落とす (issue #220)。
    minContainerWidth: 1174,
    title: (row) =>
      getNearestStationValue(row.store.basic_info) ?? undefined,
    cell: (row) => (
      <span className="text-foreground/80">
        {getNearestStationValue(row.store.basic_info) ?? "—"}
      </span>
    ),
  };
}
