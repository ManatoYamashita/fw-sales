import { Suspense } from "react";
import type { Metadata } from "next";
import { KanbanBoard } from "./_components/kanban-board";
import { PipelineFilters } from "./_components/pipeline-filters";
import { Spinner } from "@/components/ui/spinner";
import { PRIORITIES, type Priority, type StoreFilter } from "@/types/store";

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
  const sp = await searchParams;
  const filter: StoreFilter = {};
  if (sp.q) filter.q = sp.q;
  if (sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority)) {
    filter.priority = sp.priority as Priority;
  }
  // sales フィルタはクライアント側カラム表示後に絞り込む(KanbanBoardでは未対応 → 後日)

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
      <PipelineFilters />
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
