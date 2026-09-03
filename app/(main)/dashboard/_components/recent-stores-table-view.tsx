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

/**
 * 「最近登録した店舗」の列定義 (#224 / #220 の横展開)。
 *
 * `minContainerWidth` は「その列を出すのに要るコンテナ幅 (px)」で、列単体の
 * 実測幅を優先度順に累計して決めている。このカードは `dashboard/page.tsx` の
 * `lg:grid-cols-3` 内の `lg:col-span-2` に置かれるため、コンテナ幅は
 * 341〜1134px と `/stores` (286〜1710px) より狭い帯にある。always 列を 2 列
 * (計 296px) に絞ることで 375px (コンテナ 341px) でも横スクロールを出さない。
 *
 * 落とす順は「このカードでの意思決定に効かない列から」。店舗名は唯一の遷移
 * 導線、状態は「登録したが着手していないか」というこのカード唯一の actionable
 * な情報なので always に置く。エリアは同名チェーンの判別、チャネルは次の
 * 打ち手の示唆、更新は「最近登録した」という文脈で半ば自明、業態は display-only。
 *
 * この順は `/stores` (#220: 状態 < 最寄駅 < チャネル < 最終営業日 < 業態) と
 * 整合させている。共通列の落ちる順が 2 画面で一致していないと、ユーザーの
 * メンタルモデルが画面ごとに割れるため。
 *
 * テストから配分表を固定するため export している。引数を取らないので module
 * scope で 1 度だけ評価する (`/stores` の `buildColumns(canDelete)` は引数に
 * 依存するためレンダごとに呼ぶが、こちらは props 非依存)。
 */
export function buildColumns(): ColumnDef<Store>[] {
  return [
    {
      key: "name",
      header: "店舗名",
      // 自由入力なので上限が無いと min-content が青天井になり、以降の列の閾値が
      // まとめてずれる。`/stores` と同じ 260px だと状態と合わせて 356px となり
      // 375px のコンテナ (341px) に収まらないため 200px まで締める。
      // これ以上は縮めない: このテーブルは rowHref を持たず、行内で唯一クリック
      // できるのがこのリンクなので、cap がそのままクリック領域の幅になる。
      // 予算 200px (cap)。
      truncate: true,
      maxWidth: "200px",
      title: (s) => s.name || undefined,
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
      // 都道府県 / 市区町村ともに自由入力 (text 列で長さ制約なし)。予算 160px (cap)。
      truncate: true,
      maxWidth: "160px",
      minContainerWidth: 456,
      title: (s) => [s.prefecture, s.city].filter(Boolean).join(" / ") || undefined,
      cell: (s) => (
        <span className="text-foreground/80">
          {[s.prefecture, s.city].filter(Boolean).join(" / ") || "—"}
        </span>
      ),
    },
    {
      key: "genre",
      header: "業態",
      // 自由入力。display-only で意思決定に寄与しないため最初に落とす。
      // 予算 140px (cap)。
      truncate: true,
      maxWidth: "140px",
      minContainerWidth: 813,
      title: (s) => s.genre || undefined,
      cell: (s) => s.genre || "—",
    },
    {
      key: "stage",
      header: "状態",
      // 閉じた enum (未調査 / 調査済み / 架電済み) を whitespace-nowrap のバッジで
      // 描くため幅が確定する。予算 96px。always 列の中で最も安い。
      cell: (s) => <StageBadge stage={s.stage} />,
    },
    {
      key: "channel",
      header: "チャネル",
      // 閉じた enum。予算 122px = 最長の「テレアポ推奨」+ アイコン + padding の実測値。
      // #220 の実測 110px は当時のデータ (DM推奨) の値であり、最大値ではない。
      minContainerWidth: 578,
      cell: (s) => <ChannelBadge channel={s.channel} />,
    },
    {
      key: "updated",
      header: "更新",
      // formatDate は YYYY/MM/DD 固定長。text-xs なので /handoffs の期日
      // (text-sm, 108px) より狭い。予算 95px。
      minContainerWidth: 673,
      cell: (s) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(s.updated_at)}
        </span>
      ),
    },
  ];
}

const columns = buildColumns();

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
