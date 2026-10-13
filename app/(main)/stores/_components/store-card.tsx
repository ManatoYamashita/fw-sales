"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { StoreResearchStatusBadge } from "@/components/feature/stage-badge";
import { SalesStateSummary } from "@/components/feature/sales-state-badge";
import { IndividualStoreBadge } from "@/components/feature/individual-store-badge";
import { formatDate } from "@/lib/utils/date";
import {
  NEXT_ACTION_URGENCY_LABELS,
  type CurrentSalesState,
  type NextActionUrgency,
  type SalesProgressRow,
} from "@/lib/domain/sales-progress";
import type { StoreResearchStatus } from "@/lib/domain/store-research-status";
import { StoreRowActions } from "./store-row-actions";

export const URGENCY_TONE: Record<
  Exclude<NextActionUrgency, "unset">,
  "destructive" | "warning" | "info"
> = { overdue: "destructive", today: "warning", upcoming: "info" };

/** 次回アクションの緊急度バッジ。表とコンパクト行で同じ色・文言にする。 */
function NextActionBadge({ urgency }: { urgency: NextActionUrgency }) {
  return urgency !== "unset" ? (
    <Badge tone={URGENCY_TONE[urgency]}>{NEXT_ACTION_URGENCY_LABELS[urgency]}</Badge>
  ) : (
    <Badge tone="outline">未設定</Badge>
  );
}

/** 次回アクションの「日付 / 種別」。どちらも無ければ `null`。 */
function nextActionWhen(r: SalesProgressRow): string | null {
  const { date, type } = r.currentNextAction;
  if (!date && !type) return null;
  return `${date ? formatDate(date) : "—"}${type ? ` / ${type}` : ""}`;
}

/** 次回アクションのメモ。長文になりうるので 1 行で切り詰め、全文は title に載せる。 */
function NextActionNote({ r, className }: { r: SalesProgressRow; className?: string }) {
  const note = r.currentNextAction.note;
  if (!note) return null;
  return (
    <p
      className={cn("truncate text-xs text-muted-foreground", className)}
      title={note}
    >
      {note}
    </p>
  );
}

/**
 * 次回アクションの表示。表のセルと狭幅のコンパクト行の両方が使う。
 *
 * 2 箇所に書くと「表では期限超過が赤いのに狭幅では違う」といった食い違いが
 * 静かに生まれるため 1 箇所に集約する。
 *
 * - `stack` (既定) = 表のセル用。バッジ・日付・メモを縦に積む。列予算 (272px) は
 *   この形で測ってあるので変えないこと。
 * - `inline` = コンパクト行用 (#330)。「次回」の見出し語・バッジ・日付を 1 行に並べる。
 *   日付も種別も無いときは日付の「—」だけの表示を出さない。メモは呼び出し側が
 *   {@link renderNextActionNote} で直後の行に置く。
 */
export function renderNextAction(
  r: SalesProgressRow,
  layout: "stack" | "inline" = "stack",
): ReactNode {
  if (layout === "inline") {
    const when = nextActionWhen(r);
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted-foreground">次回</span>
        <NextActionBadge urgency={r.urgency} />
        {when ? <span className="min-w-0 truncate text-xs">{when}</span> : null}
      </span>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <NextActionBadge urgency={r.urgency} />
      <div className="text-xs">{nextActionWhen(r) ?? "—"}</div>
      <NextActionNote r={r} />
    </div>
  );
}

/**
 * コンパクト行で次回アクションのメモを置く行。メモが無ければ何も出さない。
 *
 * flex-wrap の流れの中で `basis-full` にし、必ず次回アクションの直後に 1 行を占める。
 * 日付の右に並べると「電話」のような短いメモが種別と見分けられなくなるため。
 * 全文は title と詳細画面で読める。
 */
export function renderNextActionNote(r: SalesProgressRow): ReactNode {
  return <NextActionNote r={r} className="min-w-0 basis-full" />;
}

/**
 * 営業状態の文言が調査段階をすでに言い表しているか (#330)。
 *
 * 営業記録が無い店舗の営業状態は調査段階から導かれる (`deriveCurrentSalesState`) ので、
 * 「未調査・未営業」の隣に「未調査」、「調査済み・未営業」の隣に「調査済み」と並ぶと
 * 同じことを 2 度読ませる。コンパクト行ではこの 2 組だけ調査段階を省く。
 * 「レビュー待ち」は人の作業が残っている合図なので、どの営業状態でも省かない。
 */
export function isResearchStatusImpliedBySalesState(
  state: CurrentSalesState,
  status: StoreResearchStatus,
): boolean {
  return (
    (state === "unresearched" && status === "未調査") ||
    (state === "researched" && status === "調査済み")
  );
}

export interface StoreCardProps {
  row: SalesProgressRow;
  /**
   * 詳細への遷移先。`stores-table-view.tsx` の `storeDetailHref` を prop で受け取る。
   *
   * 自前で組み立てると「行クリックとコンパクト行で飛び先が違う」事故が起きうるし、
   * `stores-table-view` から import すると循環参照になる。
   */
  href: string;
  /** 削除ボタンを出すか (#155: admin 限定。サーバ確定値)。 */
  canDelete: boolean;
}

/**
 * 狭幅 (コンテナ 640px 未満 / admin は 688px 未満) で `<table>` の代わりに出る
 * 店舗 1 件ぶんのコンパクト行 (#234 で導入、#330 で行表示へ組み直し)。
 *
 * ## 情報の並び
 * 表の列と同じ順に読めるようにする: **店舗名 → 営業状態 → 次回アクション →
 * (調査段階・営業担当) → 操作**。載せる項目は「コンテナ 998px 相当の列集合」で、
 * #220 / #237 の閾値順をそのまま使う (営業状態 778 / 調査段階 898 / 営業担当 998)。
 * 最寄駅 (1198) 以降は載せず、店舗名リンクから詳細へ送る。
 *
 * ```
 * 店舗名 [個人店]                              [編集][削除]
 * [営業状態]  次回 [期限超過] 2026/10/01 / 訪問
 * 次回アクションのメモ (あるときだけ。必ず 1 行を占める)
 * 調査段階 [架電済み]  担当 山下
 * ```
 *
 * 2 行目以降は 1 本の流れで、幅が足りないところだけ項目単位で折り返す。メモだけは
 * 1 行を占めるので、その後の「調査段階・担当」は次の行へ回る。項目を固定の行に
 * 割り付けないのは、「担当 —」だけの行のように、空欄のために 1 行を使う表示を
 * 作らないため (メモが無く幅が足りれば、2 行目に全部が並ぶ)。
 *
 * ## 枠を持たない
 * 一覧の外枠 (`Card`) の内側で、店舗どうしは表の行と同じ薄い区切り線だけで分ける
 * (区切り線と左右の余白は `DataTable` の `<li>` が持つ)。#234 の版は店舗ごとの枠と
 * 次回アクションの背景枠が入れ子になり、375px で 1 件 220〜240px あった。
 * 同じ高さで見比べられる件数を増やすため、枠・独立したフッター・シェブロンをやめた。
 *
 * ## 操作は DOM の最後、見た目は右上
 * 読み上げとタブ順を表の行 (店舗名 → … → 操作) とそろえるため、操作は DOM の最後に
 * 置き、grid の明示配置で 1 行目の右端へ出す。44px のヒット領域はそのまま。
 *
 * ## 行全体をクリック可能にしない
 * 表の `rowHref` はマウス操作の便宜 (`DataTableRow` の JSDoc) だが、タッチでは
 * 誤タップとスクロール開始の誤検知を招く。代わりに**店舗名の行を 1 つの
 * `<Link>`** にして 44px 高の広い的を作る。
 *
 * ## 見出しを `<h4>` にする理由
 * ページ `<h1>` → `Card.Title` `<h3>` → 店舗名 `<h4>` の階層になる。
 * スクリーンリーダのローターや見出しジャンプで店舗間を移動できるようになり、
 * これはモバイルでの主要なナビゲーション手段。
 */
export function StoreCard({ row, href, canDelete }: StoreCardProps) {
  const showResearchStatus = !isResearchStatusImpliedBySalesState(
    row.currentSalesState,
    row.researchStatus,
  );
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-1 gap-y-1">
      {/* min-w-0 が無いと truncate が効かず 375px で横溢れする (本行で最も起きやすい事故)。 */}
      <Link
        href={href}
        title={row.store.name}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h4 className="min-w-0 truncate font-semibold text-foreground">
          {row.store.name}
        </h4>
        <span className="shrink-0">
          <IndividualStoreBadge operatorType={row.store.operator_type} />
        </span>
      </Link>

      {/*
        営業状態 → 次回アクション (メモ) → 調査段階 → 営業担当。表の列と同じ順で 1 本の
        流れにし、幅が足りないところだけ項目単位で折り返す。補足の 2 項目は小さな文字にして、
        「担当 —」だけの行が店舗ごとに 1 行ずつ増えるのを防ぐ。
      */}
      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <SalesStateSummary
          state={row.currentSalesState}
          latestDeal={row.latestDeal}
          layout="inline"
        />
        {renderNextAction(row, "inline")}
        {renderNextActionNote(row)}
        {showResearchStatus ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            調査段階
            <StoreResearchStatusBadge status={row.researchStatus} />
          </span>
        ) : null}
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={row.salesName ?? undefined}
        >
          担当 {row.salesName ?? "—"}
        </span>
      </div>

      <div className="col-start-2 row-start-1">
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
