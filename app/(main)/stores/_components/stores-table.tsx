import { listStores } from "@/lib/queries/stores";
import { getAllProfiles } from "@/lib/queries/profiles";
import { listActiveDeepResearchStoreIds } from "@/lib/queries/deep-research";
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
 */
export async function StoresTable({
  filter,
  sort,
}: {
  filter: StoreFilter;
  sort?: StoreSort;
}) {
  const [stores, profiles, activeDrStoreIds] = await Promise.all([
    listStores(filter, sort),
    getAllProfiles({ excludePlaceholders: false }),
    listActiveDeepResearchStoreIds(),
  ]);

  // Map / Set を RSC 境界用にプレーン配列へ変換 (依存しない方が安全)
  const profileEntries = profiles.map(
    (p) => [p.id, p.display_name] as const,
  );

  return (
    <StoresTableView
      stores={stores}
      profileEntries={profileEntries}
      activeDrStoreIds={[...activeDrStoreIds]}
    />
  );
}
