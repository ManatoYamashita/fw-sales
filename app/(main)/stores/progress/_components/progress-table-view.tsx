"use client";

import Link from "next/link";
import { CalendarClock, Plus, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { DealStatusBadge } from "@/components/feature/deal-status-badge";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import {
  NEXT_ACTION_URGENCY_LABELS,
  type NextActionUrgency,
  type SalesProgressRow,
} from "@/lib/domain/sales-progress";

const URGENCY_TONE: Record<
  Exclude<NextActionUrgency, "unset">,
  "destructive" | "warning" | "info"
> = {
  overdue: "destructive",
  today: "warning",
  upcoming: "info",
};

function NextActionCell({ row }: { row: SalesProgressRow }) {
  const { next_action_date, next_action_note } = row.store;
  if (!next_action_date && !next_action_note) {
    return <span className="text-xs text-muted-foreground/70">—</span>;
  }
  return (
    <div className="min-w-0 space-y-0.5">
      {next_action_date ? (
        <span className="inline-flex items-center gap-1.5">
          {row.urgency !== "unset" ? (
            <Badge tone={URGENCY_TONE[row.urgency]}>
              {NEXT_ACTION_URGENCY_LABELS[row.urgency]}
            </Badge>
          ) : null}
          <span
            className={cn(
              "text-sm tabular-nums",
              row.urgency === "overdue"
                ? "font-semibold text-destructive"
                : "text-foreground/90",
            )}
          >
            {formatDate(next_action_date)}
          </span>
        </span>
      ) : null}
      {next_action_note ? (
        <p
          className="text-xs text-muted-foreground truncate max-w-[240px]"
          title={next_action_note}
        >
          {next_action_note}
        </p>
      ) : null}
    </div>
  );
}

function buildColumns(): ColumnDef<SalesProgressRow>[] {
  return [
    {
      key: "name",
      header: "店舗名",
      sortKey: "name",
      sortDefaultDir: "asc",
      truncate: true,
      maxWidth: "220px",
      title: (r) => r.store.name,
      cell: (r) => (
        <span className="font-semibold text-foreground truncate">
          {r.store.name}
        </span>
      ),
    },
    {
      key: "sales",
      header: "営業担当",
      truncate: true,
      maxWidth: "140px",
      title: (r) => r.salesName ?? undefined,
      cell: (r) =>
        r.salesName ?? <span className="text-muted-foreground/70">—</span>,
    },
    {
      key: "appt",
      header: "アポ",
      sortKey: "appt",
      sortDefaultDir: "desc",
      cell: (r) =>
        r.appointmentAcquired ? (
          <span className="inline-flex items-center gap-1.5">
            <Badge tone="success">取得済み</Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDate(r.store.appointment_acquired_date)}
            </span>
          </span>
        ) : (
          <Badge tone="outline">未取得</Badge>
        ),
    },
    {
      key: "deal",
      header: "商談状況",
      preventRowClick: true,
      cell: (r) =>
        r.latestDeal ? (
          <Link
            href={`/deals/${r.latestDeal.id}`}
            aria-label={`${r.store.name} の最新商談を開く`}
            className="inline-flex rounded-full hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <DealStatusBadge status={r.latestDeal.status} />
          </Link>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-muted-foreground/70">商談なし</span>
            <Link
              href={`/deals/new?store=${r.store.id}`}
              aria-label={`${r.store.name} の商談を登録`}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <Plus className="h-3 w-3" />
              商談を登録
            </Link>
          </span>
        ),
    },
    {
      key: "next",
      header: "次回アクション",
      sortKey: "next",
      sortDefaultDir: "asc",
      cell: (r) => <NextActionCell row={r} />,
    },
    {
      key: "meeting",
      header: "最終商談日",
      sortKey: "meeting",
      sortDefaultDir: "desc",
      cell: (r) =>
        r.latestMeetingDate ? (
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {formatDate(r.latestMeetingDate)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        ),
    },
  ];
}

export function ProgressTableView({
  rows,
}: {
  rows: readonly SalesProgressRow[];
}) {
  const columns = buildColumns();
  const overdueCount = rows.filter((r) => r.urgency === "overdue").length;

  return (
    <Card>
      <Card.Header>
        <Card.Title>顧客・営業進捗</Card.Title>
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          {overdueCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-destructive font-medium">
              <CalendarClock className="h-3.5 w-3.5" />
              期限超過 {overdueCount} 件
            </span>
          ) : null}
          {rows.length} 件
        </span>
      </Card.Header>
      <DataTable
        columns={columns}
        rows={[...rows]}
        rowKey={(r) => r.store.id}
        rowHref={(r) => `/stores/${r.store.id}`}
        emptyState={
          <EmptyState
            icon={<Users />}
            title="該当する顧客がありません"
            description="検索条件を変更するか、店舗を新しく登録してください。"
          />
        }
      />
    </Card>
  );
}
