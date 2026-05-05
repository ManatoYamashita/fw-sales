"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { deleteDealAction } from "@/lib/actions/deal-actions";
import { toast } from "@/components/ui/toast";

export function DealRowActions({
  dealId,
  storeName,
}: {
  dealId: string;
  storeName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const result = await deleteDealAction(dealId);
      if (result && !result.ok) {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/deals/${dealId}`}
        aria-label="商談を編集"
        title="編集"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <Modal open={open} onOpenChange={setOpen}>
        <button
          type="button"
          aria-label="商談を削除"
          title="削除"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive-soft hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <ModalContent title="商談を削除しますか?" size="sm">
          <p className="text-sm text-foreground leading-relaxed">
            「<strong className="font-semibold">{storeName}</strong>」の商談レコードを削除します。
            店舗のステージは変更されません。この操作は元に戻せません。
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
    </div>
  );
}
