import { listSalesProgressRows } from "@/lib/queries/sales-progress";
import type { ProgressSort, SalesProgressFilter } from "@/lib/domain/sales-progress";
import { StoresTableView } from "./stores-table-view";

/**
 * 店舗一覧の Server Component shell。
 *
 * `cell` / `title` / `rowKey` / `rowHref` などの関数を column 定義に含む
 * `DataTable` (`"use client"`) は RSC 境界で関数を受け取れない
 * (Next.js 16 / React 19 の serialization 制約)。
 * 本コンポーネントはデータ取得のみを担い、レンダリングは
 * `StoresTableView` (`"use client"`) に委譲する。
 *
 * task 4.2 (PR3a): listActiveDeepResearchStoreIds 撤去 (#121 / #110 連動)。
 *
 * 営業担当 (sales) ソートに必要な profile.display_name の解決は
 * `listSalesProgressRows` の内部で完結する (props 経由では受け取らない)。
 * profiles を引数で渡す形にすると、渡し忘れたときに全行の salesName が null になり
 * sales ソートが無言で壊れるため。
 */
export async function StoresTable({
  filter,
  sort,
}: {
  filter: SalesProgressFilter;
  sort: ProgressSort;
}) {
  const rows = await listSalesProgressRows(filter, sort);
  return <StoresTableView rows={rows} />;
}
