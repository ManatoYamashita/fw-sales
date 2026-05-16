import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Edit2, Search, Send, Handshake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { StoreTitleSection } from "./_components/store-title-section";
import { MapEmbedCard } from "./_components/map-embed-card";
import { BasicInfoCard } from "./_components/basic-info-card";
import { WebAssetCard } from "./_components/web-asset-card";
import { AiAnalysisDetailSection } from "./_components/ai-analysis-detail-section";
import { ResearchSummaryCard } from "./_components/research-summary-card";
import { DealsHistoryCard } from "./_components/deals-history-card";
import { MemoCard } from "./_components/memo-card";
import { StageChangeButton } from "./_components/stage-change-button";
import { DeleteStoreButton } from "./_components/delete-store-button";
import { getStoreCached } from "@/lib/queries/stores";
import { listDealsByStoreCached } from "@/lib/queries/deals";
import { isApiKeyConfigured } from "@/lib/env";

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
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const { id } = await params;
  const store = await getStoreCached(id);
  if (!store) notFound();
  const dealCount = (await listDealsByStoreCached(store.id)).length;
  const apiKeyConfigured = isApiKeyConfigured();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <Link
            href="/stores"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← 店舗一覧
          </Link>
          <StoreTitleSection store={store} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageChangeButton storeId={store.id} current={store.stage} />
          <Link
            href={`/research/${store.id}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm border border-border bg-card hover:bg-muted/40 text-foreground"
          >
            <Search className="h-4 w-4" /> 調査
          </Link>
          <Link
            href={`/actions/${store.id}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm border border-border bg-card hover:bg-muted/40 text-foreground"
          >
            <Send className="h-4 w-4" /> アクション
          </Link>
          <Link
            href={`/deals/new?store=${store.id}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm border border-border bg-card hover:bg-muted/40 text-foreground"
          >
            <Handshake className="h-4 w-4" /> 商談を作成
          </Link>
          <Link
            href={`/stores/${store.id}/edit`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm border border-border bg-card hover:bg-muted/40 text-foreground"
            title="フル編集 + AI 再実行ページ"
          >
            <Edit2 className="h-4 w-4" /> フル編集
          </Link>
          <DeleteStoreButton
            storeId={store.id}
            storeName={store.name}
            dealCount={dealCount}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <MapEmbedCard store={store} />
          <BasicInfoCard store={store} />
          <AiAnalysisDetailSection
            store={store}
            isApiKeyConfigured={apiKeyConfigured}
          />
          <Suspense fallback={<SectionFallback label="調査" />}>
            <ResearchSummaryCard storeId={store.id} />
          </Suspense>
          <Suspense fallback={<SectionFallback label="商談履歴" />}>
            <DealsHistoryCard storeId={store.id} />
          </Suspense>
        </div>

        <div className="space-y-4">
          <WebAssetCard store={store} />
          <MemoCard store={store} />
        </div>
      </div>
    </div>
  );
}

function SectionFallback({ label }: { label: string }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>{label}</Card.Title>
      </Card.Header>
      <Card.Body className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> 読み込み中…
      </Card.Body>
    </Card>
  );
}
