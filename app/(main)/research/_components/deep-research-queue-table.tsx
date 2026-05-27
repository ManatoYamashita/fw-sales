import Link from "next/link";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ResearchStatusBadge } from "@/components/feature/research-status-badge";
import {
  formatRelativeTime,
  formatDuration,
  formatElapsed,
  formatEstimatedRemaining,
} from "@/lib/utils/relative-time";
import { isPendingStatus } from "@/types/deep-research";
import type { DeepResearchQueueRow } from "@/types/deep-research";
import { RetryJobButton } from "./retry-job-button";
import { ResearchProgressIndicator } from "./research-progress-indicator";

interface DeepResearchQueueTableProps {
  rows: readonly DeepResearchQueueRow[];
  averageDurationSec?: number | null;
}

export function DeepResearchQueueTable({
  rows,
  averageDurationSec,
}: DeepResearchQueueTableProps) {
  const columns: ColumnDef<DeepResearchQueueRow>[] = [
    {
      key: "store",
      header: "店舗名",
      cell: (row) =>
        row.store_name ? (
          <Link
            href={`/stores/${row.job.store_id}`}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.store_name}
          </Link>
        ) : (
          <span className="text-muted-foreground italic">(削除済み)</span>
        ),
    },
    {
      key: "status",
      header: "状態",
      width: "120px",
      cell: (row) => <ResearchStatusBadge status={row.job.status} />,
    },
    {
      key: "progress",
      header: "進捗",
      width: "180px",
      cell: (row) =>
        isPendingStatus(row.job.status) ? (
          <ResearchProgressIndicator status={row.job.status} />
        ) : null,
    },
    {
      key: "researcher",
      header: "担当者",
      width: "140px",
      cell: (row) => row.researcher_display_name ?? "—",
    },
    {
      key: "enqueued_at",
      header: "投入時刻",
      width: "120px",
      cell: (row) => (
        <span title={new Date(row.job.enqueued_at).toLocaleString("ja-JP")}>
          {formatRelativeTime(row.job.enqueued_at)}
        </span>
      ),
    },
    {
      key: "duration",
      header: "経過/所要",
      width: "110px",
      align: "right",
      cell: (row) =>
        isPendingStatus(row.job.status)
          ? formatElapsed(row.job.enqueued_at)
          : formatDuration(row.job.enqueued_at, row.job.completed_at),
    },
    {
      key: "estimate",
      header: "推定残り",
      width: "120px",
      cell: (row) =>
        isPendingStatus(row.job.status) ? (
          <span className="text-muted-foreground text-xs">
            {formatEstimatedRemaining(
              row.job.research_started_at,
              averageDurationSec,
            )}
          </span>
        ) : null,
    },
    {
      key: "error",
      header: "エラー",
      truncate: true,
      maxWidth: "220px",
      title: (row) => {
        const last = row.job.error_log?.[row.job.error_log.length - 1];
        return last ? `${last.kind}: ${last.message}` : undefined;
      },
      cell: (row) => {
        if (row.job.status !== "failed") return null;
        const last = row.job.error_log?.[row.job.error_log.length - 1];
        if (!last) return null;
        return (
          <span className="text-destructive text-xs">
            {last.kind}: {last.message}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "操作",
      width: "100px",
      preventRowClick: true,
      cell: (row) =>
        row.job.status === "failed" ? (
          <RetryJobButton jobId={row.job.id} />
        ) : null,
    },
  ];

  return (
    <DataTable<DeepResearchQueueRow>
      columns={columns}
      rows={[...rows]}
      rowKey={(row) => row.job.id}
      rowHref={(row) => `/research/jobs/${row.job.id}`}
      density="compact"
      emptyState={
        <EmptyState
          title="ジョブがありません"
          description="店舗詳細ページの「AI 分析」タブから「Deep Research を実行」で投入できます。"
        />
      }
    />
  );
}
