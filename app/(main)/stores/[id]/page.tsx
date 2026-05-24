import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { StoreTitleSection } from "./_components/store-title-section";
import { StoreDetailTabs } from "./_components/store-detail-tabs";
import { DeepResearchSection } from "./_components/deep-research-section";
import { getStoreCached } from "@/lib/queries/stores";
import { listDealsByStoreCached } from "@/lib/queries/deals";
import { getAllProfiles } from "@/lib/queries/profiles";
import { isApiKeyConfigured } from "@/lib/env";
import { getCurrentSession } from "@/lib/supabase/server";
import { repos } from "@/lib/repositories";
import type { PromptTemplateOption } from "@/app/(main)/stores/new/_components/ai-analysis-panel";

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

function DeepResearchFallback() {
  return (
    <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
      Deep Research を読み込み中…
    </div>
  );
}

export default async function StoreDetailPage({
  params,
}: {
  params: Params;
}) {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const { id } = await params;
  const [store, profiles, session] = await Promise.all([
    getStoreCached(id),
    getAllProfiles({ excludePlaceholders: false }),
    getCurrentSession(),
  ]);
  if (!store) notFound();
  const dealCount = (await listDealsByStoreCached(store.id)).length;
  const apiKeyConfigured = isApiKeyConfigured();
  // Phase 8: 旧 `store.assigned_sales` (text) DROP 済。AI Panel に渡す display_name を事前解決。
  const assignedSalesName = store.assigned_sales_user_id
    ? (profiles.find((p) => p.id === store.assigned_sales_user_id)
        ?.display_name ?? "")
    : "";
  // プロンプトテンプレート一覧: id/name/is_default のみに絞ってクライアントへ渡す (Issue #42 Phase 4-D)
  const promptTemplates: PromptTemplateOption[] = session
    ? (await repos.promptTemplate.list(session.userId)).map(
        ({ id, name, is_default }) => ({ id, name, is_default }),
      )
    : [];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link
          href="/stores"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 店舗一覧
        </Link>
        <StoreTitleSection store={store} />
      </div>

      <StoreDetailTabs
        store={store}
        profiles={profiles}
        isApiKeyConfigured={apiKeyConfigured}
        assignedSalesName={assignedSalesName}
        dealCount={dealCount}
        promptTemplates={promptTemplates}
        deepResearchSlot={
          <Suspense fallback={<DeepResearchFallback />}>
            <DeepResearchSection storeId={store.id} />
          </Suspense>
        }
      />
    </div>
  );
}
