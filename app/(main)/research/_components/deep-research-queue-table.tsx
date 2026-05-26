/**
 * Deep Research キューページのタブ別一覧テーブル (RSC)。
 *
 * `variant` に応じて列構成と empty state 文言を切り替える:
 * - in_flight: 経過時間は now - enqueued_at、 操作列なし
 * - done:     経過時間は completed_at - enqueued_at、 操作列なし
 * - failed:   経過時間は completed_at - enqueued_at、 操作列に RetryJobButton
 *
 * 担当者・店舗名は LEFT JOIN 由来で null 可。 store_name null → "(削除済み)"、
 * researcher null → "—" として表示する。
 *
 * 関連: requirements.md §1.x, §5.x; design.md §Components
 */

import Link from "next/link";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ResearchStatusBadge } from "@/components/feature/research-status-badge";
import { formatRelativeTime, formatDuration, formatElapsed, formatEstimatedRemaining } from "@/lib/utils/relative-time";
import type { DeepResearchQueueRow } from "@/types/deep-research";
import { RetryJobButton } from "./retry-job-button";
import { ResearchProgressIndicator } from "./research-progress-indicator";

export type QueueTabVariant = "in_flight" | "done" | "failed";

interface DeepResearchQueueTableProps {
  rows: readonly DeepResearchQueueRow[];
  variant: QueueTabVariant;
  averageDurationSec?: number | null;
}

const EMPTY_TITLE: Record<QueueTabVariant, string> = {
  in_flight: "実行中のジョブはありません",
  done: "完了したジョブはまだありません",
  failed: "失敗したジョブはありません",
};

const EMPTY_DESCRIPTION: Record<QueueTabVariant, string> = {
  in_flight:
    "店舗詳細ページの「AI 分析」タブから「Deep Research を実行」で投入できます。",
  done: "ジョブが完了するとここに最新 30 件が表示されます。",
  failed: "失敗したジョブはここに最新 30 件が表示されます。",
};

export function DeepResearchQueueTable({
  rows,
  variant,
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
          <span className="text-muted-foreground italic">（削除済み）</span>
        ),
    },
    {
      key: "status",
      header: "状態",
      width: "120px",
      cell: (row) => <ResearchStatusBadge status={row.job.status} />,
    },
  ];

  if (variant === "in_flight") {
    columns.push({
      key: "progress",
      header: "進捗",
      width: "180px",
      cell: (row) => <ResearchProgressIndicator status={row.job.status} />,
    });
  }

  columns.push(
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
      header: variant === "in_flight" ? "経過" : "所要",
      width: "110px",
      align: "right",
      cell: (row) =>
        variant === "in_flight"
          ? formatElapsed(row.job.enqueued_at)
          : formatDuration(row.job.enqueued_at, row.job.completed_at),
    },
  );

  if (variant === "in_flight") {
    columns.push(
      {
        key: "estimate",
        header: "推定残り",
        width: "140px",
        cell: (row) => (
          <span className="text-muted-foreground text-xs">
            {formatEstimatedRemaining(
              row.job.research_started_at,
              averageDurationSec,
            )}
          </span>
        ),
      },
      {
        key: "last_update",
        header: "最終更新",
        width: "100px",
        cell: (row) => (
          <span className="text-muted-foreground text-xs">
            {formatRelativeTime(row.job.api_updated_at)}
          </span>
        ),
      },
    );
  }

  if (variant === "failed") {
    columns.push(
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
          const last = row.job.error_log?.[row.job.error_log.length - 1];
          if (!last) return "—";
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
        width: "120px",
        preventRowClick: true,
        cell: (row) => <RetryJobButton jobId={row.job.id} />,
      },
    );
  }

  return (
    <DataTable<DeepResearchQueueRow>
      columns={columns}
      rows={[...rows]}
      rowKey={(row) => row.job.id}
      rowHref={(row) => `/research/${row.job.id}`}
      density="compact"
      emptyState={
        <EmptyState
          title={EMPTY_TITLE[variant]}
          description={EMPTY_DESCRIPTION[variant]}
        />
      }
    />
  );
}
