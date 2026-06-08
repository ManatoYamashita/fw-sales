import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PasteWorkbench } from "./_components/paste-workbench";
import { getStoreCached } from "@/lib/queries/stores";

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
  const store = await getStoreCached(storeId);
  if (!store) notFound();
  // task 3.6 (PR2): 旧 51 項目プレビュー (DeepResearchReportView) を撤去したため
  // initialReport / getDeepResearchReport は本ページでは不要 (#121)。
  return <PasteWorkbench store={store} />;
}
