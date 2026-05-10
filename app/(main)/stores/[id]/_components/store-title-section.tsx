"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/toast";
import { IndividualStoreBadge } from "@/components/feature/individual-store-badge";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import type { Store, StorePatch } from "@/types/store";

export function StoreTitleSection({ store }: { store: Store }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: store.name, genre: store.genre });

  const onText =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const onCancel = () => {
    setForm({ name: store.name, genre: store.genre });
    setEditing(false);
  };

  const onSave = () => {
    if (!form.name.trim()) {
      toast.error("店舗名を入力してください");
      return;
    }
    const patch: StorePatch = { ...form };
    startTransition(async () => {
      const result = await updateStorePatchAction(store.id, patch);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
          <FormField label="店舗名" htmlFor="store_name" required>
            <Input
              id="store_name"
              value={form.name}
              onChange={onText("name")}
              required
            />
          </FormField>
          <FormField label="業態" htmlFor="store_genre">
            <Input
              id="store_genre"
              value={form.genre}
              onChange={onText("genre")}
            />
          </FormField>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={pending}
          >
            <Save className="h-3.5 w-3.5" />
            {pending ? "保存中…" : "保存"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            <X className="h-3.5 w-3.5" /> キャンセル
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl md:text-2xl font-bold text-foreground inline-flex items-center gap-2 flex-wrap">
        {store.name}
        <IndividualStoreBadge operatorType={store.operator_type} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
          aria-label="店舗名・業態を編集"
          className="text-muted-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </h2>
      <p className="text-sm text-muted-foreground mt-0.5">
        {[store.prefecture, store.city, store.genre]
          .filter(Boolean)
          .join(" / ") || "—"}
      </p>
    </div>
  );
}
