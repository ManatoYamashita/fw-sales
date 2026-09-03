"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteStoreAction } from "@/lib/actions/store-actions";
import { toast } from "@/components/ui/toast";
import { StoreDeleteConfirmDialog } from "./store-delete-confirm-dialog";
import { cn } from "@/lib/utils/cn";

/**
 * 一覧 1 行の操作 (編集 / 削除)。
 *
 * `canDelete` は `stores-table.tsx` が**サーバで**判定して渡す (#155 の admin 限定方針)。
 * 以前は client の `useIsAdmin()` で「見えているが disabled」にしていたが、
 * 一般営業担当にとっては押せない削除ボタンが並ぶだけで意味がないため、
 * false のときは要素ごと描画しない。
 *
 * **UI の出し分けは認可境界ではない。** 真の防御は `deleteStoreAction` の
 * `requireAdmin` ガードであり、そちらは変更していない。
 */
export function StoreRowActions({
  storeId,
  storeName,
  canDelete,
  size = "compact",
}: {
  storeId: string;
  storeName: string;
  canDelete: boolean;
  /**
   * ボタンのヒット領域 (#234)。
   *
   * - `compact` (既定) = 32px。表の行に置く用。列予算 100px を守るため据え置く
   *   (44px にすると min-content が 124px になり閾値 14 本が一斉に動く。
   *    表が出るのはコンテナ 640px 以上なのでタッチ主体の幅ではない)
   * - `touch` = 44px。カード内に置く用
   */
  size?: "compact" | "touch";
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const hit =
    size === "touch"
      ? "h-11 w-11"
      : "h-8 w-8";
  const icon = size === "touch" ? "h-4 w-4" : "h-3.5 w-3.5";

  const remove = () => {
    startTransition(async () => {
      const result = await deleteStoreAction(storeId);
      // delete 成功時は redirect が throw されてここまで到達しない
      if (result && !result.ok) {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className={cn("flex items-center justify-end", size === "touch" ? "gap-2" : "gap-1")}>
      <Link
        href={`/stores/${storeId}/edit`}
        aria-label={`${storeName} を編集`}
        title="編集"
        className={cn(
          hit,
          "inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Pencil className={icon} />
      </Link>
      {canDelete ? (
        <>
          <button
            type="button"
            aria-label={`${storeName} を削除`}
            title="削除"
            onClick={() => setOpen(true)}
            className={cn(
              hit,
              "inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive-soft hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Trash2 className={icon} />
          </button>
          {/* 影響表示つき共有確認ダイアログ (store-cascade-delete / Issue #152)。
              削除 action の実行と失敗 toast は本コンポーネントの責務のまま。 */}
          <StoreDeleteConfirmDialog
            open={open}
            onOpenChange={setOpen}
            target={{ kind: "single", storeId, storeName }}
            onConfirm={remove}
            pending={pending}
          />
        </>
      ) : null}
    </div>
  );
}
