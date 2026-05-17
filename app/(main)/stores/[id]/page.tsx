import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { StoreTitleSection } from "./_components/store-title-section";
import { StoreDetailTabs } from "./_components/store-detail-tabs";
import { getStoreCached } from "@/lib/queries/stores";
import { listDealsByStoreCached } from "@/lib/queries/deals";
import { getAllProfiles } from "@/lib/queries/profiles";
import { isApiKeyConfigured } from "@/lib/env";

type Params = Promise<{ id: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const store = await getStoreCached(id);
  return {
    title: store ? store.name : "店舗詳細",
  };
}

export default async function StoreDetailPage({
  params,
}: {
  params: Params;
}) {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const { id } = await params;
  const [store, profiles] = await Promise.all([
    getStoreCached(id),
    getAllProfiles({ excludePlaceholders: false }),
  ]);
  if (!store) notFound();
  const dealCount = (await listDealsByStoreCached(store.id)).length;
  const apiKeyConfigured = isApiKeyConfigured();
  // Phase 8: 旧 `store.assigned_sales` (text) DROP 済。AI Panel に渡す display_name を事前解決。
  const assignedSalesName = store.assigned_sales_user_id
    ? (profiles.find((p) => p.id === store.assigned_sales_user_id)
        ?.display_name ?? "")
    : "";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link
          href="/stores"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 店舗一覧
        </Link>
        <StoreTitleSection store={store} />
      </div>

      <StoreDetailTabs
        store={store}
        profiles={profiles}
        isApiKeyConfigured={apiKeyConfigured}
        assignedSalesName={assignedSalesName}
        dealCount={dealCount}
      />
    </div>
  );
}
