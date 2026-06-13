import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { StoreTitleSection } from "./_components/store-title-section";
import { StoreDetailTabs } from "./_components/store-detail-tabs";
import { getStoreCached } from "@/lib/queries/stores";
import { listDealsByStoreCached } from "@/lib/queries/deals";
import { getAllProfiles } from "@/lib/queries/profiles";
import { isApiKeyConfigured } from "@/lib/env";
import { getStoreResearchPhase } from "@/lib/domain/store-research-phase";

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
  const { id } = await params;
  const [store, profiles] = await Promise.all([
    getStoreCached(id),
    getAllProfiles({ excludePlaceholders: false }),
  ]);
  if (!store) notFound();
  // task 4.2 (PR3a): DeepResearchSection / getDeepResearchReport / assignedSalesName 解決 /
  // promptTemplates 取得を撤去。営業資産生成は SalesAssetsGenerator (store-detail-tabs 配下)
  // が GEMINI_API_KEY 設定済判定だけ受け取る単純構成。
  const deals = await listDealsByStoreCached(store.id);
  const dealCount = deals.length;
  const apiKeyConfigured = isApiKeyConfigured();
  // 調査フェーズ (未調査 / 調査可 / 生成済み) を現行スキーマから純粋に導出する。
  const researchPhase = getStoreResearchPhase(store);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link
          href="/stores"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 店舗一覧
        </Link>
        <StoreTitleSection store={store} phase={researchPhase} />
      </div>

      <StoreDetailTabs
        store={store}
        profiles={profiles}
        isApiKeyConfigured={apiKeyConfigured}
        dealCount={dealCount}
      />
    </div>
  );
}
