import Link from "next/link";
import { cacheTag } from "next/cache";
import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StageBadge } from "@/components/feature/stage-badge";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { PriorityBadge } from "@/components/feature/priority-badge";
import { repos } from "@/lib/repositories";
import { formatDate } from "@/lib/utils/date";
import { CACHE_TAGS } from "@/lib/cache";
import type { Store } from "@/types/store";
import { Inbox } from "lucide-react";

async function loadRecentStores(): Promise<Store[]> {
  "use cache";
  cacheTag(CACHE_TAGS.stores);
  const all = await repos.store.list();
  return all.slice(0, 5);
}

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
    key: "updated",
    header: "更新",
    cell: (s) => (
      <span className="text-xs text-muted-foreground">{formatDate(s.updated_at)}</span>
    ),
  },
];

export async function RecentStoresTable() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const rows = await loadRecentStores();
  return (
    <Card>
      <Card.Header>
        <Card.Title>最近登録した店舗</Card.Title>
        <Link
          href="/stores"
          className="text-sm font-medium text-blue-700 hover:text-blue-800"
        >
          すべて見る →
        </Link>
      </Card.Header>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        emptyState={
          <EmptyState
            icon={<Inbox />}
            title="店舗がまだ登録されていません"
            description="右上の「店舗登録」から最初の店舗を追加してください。"
          />
        }
      />
    </Card>
  );
}

export function RecentStoresTableSkeleton() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>最近登録した店舗</Card.Title>
      </Card.Header>
      <Card.Body>
        <div className="h-40 bg-muted rounded animate-pulse" />
      </Card.Body>
    </Card>
  );
}
