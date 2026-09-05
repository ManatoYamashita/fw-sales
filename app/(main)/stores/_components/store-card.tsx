"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/feature/stage-badge";
import { SalesStateBadge } from "@/components/feature/sales-state-badge";
import { IndividualStoreBadge } from "@/components/feature/individual-store-badge";
import { formatDate } from "@/lib/utils/date";
import {
  NEXT_ACTION_URGENCY_LABELS,
  type NextActionUrgency,
  type SalesProgressRow,
} from "@/lib/domain/sales-progress";
import { StoreRowActions } from "./store-row-actions";

export const URGENCY_TONE: Record<
  Exclude<NextActionUrgency, "unset">,
  "destructive" | "warning" | "info"
> = { overdue: "destructive", today: "warning", upcoming: "info" };

/**
 * 次回アクションの表示。表のセルとカードの両方が使う。
 *
 * 2 箇所に書くと「表では期限超過が赤いのにカードでは違う」といった食い違いが
 * 静かに生まれるため 1 箇所に集約する。
 */
export function renderNextAction(r: SalesProgressRow): ReactNode {
  return (
    <div className="min-w-0 space-y-1">
      {r.urgency !== "unset" ? (
        <Badge tone={URGENCY_TONE[r.urgency]}>
          {NEXT_ACTION_URGENCY_LABELS[r.urgency]}
        </Badge>
      ) : (
        <Badge tone="outline">未設定</Badge>
      )}
      <div className="text-xs">
        {r.currentNextAction.date ? formatDate(r.currentNextAction.date) : "—"}
        {r.currentNextAction.type ? ` / ${r.currentNextAction.type}` : ""}
      </div>
      {r.currentNextAction.note ? (
        <p
          className="truncate text-xs text-muted-foreground"
          title={r.currentNextAction.note}
        >
          {r.currentNextAction.note}
        </p>
      ) : null}
    </div>
  );
}

export interface StoreCardProps {
  row: SalesProgressRow;
  /**
   * 詳細への遷移先。`stores-table-view.tsx` の `storeDetailHref` を prop で受け取る。
   *
   * 自前で組み立てると「行クリックとカードで飛び先が違う」事故が起きうるし、
   * `stores-table-view` から import すると循環参照になる。
   */
  href: string;
  /** 削除ボタンを出すか (#155: admin 限定。サーバ確定値)。 */
  canDelete: boolean;
}

/**
 * 狭幅 (コンテナ 640px 未満 / admin は 688px 未満) で `<table>` の代わりに出る
 * 店舗カード (#234 / PR3/3)。
 *
 * ## 載せる情報
 * 「コンテナ 974px 相当の列集合を縦に積んだもの」と定義する。#220 / #237 が合意した
 * 閾値順をそのまま使い、新しい優先度を発明しない。
 * 店舗名 / 次回アクション / 操作 (always) + 状態 728 + 現在の営業状態 874 +
 * 営業担当 974 の 6 項目。最寄駅 (1174) 以降は載せず、店舗名リンクから詳細へ送る。
 *
 * 現行の 375px は「選択列と店舗名しか見えない」状態なので、これは純増になる。
 *
 * ## カード全体をクリック可能にしない
 * 表の `rowHref` はマウス操作の便宜 (`DataTableRow` の JSDoc) だが、タッチでは
 * 誤タップとスクロール開始の誤検知を招く。代わりに**見出し行全体を 1 つの
 * `<Link>`** にして 44px 高の広い的を作る。
 *
 * ## 見出しを `<h4>` にする理由
 * ページ `<h2>` → `Card.Title` `<h3>` → 店舗名 `<h4>` の階層になる。
 * スクリーンリーダのローターや見出しジャンプでカード間を移動できるようになり、
 * これはモバイルでの主要なナビゲーション手段。
 *
 * ## 一覧の件数について
 * カードは 1 枚あたり約 140px あり、24 件で 3,400px を超える。クイックフィルタ
 * (#217) で先に絞ってから使う前提の設計。
 */
export function StoreCard({ row, href, canDelete }: StoreCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xs">
      {/* 見出し行ごとリンクにして 44px の的を作る。min-w-0 が無いと truncate が
          効かず 375px で横溢れする (本カードで最も起きやすい事故)。 */}
      <Link
        href={href}
        className="-m-1 flex min-h-11 items-center gap-2 rounded-md p-1 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h4 className="min-w-0 flex-1 truncate font-semibold text-foreground">
          {row.store.name}
        </h4>
        <span className="shrink-0">
          <IndividualStoreBadge operatorType={row.store.operator_type} />
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StageBadge stage={row.store.stage} />
        <SalesStateBadge state={row.currentSalesState} />
      </div>

      <div className="mt-2 rounded-md bg-muted/40 p-2">
        {renderNextAction(row)}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          担当: {row.salesName ?? "—"}
        </span>
        <StoreRowActions
          storeId={row.store.id}
          storeName={row.store.name}
          canDelete={canDelete}
          size="touch"
        />
      </div>
    </div>
  );
}
