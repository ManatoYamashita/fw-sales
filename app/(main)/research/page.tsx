import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  listAllDeepResearchJobs,
  getAverageResearchDuration,
} from "@/lib/queries/deep-research";
import { isPendingStatus } from "@/types/deep-research";
import type { DeepResearchQueueRow } from "@/types/deep-research";
import { DeepResearchQueueTable } from "./_components/deep-research-queue-table";
import { ResearchFilterChips, type StatusFilter } from "./_components/research-filter-chips";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = {
  title: "調査キュー",
};

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

function filterRows(
  rows: DeepResearchQueueRow[],
  status: StatusFilter,
): DeepResearchQueueRow[] {
  if (status === "all") return rows;
  if (status === "pending") return rows.filter((r) => isPendingStatus(r.job.status));
  if (status === "done") return rows.filter((r) => r.job.status === "done");
  if (status === "failed") return rows.filter((r) => r.job.status === "failed");
  return rows;
}

function parseStatus(raw?: string): StatusFilter {
  if (raw === "pending" || raw === "done" || raw === "failed") return raw;
  return "all";
}

export default async function ResearchPage({ searchParams }: PageProps) {
  await connection();
  const sp = await searchParams;
  const status = parseStatus(sp.status);

  const [allJobs, avgDuration] = await Promise.all([
    listAllDeepResearchJobs(),
    getAverageResearchDuration(),
  ]);

  const pendingCount = allJobs.filter((r) => isPendingStatus(r.job.status)).length;
  const doneCount = allJobs.filter((r) => r.job.status === "done").length;
  const failedCount = allJobs.filter((r) => r.job.status === "failed").length;

  const filtered = filterRows(allJobs, status);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          調査キュー
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Deep Research ジョブの進行状況。
        </p>
      </div>

      <Suspense fallback={<Spinner />}>
        <ResearchFilterChips
          totalCount={allJobs.length}
          pendingCount={pendingCount}
          doneCount={doneCount}
          failedCount={failedCount}
        />
      </Suspense>

      <DeepResearchQueueTable
        rows={filtered}
        averageDurationSec={avgDuration}
      />
    </div>
  );
}
