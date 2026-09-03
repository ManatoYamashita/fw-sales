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

/** エリア表示。cell と title で同じ文字列を使うため 1 箇所に集約する。 */
function formatArea(s: Store): string {
  return [s.prefecture, s.city].filter(Boolean).join(" / ");
}

/**
 * 最近登録した店舗テーブルの列定義 (#224)。
 *
 * ## 閾値の考え方
 * always = 店舗名 200 + 状態 96 = 296px。以降を優先度順に積む
 * (406 = +チャネル110 / 516 = +更新110 / 652 = +エリア136 / 792 = +業態140)。
 * このテーブルは `dashboard/page.tsx` の `lg:grid-cols-3` の `col-span-2` に置かれ、
 * コンテナ幅は 1920px viewport でも約 985px にしかならないため、/stores の
 * 閾値 (728〜1492) をそのまま使うと段階表示が機能しない。専用の帯を新設している。
 *
 * `stage` を always にするのは、「最近何が入ってきたか」と並んで「どこまで進んで
 * いるか」がこのウィジェットの用途そのものであり、かつ 96px と最も安いため。
 * 3 列目 (110px) まで always にすると 406px となり、375px viewport のコンテナ
 * (341px) で横スクロールが復活する。
 *
 * ## 自由入力列には必ず maxWidth を置く
 * 店舗名 / エリア / 業態は min-content が青天井なので、cap が無いと上の予算計算が
 * そのまま崩れる。エリアの 136px は実測ではなく、コンテナ平地 654px に載せるための
 * 意図的な cap (詳細は data-table-responsive.ts のドックコメント)。
 *
 * `export` しているのは `__tests__/recent-stores-table-columns.test.tsx` から
 * 配分表を固定するため。引数を取らないので `buildColumns` のような関数にはしない。
 */
export const RECENT_STORES_COLUMNS: ColumnDef<Store>[] = [
  {
    key: "name",
    header: "店舗名",
    truncate: true,
    maxWidth: "200px",
    title: (s) => s.name,
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
    minContainerWidth: 652,
    truncate: true,
    maxWidth: "136px",
    title: (s) => formatArea(s) || undefined,
    cell: (s) => (
      <span className="text-foreground/80">{formatArea(s) || "—"}</span>
    ),
  },
  {
    key: "genre",
    header: "業態",
    minContainerWidth: 792,
    truncate: true,
    maxWidth: "140px",
    title: (s) => s.genre || undefined,
    cell: (s) => s.genre || "—",
  },
  {
    key: "stage",
    header: "状態",
    cell: (s) => <StageBadge stage={s.stage} />,
  },
  {
    key: "channel",
    header: "チャネル",
    minContainerWidth: 406,
    cell: (s) => <ChannelBadge channel={s.channel} />,
  },
  {
    key: "updated",
    header: "更新",
    minContainerWidth: 516,
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
        columns={RECENT_STORES_COLUMNS}
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
