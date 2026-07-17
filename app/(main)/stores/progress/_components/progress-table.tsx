import { listSalesProgressRows } from "@/lib/queries/sales-progress";
import type {
  ProgressSort,
  SalesProgressFilter,
} from "@/lib/domain/sales-progress";
import { ProgressTableView } from "./progress-table-view";

/**
 * 営業進捗一覧の Server Component shell (`StoresTable` と同構成)。
 *
 * `cell` 関数を含む column 定義は RSC 境界を越えられないため、
 * 本コンポーネントはデータ取得のみを担い、レンダリングは
 * `ProgressTableView` (`"use client"`) に委譲する。
 */
export async function ProgressTable({
  filter,
  sort,
}: {
  filter: SalesProgressFilter;
  sort: ProgressSort;
}) {
  const rows = await listSalesProgressRows(filter, sort);
  return <ProgressTableView rows={rows} />;
}
