"use client";

import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import type { Handoff, HandoffStatus } from "@/types/handoff";

const statusTone: Record<HandoffStatus, "amber" | "green"> = {
  運用確認待ち: "amber",
  完了: "green",
};

const columns: ColumnDef<Handoff>[] = [
  {
    key: "store",
    header: "店舗",
    cell: (h) => (
      <Link
        href={`/handoffs/${h.id}`}
        className="font-semibold text-foreground hover:text-blue-700"
      >
        {h.store_name}
      </Link>
    ),
  },
  {
    key: "fee",
    header: "初期/月額",
    align: "right",
    cell: (h) => (
      <span className="tabular-nums">
        {formatYen(h.initial_fee)}
        <span className="text-muted-foreground/70"> / </span>
        {formatYen(h.monthly_fee)}
      </span>
    ),
  },
  {
    key: "ops",
    header: "運用担当",
    cell: (h) => h.ops_assignee || "—",
  },
  {
    key: "due",
    header: "期日",
    cell: (h) => formatDate(h.due_date),
  },
  {
    key: "status",
    header: "状態",
    cell: (h) => <Badge tone={statusTone[h.status]}>{h.status}</Badge>,
  },
];

export interface HandoffsTableViewProps {
  handoffs: readonly Handoff[];
}

/**
 * 引き継ぎ一覧の描画 (`"use client"`)。`cell` 関数を含む column 定義は
 * `DataTable` (`"use client"`) が RSC 境界越しに受け取れないため、
 * データ取得 (Server) と描画 (本 view) を分離する。
 */
export function HandoffsTableView({ handoffs }: HandoffsTableViewProps) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>引き継ぎ一覧</Card.Title>
        <span className="text-sm text-muted-foreground">
          {handoffs.length} 件
        </span>
      </Card.Header>
      <DataTable
        columns={columns}
        rows={[...handoffs]}
        rowKey={(h) => h.id}
        emptyState={
          <EmptyState
            icon={<ArrowLeftRight />}
            title="引き継ぎはまだありません"
            description="受注済みの商談から引き継ぎシートを作成してください。"
          />
        }
      />
    </Card>
  );
}
