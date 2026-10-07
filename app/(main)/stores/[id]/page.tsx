import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { StoreTitleSection } from "./_components/store-title-section";
import { StoreDetailTabs } from "./_components/store-detail-tabs";
import { getStoreCached } from "@/lib/queries/stores";
import { listDealsByStoreCached } from "@/lib/queries/deals";
import { getAllProfiles } from "@/lib/queries/profiles";
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
  // deals は営業進捗タブ用の店舗単位キャッシュ (dealsByStore タグ)。
  // #152 で撤去された dealCount は一覧全店舗の事前計算であり、これとは別物。
  const [store, profiles, deals] = await Promise.all([
    getStoreCached(id),
    getAllProfiles({ excludePlaceholders: false }),
    listDealsByStoreCached(id),
  ]);
  if (!store) notFound();
  // task 4.2 (PR3a): DeepResearchSection / getDeepResearchReport / assignedSalesName 解決 /
  // promptTemplates 取得を撤去。
  // #300: 営業資産の生成は /research/[storeId] に一本化したため、GEMINI_API_KEY の
  // 設定済判定もそちらへ移した。店舗詳細の AI 分析タブは閲覧専用。
  // store-cascade-delete (#152): dealCount の事前計算 (listDealsByStoreCached) を撤去。
  // 削除ダイアログが open 時に影響件数を非キャッシュで直接取得する。
  // 営業資産フェーズ (未生成 / 生成済み) を現行スキーマから純粋に導出する。
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
        deals={deals}
      />
    </div>
  );
}
