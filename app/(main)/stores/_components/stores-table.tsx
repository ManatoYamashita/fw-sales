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
import { getAllProfiles } from "@/lib/queries/profiles";
import { formatDate } from "@/lib/utils/date";
import type { Store, StoreFilter, StoreSort } from "@/types/store";
import type { Profile } from "@/types/profile";
import { StoreRowActions } from "./store-row-actions";

function buildColumns(profileMap: Map<string, string>): ColumnDef<Store>[] {
  // Phase 7 で `assigned_sales` (text) → `assigned_sales_user_id` (uuid) に切替済。
  // 表示は profileMap で id → display_name に解決し、未割当 / 解決失敗は "—"。
  const resolveAssignedSales = (s: Store): string =>
    s.assigned_sales_user_id
      ? (profileMap.get(s.assigned_sales_user_id) ?? "—")
      : "—";

  return [
  {
    key: "name",
    header: "店舗名",
    truncate: true,
    maxWidth: "260px",
    title: (s) => s.name,
    cell: (s) => (
      <span className="inline-flex items-center gap-2 min-w-0 max-w-full align-middle">
        <span className="font-semibold text-foreground truncate">{s.name}</span>
        <span className="flex-shrink-0">
          <IndividualStoreBadge operatorType={s.operator_type} />
        </span>
      </span>
    ),
  },
  {
    key: "location",
    header: "エリア",
    truncate: true,
    maxWidth: "200px",
    title: (s) => [s.prefecture, s.city].filter(Boolean).join(" / ") || undefined,
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
    truncate: true,
    maxWidth: "140px",
    title: (s) => {
      const name = resolveAssignedSales(s);
      return name === "—" ? undefined : name;
    },
    cell: (s) => resolveAssignedSales(s),
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
}

function toProfileMap(profiles: readonly Profile[]): Map<string, string> {
  return new Map(profiles.map((p) => [p.id, p.display_name]));
}

export async function StoresTable({
  filter,
  sort,
}: {
  filter: StoreFilter;
  sort?: StoreSort;
}) {
  const [stores, profiles] = await Promise.all([
    listStores(filter, sort),
    getAllProfiles({ excludePlaceholders: false }),
  ]);
  const columns = buildColumns(toProfileMap(profiles));
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
