import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PasteWorkbench } from "./_components/paste-workbench";
import { getStoreCached } from "@/lib/queries/stores";
import { getGemUrlCached } from "@/lib/queries/app-settings";
import { buildBasicInfoBlock } from "@/lib/ai/basic-info-prompt";

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
  const [store, gemUrl] = await Promise.all([
    getStoreCached(storeId),
    getGemUrlCached(),
  ]);
  if (!store) notFound();
  // task 3.6 (PR2): 旧 51 項目プレビュー (DeepResearchReportView) を撤去したため
  // initialReport / getDeepResearchReport は本ページでは不要 (#121)。
  // STEP0 (Issue #122): 外部 Gem へ渡す基本情報サマリを server で算出 (buildBasicInfoBlock
  // は server-only)。店名を先頭に付し、basic_info が薄い店舗でも最低限の文脈を持たせる。
  const researchPrompt = `${store.name}\n\n${buildBasicInfoBlock(store.basic_info)}`;
  return (
    <PasteWorkbench
      store={store}
      researchPrompt={researchPrompt}
      gemUrl={gemUrl}
    />
  );
}
