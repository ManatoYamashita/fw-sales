import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { StoreEditForm } from "./_components/store-edit-form";
import { getStoreCached } from "@/lib/queries/stores";
import { getAllProfiles } from "@/lib/queries/profiles";

type Params = Promise<{ id: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const store = await getStoreCached(id);
  return { title: store ? `${store.name} を編集` : "店舗を編集" };
}

export default async function StoreEditPage({
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
  // task 4.2 (PR3a): AiAnalysisPanel 撤去に伴い isApiKeyConfigured / promptTemplates の
  // 取得・受渡しを削除。営業資産生成は店舗詳細の SalesAssetsGenerator に集約。
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link
          href={`/stores/${id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {store.name}
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
          店舗を編集
        </h2>
      </div>
      <StoreEditForm store={store} profiles={profiles} />
    </div>
  );
}
