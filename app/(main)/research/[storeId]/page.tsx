import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AiResearchWorkbench } from "./_components/ai-research-workbench";
import { getStoreCached } from "@/lib/queries/stores";
import { repos } from "@/lib/repositories";

type Params = Promise<{ storeId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { storeId } = await params;
  const store = await getStoreCached(storeId);
  return {
    title: store ? `${store.name} の調査` : "調査",
  };
}

export default async function ResearchDetailPage({
  params,
}: {
  params: Params;
}) {
  const { storeId } = await params;
  const [store, runs] = await Promise.all([
    getStoreCached(storeId),
    // 調査run一覧は running中の状態を含むため 'use cache' を経由しない
    // (`repos.researchRun.listForStore` 参照、PR4)。
    repos.researchRun.listForStore(storeId, 10),
  ]);
  if (!store) notFound();
  // AI 店舗調査再設計(Plan v3.2)により、旧 STEP0(外部 Gem へのプロンプト生成・貼付欄)は
  // 撤去した(§5.1, §12)。`buildBasicInfoBlock` 自体は `generateSalesAssetsAction` の
  // プロンプト組み立てに引き続き使われるため削除しない(§14)。
  return <AiResearchWorkbench store={store} initialRuns={runs} />;
}
