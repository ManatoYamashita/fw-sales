"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { useDataTableRowNavigating } from "@/components/ui/data-table-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { ResearchStatusBadge } from "@/components/feature/research-status-badge";
import {
  formatRelativeTime,
  formatDuration,
  formatElapsed,
  formatEstimatedRemaining,
} from "@/lib/utils/relative-time";
import { isPendingStatus } from "@/types/deep-research";
import type { DeepResearchQueueRow } from "@/types/deep-research";
import {
  softDeleteDeepResearchJobAction,
  softDeleteDeepResearchJobsAction,
} from "@/lib/actions/deep-research-actions";
import { RetryJobButton } from "./retry-job-button";
import { ResearchProgressIndicator } from "./research-progress-indicator";
import { cn } from "@/lib/utils/cn";

interface DeepResearchQueueTableProps {
  rows: readonly DeepResearchQueueRow[];
  averageDurationSec?: number | null;
}

function StoreNameCell({ row }: { row: DeepResearchQueueRow }) {
  const isNavigating = useDataTableRowNavigating();
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span
        className={cn(
          "font-medium truncate",
          row.store_name ? "text-foreground" : "text-muted-foreground italic",
        )}
      >
        {row.store_name ?? "(削除済み)"}
      </span>
      {isNavigating ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <Spinner className="h-3.5 w-3.5 text-primary" />
          読み込み中…
        </span>
      ) : null}
    </span>
  );
}

export function DeepResearchQueueTable({
  rows,
  averageDurationSec,
}: DeepResearchQueueTableProps) {
  const router = useRouter();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [singleDeleteTarget, setSingleDeleteTarget] = useState<{
    jobId: string;
    label: string;
  } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isDeletingSingle, startDeleteSingle] = useTransition();
  const [isDeletingBulk, startDeleteBulk] = useTransition();
  const visibleJobIdSet = new Set(rows.map((row) => row.job.id));
  const selectedVisibleJobIds = selectedJobIds.filter((id) =>
    visibleJobIdSet.has(id),
  );

  const handleDeleteOne = (jobId: string) => {
    startDeleteSingle(async () => {
      const result = await softDeleteDeepResearchJobAction(jobId);
      if (result.ok) {
        toast.success("ジョブを削除しました");
        setSelectedJobIds((prev) => prev.filter((id) => id !== jobId));
        setSingleDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(result.error ?? "削除に失敗しました");
      }
    });
  };

  const handleDeleteSelected = () => {
    if (selectedVisibleJobIds.length === 0) return;
    startDeleteBulk(async () => {
      const result = await softDeleteDeepResearchJobsAction(selectedVisibleJobIds);
      if (!result.ok) {
        toast.error(result.error ?? "一括削除に失敗しました");
        return;
      }

      if (result.data.deletedCount === 0) {
        toast.warn("削除対象が見つかりませんでした");
      } else if (result.data.deletedCount < result.data.requestedCount) {
        toast.warn(
          `${result.data.deletedCount}/${result.data.requestedCount} 件を削除しました`,
        );
      } else {
        toast.success(`${result.data.deletedCount} 件を削除しました`);
      }
      setBulkDeleteOpen(false);
      setSelectedJobIds((prev) =>
        prev.filter((id) => !selectedVisibleJobIds.includes(id)),
      );
      router.refresh();
    });
  };

  const columns: ColumnDef<DeepResearchQueueRow>[] = [
    {
      key: "store",
      header: "店舗名",
      cell: (row) => <StoreNameCell row={row} />,
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
      width: "200px",
      preventRowClick: true,
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          {row.job.status === "failed" ? <RetryJobButton jobId={row.job.id} /> : null}
          <Button
            variant="destructive-outline"
            size="sm"
            onClick={() =>
              setSingleDeleteTarget({
                jobId: row.job.id,
                label: row.store_name ?? "削除済み店舗",
              })
            }
            disabled={isDeletingSingle || isDeletingBulk}
          >
            {isDeletingSingle ? (
              <Spinner />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            削除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <DataTable<DeepResearchQueueRow>
        columns={columns}
        rows={[...rows]}
        rowKey={(row) => row.job.id}
        rowHref={(row) => `/research/jobs/${row.job.id}`}
        density="compact"
        rowSelection={{
          selectedRowKeys: selectedVisibleJobIds,
          onChange: setSelectedJobIds,
          allRowsLabel: "表示中のジョブをすべて選択",
          rowLabel: (row) =>
            `${row.store_name ?? "削除済み店舗"} のジョブ ${row.job.id} を選択`,
        }}
        emptyState={
          <EmptyState
            title="ジョブがありません"
            description="店舗詳細ページの「AI 分析」タブから「Deep Research を実行」で投入できます。"
          />
        }
      />

      {selectedVisibleJobIds.length > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-sm text-foreground">
            {selectedVisibleJobIds.length} 件選択中
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteOpen(true)}
            disabled={isDeletingBulk || isDeletingSingle}
          >
            {isDeletingBulk ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
            削除
          </Button>
        </div>
      ) : null}

      <Modal
        open={Boolean(singleDeleteTarget)}
        onOpenChange={(open) => {
          if (!open) setSingleDeleteTarget(null);
        }}
      >
        <ModalContent title="ジョブを削除しますか?" size="sm">
          <p className="text-sm text-foreground leading-relaxed">
            「
            <strong className="font-semibold">
              {singleDeleteTarget?.label ?? "対象ジョブ"}
            </strong>
            」の Deep Research ジョブを一覧から削除します。この操作は元に戻せません。
          </p>
          <ModalFooter>
            <Button
              variant="ghost"
              onClick={() => setSingleDeleteTarget(null)}
              disabled={isDeletingSingle}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                singleDeleteTarget
                  ? handleDeleteOne(singleDeleteTarget.jobId)
                  : undefined
              }
              disabled={isDeletingSingle}
            >
              {isDeletingSingle ? "削除中…" : "削除する"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <ModalContent title="選択中のジョブを削除しますか?" size="sm">
          <p className="text-sm text-foreground leading-relaxed">
            選択中の
            <strong className="font-semibold"> {selectedVisibleJobIds.length} 件 </strong>
            の Deep Research ジョブを削除します。この操作は元に戻せません。
          </p>
          <ModalFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={isDeletingBulk}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteSelected}
              disabled={isDeletingBulk || selectedVisibleJobIds.length === 0}
            >
              {isDeletingBulk ? "削除中…" : "削除する"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
