import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ResearchForm } from "./_components/research-form";
import { getStoreCached } from "@/lib/queries/stores";
import { getResearchByStore } from "@/lib/queries/research";

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
  const [store, research] = await Promise.all([
    getStoreCached(storeId),
    getResearchByStore(storeId),
  ]);
  if (!store) notFound();

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link
          href={`/stores/${store.id}`}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ← {store.name}
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
          調査記録
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          口コミと WEB 資産を分析し、最適な営業チャネルとフックを記録します。
        </p>
      </div>
      <ResearchForm store={store} research={research} />
    </div>
  );
}
