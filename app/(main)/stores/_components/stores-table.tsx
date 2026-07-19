import { listSalesProgressRows } from "@/lib/queries/sales-progress";
import type { ProgressSort, SalesProgressFilter } from "@/lib/domain/sales-progress";
import type { Profile } from "@/types/profile";
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
 * 営業担当 (sales) ソートは profile.display_name 解決が必要なため、
 * profile 取得後に id → display_name の Map を `listStores` の ctx に渡す。
 *
 * `profiles` は親 (`StoresPage`) から渡される。本コンポーネント内で
 * `getAllProfiles` を再取得しない (キャッシュキー分裂 / 二重 SELECT 防止)。
 */
export async function StoresTable({
  filter,
  sort,
  profiles,
}: {
  filter: SalesProgressFilter;
  sort: ProgressSort;
  profiles: readonly Profile[];
}) {
  const rows = await listSalesProgressRows(filter, sort, profiles);
  return <StoresTableView rows={rows} />;
}
