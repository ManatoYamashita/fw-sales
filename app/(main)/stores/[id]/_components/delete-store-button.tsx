"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { deleteStoreAction } from "@/lib/actions/store-actions";
import { toast } from "@/components/ui/toast";

export function DeleteStoreButton({
  storeId,
  storeName,
  dealCount,
}: {
  storeId: string;
  storeName: string;
  dealCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
    <Modal open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-red-600 hover:text-red-700 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" /> 削除
      </Button>
      <ModalContent title="店舗を削除しますか?" size="sm">
        <p className="text-sm text-foreground leading-relaxed">
          「<strong>{storeName}</strong>」を削除します。
          {dealCount > 0 ? (
            <>
              <br />
              関連する商談 <strong>{dealCount}</strong> 件も同時に削除されます。
            </>
          ) : null}
          <br />
          この操作は取り消せません。
        </p>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            キャンセル
          </Button>
          <Button variant="danger" onClick={remove} disabled={pending}>
            {pending ? "削除中…" : "削除する"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
