import { listStores } from "@/lib/queries/stores";
import { getAllProfiles } from "@/lib/queries/profiles";
import type { StoreFilter, StoreSort } from "@/types/store";
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
 */
export async function StoresTable({
  filter,
  sort,
}: {
  filter: StoreFilter;
  sort?: StoreSort;
}) {
  const profiles = await getAllProfiles({ excludePlaceholders: false });
  const profilesById = new Map(profiles.map((p) => [p.id, p.display_name]));

  const stores = await listStores(filter, sort, { profilesById });

  // Map / Set を RSC 境界用にプレーン配列へ変換 (依存しない方が安全)
  const profileEntries = profiles.map(
    (p) => [p.id, p.display_name] as const,
  );

  return (
    <StoresTableView stores={stores} profileEntries={profileEntries} />
  );
}
