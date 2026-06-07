import type { Metadata } from "next";
import { listDealsCached } from "@/lib/queries/deals";
import { listStores } from "@/lib/queries/stores";
import { getAllProfiles } from "@/lib/queries/profiles";
import {
  DealCreateButton,
  type DealCreateStoreOption,
} from "./_components/deal-create-button";
import { DealsTableView } from "./_components/deals-table-view";

export const metadata: Metadata = {
  title: "商談管理",
};

export default async function DealsPage() {
  const [deals, stores, profiles] = await Promise.all([
    listDealsCached(),
    listStores({}),
    getAllProfiles({ excludePlaceholders: false }),
  ]);

  const storeOptions: DealCreateStoreOption[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    prefecture: s.prefecture,
    city: s.city,
  }));

  // Map → tuple 配列。`cell` 関数を含む column 構築は client view 側で行う。
  const profileEntries = profiles.map(
    (p) => [p.id, p.display_name] as const,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          商談管理
        </h2>
        <DealCreateButton stores={storeOptions} />
      </div>
      <DealsTableView deals={deals} profileEntries={profileEntries} />
    </div>
  );
}
