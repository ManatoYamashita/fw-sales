import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { ResearchForm } from "./_components/research-form";
import { getStoreCached } from "@/lib/queries/stores";
import { getResearchByStore } from "@/lib/queries/research";
import { getAllProfiles } from "@/lib/queries/profiles";

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
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const { storeId } = await params;
  const [store, research, profiles] = await Promise.all([
    getStoreCached(storeId),
    getResearchByStore(storeId),
    getAllProfiles({ excludePlaceholders: false }),
  ]);
  if (!store) notFound();

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link
          href={`/stores/${store.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {store.name}
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
          調査記録
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          口コミと WEB 資産を分析し、最適な営業チャネルとフックを記録します。
        </p>
      </div>
      <ResearchForm store={store} research={research} profiles={profiles} />
    </div>
  );
}
