import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StageBadge } from "@/components/feature/stage-badge";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { PriorityBadge } from "@/components/feature/priority-badge";
import { IndividualStoreBadge } from "@/components/feature/individual-store-badge";
import { StarRating } from "@/components/ui/star-rating";
import { listStores } from "@/lib/queries/stores";
import { formatDate } from "@/lib/utils/date";
import type { Store, StoreFilter, StoreSort } from "@/types/store";
import { StoreRowActions } from "./store-row-actions";

const columns: ColumnDef<Store>[] = [
  {
    key: "name",
    header: "店舗名",
    cell: (s) => (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-foreground">{s.name}</span>
        <IndividualStoreBadge operatorType={s.operator_type} />
      </span>
    ),
  },
  {
    key: "location",
    header: "エリア",
    cell: (s) => (
      <span className="text-foreground/80">
        {[s.prefecture, s.city].filter(Boolean).join(" / ") || "—"}
      </span>
    ),
  },
  { key: "genre", header: "業態", cell: (s) => s.genre || "—" },
  {
    key: "review",
    header: "口コミ",
    cell: (s) =>
      s.review_count > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          <StarRating value={s.review_avg} showValue />
          <span className="text-xs text-muted-foreground">{s.review_count}件</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/70">—</span>
      ),
  },
  {
    key: "priority",
    header: "優先度",
    cell: (s) => <PriorityBadge priority={s.priority} />,
  },
  {
    key: "stage",
    header: "ステージ",
    cell: (s) => <StageBadge stage={s.stage} />,
  },
  {
    key: "channel",
    header: "チャネル",
    cell: (s) => <ChannelBadge channel={s.channel} />,
  },
  {
    key: "sales",
    header: "営業担当",
    cell: (s) => s.assigned_sales || "—",
  },
  {
    key: "updated",
    header: "更新",
    cell: (s) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {formatDate(s.updated_at)}
      </span>
    ),
  },
  {
    key: "actions",
    header: <span className="sr-only">操作</span>,
    align: "right",
    width: "92px",
    preventRowClick: true,
    cell: (s) => <StoreRowActions storeId={s.id} storeName={s.name} />,
  },
];

export async function StoresTable({
  filter,
  sort,
}: {
  filter: StoreFilter;
  sort?: StoreSort;
}) {
  const stores = await listStores(filter, sort);
  return (
    <Card>
      <Card.Header>
        <Card.Title>店舗一覧</Card.Title>
        <span className="text-sm text-muted-foreground">{stores.length} 件</span>
      </Card.Header>
      <DataTable
        columns={columns}
        rows={stores}
        rowKey={(s) => s.id}
        rowHref={(s) => `/stores/${s.id}`}
        emptyState={
          <EmptyState
            icon={<Inbox />}
            title="該当する店舗がありません"
            description="検索条件を変更するか、店舗を新しく登録してください。"
          />
        }
      />
    </Card>
  );
}
