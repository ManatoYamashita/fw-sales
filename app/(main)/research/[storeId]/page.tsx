import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PasteWorkbench } from "./_components/paste-workbench";
import { getStoreCached } from "@/lib/queries/stores";
import { getDeepResearchReport } from "@/lib/queries/deep-research";

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
  const [store, report] = await Promise.all([
    getStoreCached(storeId),
    getDeepResearchReport(storeId),
  ]);
  if (!store) notFound();

  return <PasteWorkbench store={store} initialReport={report} />;
}
