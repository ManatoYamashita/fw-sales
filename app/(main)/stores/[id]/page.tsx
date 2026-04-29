import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Edit2, Search, Send, Handshake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { BasicInfoCard } from "./_components/basic-info-card";
import { WebAssetCard } from "./_components/web-asset-card";
import { ResearchSummaryCard } from "./_components/research-summary-card";
import { DealsHistoryCard } from "./_components/deals-history-card";
import { StageChangeButton } from "./_components/stage-change-button";
import { DeleteStoreButton } from "./_components/delete-store-button";
import { getStoreCached } from "@/lib/queries/stores";

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
  const { id } = await params;
  const store = await getStoreCached(id);
  if (!store) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/stores"
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            ← 店舗一覧
          </Link>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
            {store.name}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {[store.prefecture, store.city, store.genre]
              .filter(Boolean)
              .join(" / ") || "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageChangeButton storeId={store.id} current={store.stage} />
          <Link
            href={`/research/${store.id}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <Search className="h-4 w-4" /> 調査
          </Link>
          <Link
            href={`/actions/${store.id}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <Send className="h-4 w-4" /> アクション
          </Link>
          <Link
            href={`/deals/new?store=${store.id}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <Handshake className="h-4 w-4" /> 商談を作成
          </Link>
          <Link
            href={`/stores/${store.id}/edit`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm bg-slate-900 text-white hover:bg-slate-800"
          >
            <Edit2 className="h-4 w-4" /> 編集
          </Link>
          <DeleteStoreButton storeId={store.id} storeName={store.name} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <BasicInfoCard store={store} />
          <Suspense fallback={<SectionFallback label="調査" />}>
            <ResearchSummaryCard storeId={store.id} />
          </Suspense>
          <Suspense fallback={<SectionFallback label="商談履歴" />}>
            <DealsHistoryCard storeId={store.id} />
          </Suspense>
        </div>

        <div className="space-y-4">
          <WebAssetCard store={store} />
          {store.memo ? (
            <Card>
              <Card.Header>
                <Card.Title>メモ</Card.Title>
              </Card.Header>
              <Card.Body>
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-6">
                  {store.memo}
                </p>
              </Card.Body>
            </Card>
          ) : null}
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
      <Card.Body className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner /> 読み込み中…
      </Card.Body>
    </Card>
  );
}
