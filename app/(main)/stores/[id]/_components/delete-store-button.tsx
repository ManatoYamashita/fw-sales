"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteStoreAction } from "@/lib/actions/store-actions";
import { toast } from "@/components/ui/toast";
import { useIsAdmin } from "@/components/layout/current-user-provider";
import { StoreDeleteConfirmDialog } from "@/app/(main)/stores/_components/store-delete-confirm-dialog";

export function DeleteStoreButton({
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
      // redirect 後は到達しないが念のため
      if (result && !result.ok) {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <Button
        variant="ghost-destructive"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={denyDelete}
        title={denyDelete ? "管理者のみ実行できます" : undefined}
      >
        <Trash2 className="h-4 w-4" /> 削除
      </Button>
      {/* 影響表示つき共有確認ダイアログ (store-cascade-delete / Issue #152)。
          旧 dealCount prop は廃止し、ダイアログが open 時に 4 カテゴリの実件数を取得する。 */}
      <StoreDeleteConfirmDialog
        open={open}
        onOpenChange={setOpen}
        target={{ kind: "single", storeId, storeName }}
        onConfirm={remove}
        pending={pending}
      />
    </>
  );
}
