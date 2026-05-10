"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import type { Store } from "@/types/store";

export function MemoCard({ store }: { store: Store }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [memo, setMemo] = useState(store.memo);

  const onCancel = () => {
    setMemo(store.memo);
    setEditing(false);
  };

  const onSave = () => {
    startTransition(async () => {
      const result = await updateStorePatchAction(store.id, { memo });
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>メモ</Card.Title>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={pending}
            >
              <X className="h-3.5 w-3.5" /> キャンセル
            </Button>
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
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" /> 編集
          </Button>
        )}
      </Card.Header>
      <Card.Body>
        {editing ? (
          <Textarea
            rows={6}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="営業活動上の気付き、オーナーとのやり取り、注意点などをここに残します"
          />
        ) : store.memo ? (
          <p className="text-sm text-foreground whitespace-pre-wrap leading-6">
            {store.memo}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">メモはまだありません。</p>
        )}
      </Card.Body>
    </Card>
  );
}
