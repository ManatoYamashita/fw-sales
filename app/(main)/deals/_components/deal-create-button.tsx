"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";

export interface DealCreateStoreOption {
  id: string;
  name: string;
  prefecture: string;
  city: string;
}

export function DealCreateButton({
  stores,
}: {
  stores: DealCreateStoreOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const goNew = () => {
    if (!storeId) return;
    startTransition(() => {
      router.push(`/deals/new?store=${storeId}`);
    });
  };

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <Button variant="default" size="md" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        新規作成
      </Button>
      <ModalContent
        title="商談を作成する店舗を選択"
        description="既存の店舗から商談を新規作成します。店舗が登録されていない場合は先に店舗を追加してください。"
        size="md"
      >
        <FormField label="店舗" htmlFor="deal-create-store" required>
          <Select
            id="deal-create-store"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">店舗を選択…</option>
            {stores.map((s) => {
              const meta = [s.prefecture, s.city].filter(Boolean).join(" ");
              const label = meta ? `${s.name} (${meta})` : s.name;
              return (
                <option key={s.id} value={s.id}>
                  {label}
                </option>
              );
            })}
          </Select>
        </FormField>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            キャンセル
          </Button>
          <Button
            variant="default"
            onClick={goNew}
            disabled={!storeId || pending}
          >
            {pending ? "移動中…" : "作成画面へ"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
