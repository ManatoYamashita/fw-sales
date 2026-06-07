"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StageBadge } from "@/components/feature/stage-badge";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { formatDate } from "@/lib/utils/date";
import type { Store } from "@/types/store";

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
    key: "stage",
    header: "状態",
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
      <span className="text-xs text-muted-foreground">
        {formatDate(s.updated_at)}
      </span>
    ),
  },
];

export interface RecentStoresTableViewProps {
  rows: readonly Store[];
}

/**
 * 最近登録した店舗テーブルの描画 (`"use client"`)。`cell` 関数を含む column 定義は
 * `DataTable` (`"use client"`) が RSC 境界越しに受け取れないため、
 * データ取得 (Server: `RecentStoresTable`) と描画 (本 view) を分離する。
 */
export function RecentStoresTableView({ rows }: RecentStoresTableViewProps) {
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
        rows={[...rows]}
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
