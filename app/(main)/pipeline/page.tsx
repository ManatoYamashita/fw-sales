import { Suspense } from "react";
import type { Metadata } from "next";
import { KanbanBoard } from "./_components/kanban-board";
import { PipelineFilters } from "./_components/pipeline-filters";
import { Spinner } from "@/components/ui/spinner";
import type { StoreFilter } from "@/types/store";
import { getAllProfiles } from "@/lib/queries/profiles";

export const metadata: Metadata = {
  title: "パイプライン",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    priority?: string;
    sales?: string;
  }>;
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const [sp, profiles] = await Promise.all([
    searchParams,
    getAllProfiles({ excludePlaceholders: false }),
  ]);
  const filter: StoreFilter = {};
  if (sp.q) filter.q = sp.q;
  // Phase 7 で `filter.sales` は profile.id を保持する仕様に切替。
  if (sp.sales) filter.sales = sp.sales;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          パイプライン
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          ステージ別に店舗を一望し、ボトルネックを早期に発見します。
        </p>
      </div>
      <PipelineFilters profiles={profiles} />
      <Suspense
        key={JSON.stringify(filter)}
        fallback={
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Spinner /> 読み込み中…
          </div>
        }
      >
        <KanbanBoard filter={filter} />
      </Suspense>
    </div>
  );
}
