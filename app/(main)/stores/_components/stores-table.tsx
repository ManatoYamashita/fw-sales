import Link from "next/link";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StageBadge } from "@/components/feature/stage-badge";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { PriorityBadge } from "@/components/feature/priority-badge";
import { StarRating } from "@/components/ui/star-rating";
import { listStores } from "@/lib/queries/stores";
import { formatDate } from "@/lib/utils/date";
import type { Store, StoreFilter } from "@/types/store";

const columns: ColumnDef<Store>[] = [
  {
    key: "name",
    header: "店舗名",
    cell: (s) => (
      <Link
        href={`/stores/${s.id}`}
        className="font-semibold text-foreground hover:text-blue-700"
      >
        {s.name}
      </Link>
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
];

export async function StoresTable({ filter }: { filter: StoreFilter }) {
  const stores = await listStores(filter);
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
