"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, SearchX, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { type SortDir } from "@/components/ui/sortable-header-params";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StageBadge } from "@/components/feature/stage-badge";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { SalesStateBadge } from "@/components/feature/sales-state-badge";
import { IndividualStoreBadge } from "@/components/feature/individual-store-badge";
import { formatDate } from "@/lib/utils/date";
import { toast } from "@/components/ui/toast";
import { type SalesProgressRow } from "@/lib/domain/sales-progress";
import { StoreCard, renderNextAction } from "./store-card";
import { StoreRowActions } from "./store-row-actions";
import { StoreDeleteConfirmDialog } from "./store-delete-confirm-dialog";
import { buildStoreLocationColumn } from "./store-location-column";
import { bulkDeleteStoresAction } from "@/lib/actions/store-actions";

export interface StoresTableViewProps {
  rows: readonly SalesProgressRow[];
  /**
   * 現在有効なソートキー (`page.tsx` の `parseSort` がサーバで確定させた値)。
   *
   * 一致する列は狭幅でも隠さない。`SortableHeader` は asc ↔ desc のトグルしか
   * 持たず「ソート解除」が無いため、ソート中の列が隠れると並び順の手掛かりが
   * 画面から消え、方向も変えられなくなる (issue #220 要件 5)。
   */
  activeSortKey?: string;
  /**
   * 現在のソート方向 (`page.tsx` の `parseSort` がサーバで確定させた値)。
   * カードモードの並び替えコントロールが現在値を表示するために使う。
   */
  activeSortDir?: SortDir;
  /**
   * 削除系 UI (行の削除ボタン / チェックボックス列 / 一括削除バー) を出すか。
   *
   * #155 の方針どおり破壊的操作は admin 限定。判定は `stores-table.tsx` が
   * **サーバで**確定させて渡す。client の `useIsAdmin().loaded` を待つ方式だと
   * 初期描画後にチェックボックス列が出現してテーブルが横にずれるため。
   *
   * **これは認可境界ではない。** 真の防御は `deleteStoreAction` /
   * `bulkDeleteStoresAction` 側の `requireAdmin` ガード。
   */
  canDelete: boolean;
  /**
   * 絞り込み条件が 1 つ以上有効か (`hasAnyProgressFilter` の結果)。
   *
   * 0 件のときの案内を「条件に一致しない」と「店舗がまだ無い」で言い分けるために使う。
   * クイックフィルタで「今日」を選んで 0 件のときに新規登録を勧めるのは的外れなので、
   * 条件が効いている場合は条件の変更・解除を案内する。
   */
  isFiltered: boolean;
  // task 4.2 (PR3a): activeDrStoreIds props 撤去 (#121 / #110 連動)。
}

/**
 * 一覧が 0 件のときの案内。`isFiltered` で文面を切り替える。
 * 表示ロジックを純関数に切り出し、テストから直接検証できるようにしている。
 */
export function buildEmptyState(isFiltered: boolean) {
  return isFiltered ? (
    <EmptyState
      icon={<SearchX />}
      title="現在の条件に一致する店舗はありません"
      description="条件を変更または解除してください。"
    />
  ) : (
    <EmptyState
      icon={<Inbox />}
      title="該当する店舗がありません"
      description="検索条件を変更するか、店舗を新しく登録してください。"
    />
  );
}

/**
 * 行クリック (`rowHref`) と店舗名リンクの遷移先。
 * 両者がずれると「行のどこを押したかで飛び先が変わる」ため 1 箇所に集約する。
 */
const storeDetailHref = (row: SalesProgressRow) =>
  `/stores/${row.store.id}?tab=progress`;

/**
 * 一覧の列定義。
 *
 * `minContainerWidth` は「その列を出すのに要るコンテナ幅 (px)」で、列単体の実測
 * min-content 幅 (cap を持つ列は cap そのもの) の累計から決めている。always 列
 * (店舗名 / 次回アクション / 操作) = 632px を土台に、狭い順へ 状態 → 現在の営業状態 →
 * 営業担当 → 最寄駅 → チャネル → 最終営業日 → 業態 と積む。落とす順は「直近の
 * 意思決定が乗っていない列から」で、最寄駅 (#175 / #177) は業態より上位に置く。
 * 単体予算の内訳と積み直しの検算は `__tests__/stores-table-columns.test.tsx` (#237)。
 *
 * テストから配分表を固定するため export している。
 */
export function buildColumns(canDelete: boolean): ColumnDef<SalesProgressRow>[] {

  return [
    {
      key: "name",
      header: "店舗名",
      sortKey: "name",
      sortDefaultDir: "asc",
      truncate: true,
      maxWidth: "260px",
      title: (r) => r.store.name,
      cell: (r) => (
        <span className="inline-flex items-center gap-2 min-w-0 max-w-full align-middle">
          {/*
            店舗名は正式な <Link>。行全体の `rowHref` はマウス操作の便宜でしかなく、
            `<tr>` は tabIndex を持たないためキーボードからは到達できない。
            実 <a> を 1 つ置くことで Tab フォーカス / Enter / Cmd・Ctrl+click /
            middle click / 新規タブ / リンクのコピーが成立する。
            `DataTableRow.shouldSkipNavigation` が `target.closest("a")` を見て行側の
            ナビゲーションを抑止するため、クリックが二重発火することはない。
          */}
          <Link
            href={storeDetailHref(r)}
            className="font-semibold text-foreground truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {r.store.name}
          </Link>
          <span className="flex-shrink-0">
            <IndividualStoreBadge operatorType={r.store.operator_type} />
          </span>
        </span>
      ),
    },
    buildStoreLocationColumn(),
    {
      key: "genre",
      header: "業態",
      sortKey: "genre",
      sortDefaultDir: "asc",
      // 業態は自由入力なので上限が無いと min-content が青天井になり、
      // 以降の列の閾値がまとめてずれる。truncate + maxWidth で予算を確定させる。
      // 列予算はこの cap そのもの (#237)。
      truncate: true,
      maxWidth: "160px",
      title: (r) => r.store.genre || undefined,
      minContainerWidth: 1582,
      cell: (r) => r.store.genre || "—",
    },
    { key: "salesState", header: "現在の営業状態", minContainerWidth: 874, cell: (r) => <SalesStateBadge state={r.currentSalesState} /> },
    // 描画は store-card.tsx の renderNextAction が単一の真実 (カードと共有)。
    // max-w-[240px] は列予算 272px (= 240 + padding 32) を確定させるための cap。
    { key: "next", header: "次回アクション", sortKey: "next", sortDefaultDir: "asc", cell: (r) => <div className="max-w-[240px]">{renderNextAction(r)}</div> },
    {
      key: "stage",
      header: "状態",
      sortKey: "stage",
      sortDefaultDir: "asc",
      minContainerWidth: 728,
      cell: (r) => <StageBadge stage={r.store.stage} />,
    },
    {
      key: "channel",
      header: "チャネル",
      sortKey: "channel",
      sortDefaultDir: "asc",
      minContainerWidth: 1312,
      cell: (r) => <ChannelBadge channel={r.store.channel} />,
    },
    {
      key: "sales",
      header: "営業担当",
      sortKey: "sales",
      sortDefaultDir: "asc",
      truncate: true,
      // 上限を 140px のままにすると長い表示名で最大 43px はみ出し、この列以降の
      // 閾値がすべてずれるため 100px まで締める。列予算はこの cap そのもの
      // (#237。短いデータでの実測 97px を予算にすると cap 一杯の値で 3px 溢れる)。
      maxWidth: "100px",
      minContainerWidth: 974,
      title: (r) => r.salesName ?? undefined,
      cell: (r) => r.salesName ?? "—",
    },
    {
      key: "updated",
      header: "最終営業日",
      sortKey: "meeting",
      sortDefaultDir: "desc",
      minContainerWidth: 1422,
      cell: (r) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {r.latestMeetingDate ? formatDate(r.latestMeetingDate) : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">操作</span>,
      align: "right",
      width: "92px",
      preventRowClick: true,
      cell: (r) => <StoreRowActions storeId={r.store.id} storeName={r.store.name} canDelete={canDelete} />,
    },
  ];
}

export function StoresTableView({
  rows,
  canDelete,
  isFiltered,
  activeSortKey,
  activeSortDir,
}: StoresTableViewProps) {
  const router = useRouter();
  const columns = buildColumns(canDelete);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  // 表示中の行のみを選択対象として扱う。フィルタで一覧から消えた行の ID は selectedIds に
  // 残るが、件数表示・一括削除の対象は selectedVisibleIds に限定する (表示中の行のみ操作する)。
  const visibleIdSet = new Set(rows.map((r) => r.store.id));
  const selectedVisibleIds = selectedIds.filter((id) => visibleIdSet.has(id));

  const handleBulkDelete = () => {
    if (selectedVisibleIds.length === 0) return;
    const targetIds = selectedVisibleIds;
    startDelete(async () => {
      const result = await bulkDeleteStoresAction(targetIds);
      if (!result.ok) {
        toast.error(result.error ?? "一括削除に失敗しました");
        return;
      }
      const { deletedCount, requestedCount } = result.data;
      if (deletedCount === 0) {
        toast.warn("削除対象が見つかりませんでした");
      } else if (deletedCount < requestedCount) {
        toast.warn(`${deletedCount}/${requestedCount} 件を削除しました`);
      } else {
        toast.success(`${deletedCount} 件を削除しました`);
      }
      setBulkOpen(false);
      setSelectedIds((prev) => prev.filter((id) => !targetIds.includes(id)));
      router.refresh();
    });
  };

  return (
    <>
      <Card>
        <Card.Header>
          <Card.Title>店舗一覧</Card.Title>
          <span className="text-sm text-muted-foreground">
            {rows.length} 件
          </span>
        </Card.Header>
        <DataTable
          columns={columns}
          rows={[...rows]}
          rowKey={(r) => r.store.id}
          rowHref={storeDetailHref}
          activeSortKey={activeSortKey}
          activeSortDir={activeSortDir}
          /*
            コンテナ 640px 未満 (admin は 688px 未満) では <table> を捨ててカードに
            切り替える (#234 / PR3/3)。always 列の min-content は非 admin 632px /
            admin 680px あり、375px viewport のコンテナ 341px では列を落としきっても
            収まらないため、ビューごと差し替える以外に横スクロールを消す手段がない。
          */
          cardView={{
            label: "店舗一覧 (カード表示)",
            render: (r) => (
              <StoreCard
                row={r}
                href={storeDetailHref(r)}
                canDelete={canDelete}
              />
            ),
          }}
          /*
            一般営業担当が使える一括操作は存在しない (bulk は削除のみ)。
            選ぶだけ選べて何もできないチェックボックス列は認知負荷でしかないので、
            admin 以外には列ごと出さない。
          */
          rowSelection={
            canDelete
              ? {
                  selectedRowKeys: selectedVisibleIds,
                  onChange: setSelectedIds,
                  allRowsLabel: "表示中の店舗をすべて選択",
                  rowLabel: (r) => `${r.store.name} を選択`,
                }
              : undefined
          }
          emptyState={buildEmptyState(isFiltered)}
        />
      </Card>

      {/* 下部固定バー: 1 件以上選択時のみ表示。sticky でメインコンテンツ幅に追従し、
          サイドバー折りたたみ (#106) でも左端がズレない (エリア検索の一括バーと同じ仕組み)。
          非 admin ではそもそも選択できないが、条件を明示して意図を残す。 */}
      {canDelete && selectedVisibleIds.length > 0 && (
        <div
          role="region"
          aria-label="選択した店舗の一括操作"
          className="sticky bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-border bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
        >
          <Button variant="ghost" size="touch" onClick={() => setSelectedIds([])}>
            選択を解除
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {selectedVisibleIds.length}件選択中
          </span>
          <Button
            variant="destructive"
            size="touch"
            onClick={() => setBulkOpen(true)}
            disabled={isDeleting}
            className="ml-auto"
          >
            {isDeleting ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
            削除
          </Button>
        </div>
      )}

      {/* 影響表示つき共有確認ダイアログ (store-cascade-delete / Issue #152)。
          選択群の合算影響件数を表示し、bulk 削除 action と部分結果 toast は
          handleBulkDelete (現行) の責務のまま。 */}
      <StoreDeleteConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        target={{ kind: "bulk", storeIds: selectedVisibleIds }}
        onConfirm={handleBulkDelete}
        pending={isDeleting}
      />
    </>
  );
}
