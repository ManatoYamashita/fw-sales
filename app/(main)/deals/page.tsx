import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listDealsCached } from "@/lib/queries/deals";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import type { Deal, DealStatus } from "@/types/deal";
import { Handshake } from "lucide-react";

export const metadata: Metadata = {
  title: "商談管理",
};

const statusTone: Record<DealStatus, "neutral" | "amber" | "green" | "red"> = {
  継続追客: "neutral",
  見積提出: "amber",
  受注: "green",
  失注: "red",
};

const columns: ColumnDef<Deal>[] = [
  {
    key: "store",
    header: "店舗",
    cell: (d) => (
      <Link
        href={`/deals/${d.id}`}
        className="font-semibold text-slate-900 hover:text-blue-700"
      >
        {d.store_name}
      </Link>
    ),
  },
  { key: "date", header: "商談日", cell: (d) => formatDate(d.date) },
  { key: "type", header: "形式", cell: (d) => d.meeting_type },
  {
    key: "estimate",
    header: "見積",
    align: "right",
    cell: (d) => formatYen(d.estimate_amount),
  },
  {
    key: "order",
    header: "受注",
    align: "right",
    cell: (d) =>
      d.order_amount ? (
        <span className="text-green-700 font-semibold">
          {formatYen(d.order_amount)}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "status",
    header: "ステータス",
    cell: (d) => <Badge tone={statusTone[d.status]}>{d.status}</Badge>,
  },
  { key: "sales", header: "担当", cell: (d) => d.assigned_sales || "—" },
];

export default async function DealsPage() {
  const deals = await listDealsCached();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">商談管理</h2>
      </div>
      <Card>
        <Card.Header>
          <Card.Title>商談一覧</Card.Title>
          <span className="text-sm text-slate-500">{deals.length} 件</span>
        </Card.Header>
        <DataTable
          columns={columns}
          rows={deals}
          rowKey={(d) => d.id}
          emptyState={
            <EmptyState
              icon={<Handshake />}
              title="商談はまだありません"
              description="店舗詳細から商談を作成してください。"
            />
          }
        />
      </Card>
    </div>
  );
}
