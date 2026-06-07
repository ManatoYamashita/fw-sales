"use client";

import Link from "next/link";
import { Handshake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import type { Deal, DealStatus } from "@/types/deal";
import { DealRowActions } from "./deal-row-actions";

const statusTone: Record<
  DealStatus,
  "default" | "secondary" | "success" | "destructive"
> = {
  継続追客: "default",
  見積提出: "secondary",
  受注: "success",
  失注: "destructive",
};

function buildDealColumns(
  profileNameById: Map<string, string>,
): ColumnDef<Deal>[] {
  // Phase 8: 旧 `assigned_sales` (text) DROP 済。`assigned_sales_user_id` から
  // profile.display_name に解決し、未割当 / 解決失敗時は "—"。
  const resolveAssignedSales = (d: Deal): string =>
    d.assigned_sales_user_id
      ? (profileNameById.get(d.assigned_sales_user_id) ?? "—")
      : "—";

  return [
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
    { key: "sales", header: "担当", cell: resolveAssignedSales },
    {
      key: "actions",
      header: <span className="sr-only">操作</span>,
      align: "right",
      width: "92px",
      cell: (d) => <DealRowActions dealId={d.id} storeName={d.store_name} />,
    },
  ];
}

export interface DealsTableViewProps {
  deals: readonly Deal[];
  /**
   * `Profile.id → display_name` を tuple 配列で受け取る。
   * Server → Client の RSC 境界では `Map<>` のシリアライズ挙動に依存せず、
   * 明示的にプレーンな配列で渡す。`cell` 関数を含む column 定義は
   * `DataTable` (`"use client"`) が境界越しに受け取れないため、本 view 内で構築する。
   */
  profileEntries: ReadonlyArray<readonly [string, string]>;
}

export function DealsTableView({ deals, profileEntries }: DealsTableViewProps) {
  const profileNameById = new Map(profileEntries);
  const columns = buildDealColumns(profileNameById);

  return (
    <Card>
      <Card.Header>
        <Card.Title>商談一覧</Card.Title>
        <span className="text-sm text-muted-foreground">{deals.length} 件</span>
      </Card.Header>
      <DataTable
        columns={columns}
        rows={[...deals]}
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
  );
}
