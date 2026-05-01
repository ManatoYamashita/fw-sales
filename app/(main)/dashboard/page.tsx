import { Suspense } from "react";
import type { Metadata } from "next";
import {
  StatGrid,
  StatGridSkeleton,
} from "./_components/stat-grid";
import {
  RecentStoresTable,
  RecentStoresTableSkeleton,
} from "./_components/recent-stores-table";
import {
  ActionQueue,
  ActionQueueSkeleton,
} from "./_components/action-queue";
import {
  PipelineSummary,
  PipelineSummarySkeleton,
} from "./_components/pipeline-summary";

export const metadata: Metadata = {
  title: "ダッシュボード",
};

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          ダッシュボード
        </h2>
      </div>

      <Suspense fallback={<StatGridSkeleton />}>
        <StatGrid />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Suspense fallback={<RecentStoresTableSkeleton />}>
            <RecentStoresTable />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<PipelineSummarySkeleton />}>
            <PipelineSummary />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<ActionQueueSkeleton />}>
        <ActionQueue />
      </Suspense>
    </div>
  );
}
