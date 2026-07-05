"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteStoreAction } from "@/lib/actions/store-actions";
import { toast } from "@/components/ui/toast";
import { useIsAdmin } from "@/components/layout/current-user-provider";
import { StoreDeleteConfirmDialog } from "./store-delete-confirm-dialog";

export function StoreRowActions({
  storeId,
  storeName,
}: {
  storeId: string;
  storeName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // #155: 破壊的操作は admin 限定 (真の防御はサーバ側 requireAdmin)。
  const { isAdmin, loaded } = useIsAdmin();
  const denyDelete = loaded && !isAdmin;

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
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/stores/${storeId}/edit`}
        aria-label={`${storeName} を編集`}
        title="編集"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        aria-label={`${storeName} を削除`}
        title={denyDelete ? "管理者のみ実行できます" : "削除"}
        onClick={() => setOpen(true)}
        disabled={denyDelete}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive-soft hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none"
      >
        <Trash2 className="h-3.5 w-3.5" />
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
    </div>
  );
}
