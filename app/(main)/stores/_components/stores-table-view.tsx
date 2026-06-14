"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { StageBadge } from "@/components/feature/stage-badge";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { IndividualStoreBadge } from "@/components/feature/individual-store-badge";
import { StarRating } from "@/components/ui/star-rating";
import { formatDate } from "@/lib/utils/date";
import { toast } from "@/components/ui/toast";
import type { Store } from "@/types/store";
import { StoreRowActions } from "./store-row-actions";
import { bulkDeleteStoresAction } from "@/lib/actions/store-actions";

export interface StoresTableViewProps {
  stores: readonly Store[];
  /**
   * `Profile.id → display_name` を tuple 配列で受け取る。
   * Server Component から Client Component への RSC 境界では `Map<>` の
   * シリアライズ挙動に依存せず、明示的にプレーンな配列で渡す。
   */
  profileEntries: ReadonlyArray<readonly [string, string]>;
  // task 4.2 (PR3a): activeDrStoreIds props 撤去 (#121 / #110 連動)。
}

function buildColumns(
  profileMap: Map<string, string>,
): ColumnDef<Store>[] {
  const resolveAssignedSales = (s: Store): string =>
    s.assigned_sales_user_id
      ? (profileMap.get(s.assigned_sales_user_id) ?? "—")
      : "—";

  return [
    {
      key: "name",
      header: "店舗名",
      sortKey: "name",
      sortDefaultDir: "asc",
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
      sortKey: "location",
      sortDefaultDir: "asc",
      truncate: true,
      maxWidth: "200px",
      title: (s) =>
        [s.prefecture, s.city].filter(Boolean).join(" / ") || undefined,
      cell: (s) => (
        <span className="text-foreground/80">
          {[s.prefecture, s.city].filter(Boolean).join(" / ") || "—"}
        </span>
      ),
    },
    {
      key: "genre",
      header: "業態",
      sortKey: "genre",
      sortDefaultDir: "asc",
      cell: (s) => s.genre || "—",
    },
    {
      key: "review",
      header: "口コミ",
      sortKey: "review",
      sortDefaultDir: "desc",
      cell: (s) =>
        s.review_count > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <StarRating value={s.review_avg} showValue />
            <span className="text-xs text-muted-foreground">
              {s.review_count}件
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        ),
    },
    {
      key: "stage",
      header: "状態",
      sortKey: "stage",
      sortDefaultDir: "asc",
      cell: (s) => <StageBadge stage={s.stage} />,
    },
    {
      key: "channel",
      header: "チャネル",
      sortKey: "channel",
      sortDefaultDir: "asc",
      cell: (s) => <ChannelBadge channel={s.channel} />,
    },
    {
      key: "sales",
      header: "営業担当",
      sortKey: "sales",
      sortDefaultDir: "asc",
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
      sortKey: "updated",
      sortDefaultDir: "desc",
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

export function StoresTableView({
  stores,
  profileEntries,
}: StoresTableViewProps) {
  const router = useRouter();
  const profileMap = new Map(profileEntries);
  const columns = buildColumns(profileMap);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  // 表示中の行のみを選択対象として扱う。フィルタで一覧から消えた行の ID は selectedIds に
  // 残るが、件数表示・一括削除の対象は selectedVisibleIds に限定する (表示中の行のみ操作する)。
  const visibleIdSet = new Set(stores.map((s) => s.id));
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
            {stores.length} 件
          </span>
        </Card.Header>
        <DataTable
          columns={columns}
          rows={[...stores]}
          rowKey={(s) => s.id}
          rowHref={(s) => `/stores/${s.id}`}
          rowSelection={{
            selectedRowKeys: selectedVisibleIds,
            onChange: setSelectedIds,
            allRowsLabel: "表示中の店舗をすべて選択",
            rowLabel: (s) => `${s.name} を選択`,
          }}
          emptyState={
            <EmptyState
              icon={<Inbox />}
              title="該当する店舗がありません"
              description="検索条件を変更するか、店舗を新しく登録してください。"
            />
          }
        />
      </Card>

      {/* 下部固定バー: 1 件以上選択時のみ表示。sticky でメインコンテンツ幅に追従し、
          サイドバー折りたたみ (#106) でも左端がズレない (エリア検索の一括バーと同じ仕組み)。 */}
      {selectedVisibleIds.length > 0 && (
        <div
          role="region"
          aria-label="選択した店舗の一括操作"
          className="sticky bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-border bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
        >
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
            選択を解除
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {selectedVisibleIds.length}件選択中
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkOpen(true)}
            disabled={isDeleting}
            className="ml-auto gap-1.5"
          >
            {isDeleting ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
            削除
          </Button>
        </div>
      )}

      <Modal open={bulkOpen} onOpenChange={setBulkOpen}>
        <ModalContent title="選択中の店舗を削除しますか?" size="sm">
          <p className="text-sm text-foreground leading-relaxed">
            選択中の
            <strong className="font-semibold">
              {" "}
              {selectedVisibleIds.length} 件{" "}
            </strong>
            の店舗を削除します。関連する商談・調査・ハンドオフ・Deep Research も
            同時に完全に削除されます。この操作は取り消せません。
          </p>
          <ModalFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkOpen(false)}
              disabled={isDeleting}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              onClick={handleBulkDelete}
              disabled={isDeleting || selectedVisibleIds.length === 0}
            >
              {isDeleting ? "削除中…" : "削除する"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
