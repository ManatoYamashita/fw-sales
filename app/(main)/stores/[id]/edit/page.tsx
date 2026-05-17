import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { StoreEditForm } from "./_components/store-edit-form";
import { getStoreCached } from "@/lib/queries/stores";
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
  return { title: store ? `${store.name} を編集` : "店舗を編集" };
}

export default async function StoreEditPage({
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
  // GEMINI_API_KEY の有無を SSR で判定して props で渡す(Req 2.7)
  const apiKeyConfigured = isApiKeyConfigured();
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
      <StoreEditForm
        store={store}
        isApiKeyConfigured={apiKeyConfigured}
        profiles={profiles}
      />
    </div>
  );
}
