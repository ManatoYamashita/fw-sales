import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listDealsCached } from "@/lib/queries/deals";
import { listStores } from "@/lib/queries/stores";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import type { Deal, DealStatus } from "@/types/deal";
import { Handshake } from "lucide-react";
import {
  DealCreateButton,
  type DealCreateStoreOption,
} from "./_components/deal-create-button";
import { DealRowActions } from "./_components/deal-row-actions";

export const metadata: Metadata = {
  title: "商談管理",
};

const statusTone: Record<
  DealStatus,
  "default" | "secondary" | "success" | "destructive"
> = {
  継続追客: "default",
  見積提出: "secondary",
  受注: "success",
  失注: "destructive",
};

const columns: ColumnDef<Deal>[] = [
  {
    key: "store",
    header: "店舗",
    cell: (d) => (
      <Link
        href={`/deals/${d.id}`}
        className="font-semibold text-foreground hover:text-blue-700"
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
        <span className="text-success font-semibold">
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
  {
    key: "actions",
    header: <span className="sr-only">操作</span>,
    align: "right",
    width: "92px",
    cell: (d) => (
      <DealRowActions dealId={d.id} storeName={d.store_name} />
    ),
  },
];

export default async function DealsPage() {
  const [deals, stores] = await Promise.all([
    listDealsCached(),
    listStores({}),
  ]);

  const storeOptions: DealCreateStoreOption[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    prefecture: s.prefecture,
    city: s.city,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          商談管理
        </h2>
        <DealCreateButton stores={storeOptions} />
      </div>
      <Card>
        <Card.Header>
          <Card.Title>商談一覧</Card.Title>
          <span className="text-sm text-muted-foreground">{deals.length} 件</span>
        </Card.Header>
        <DataTable
          columns={columns}
          rows={deals}
          rowKey={(d) => d.id}
          emptyState={
            <EmptyState
              icon={<Handshake />}
              title="商談はまだありません"
              description="右上の「新規作成」ボタンから店舗を選んで商談を追加してください。"
            />
          }
        />
      </Card>
    </div>
  );
}
